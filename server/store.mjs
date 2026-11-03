import { mkdirSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { AppError, reduce } from "./model.mjs";

const APPEND = `
if redis.call('LLEN', KEYS[1]) ~= tonumber(ARGV[1]) then return 0 end
redis.call('RPUSH', KEYS[1], ARGV[2])
redis.call('SADD', KEYS[2], ARGV[3])
return 1`;
const LEASE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local isOwner = string.sub(ARGV[2], 1, 6) == 'owner:'
if not isOwner and not redis.call('ZSCORE', KEYS[1], ARGV[2]) then
  local allMembers = redis.call('ZRANGE', KEYS[1], 0, -1)
  local audience = 0
  for _, m in ipairs(allMembers) do
    if string.sub(m, 1, 6) ~= 'owner:' then audience = audience + 1 end
  end
  if audience >= tonumber(ARGV[4]) then return 0 end
end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[2])
redis.call('EXPIRE', KEYS[1], 120)
return 1`;
const THROTTLE = `
local total = redis.call('INCR', KEYS[1])
if total == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return total`;

// Only the server owns the event log. Append's expected sequence makes validation
// and writes safe when concurrent requests land on different Vercel instances.
export class EventStore {
  constructor(driver) {
    this.driver = driver;
    this.cache = new Map();
    this.locks = new Map();
    this.limits = new Map();
  }
  async limit(key, maximum = 8, seconds = 60, message) {
    const errMsg =
      message || "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    if (key.startsWith("login:") && !message) {
      message = "로그인 시도가 많습니다. 1분 후 다시 시도해 주세요.";
    }
    const finalMsg = message || errMsg;
    if (this.driver.limit) {
      if ((await this.driver.limit(key, seconds)) > maximum)
        throw new AppError(429, finalMsg);
      return;
    }
    const now = Date.now();
    for (const [name, row] of this.limits)
      if (row.until < now) this.limits.delete(name);
    const row = this.limits.get(key) || {
      count: 0,
      until: now + seconds * 1000,
    };
    row.count++;
    this.limits.set(key, row);
    if (row.count > maximum) throw new AppError(429, finalMsg);
  }
  async state(roomId) {
    let cached = this.cache.get(roomId) || { state: null, loaded: 0 };
    const events = await this.driver.read(roomId, cached.loaded);
    if (events.length) {
      // Work on a copy: concurrent state readers must not mutate the same reducer state.
      let current = cached.state ? structuredClone(cached.state) : null;
      for (const event of events) current = reduce(current, event);
      cached = { state: current, loaded: current.seq };
      const newer = this.cache.get(roomId);
      if (!newer || newer.loaded < cached.loaded)
        this.cache.set(roomId, cached);
    }
    if (!cached.state) throw new AppError(404, "채팅방을 찾을 수 없습니다.");
    return structuredClone(
      (this.cache.get(roomId)?.loaded > cached.loaded
        ? this.cache.get(roomId)
        : cached
      ).state,
    );
  }
  async write(roomId, build, { create = false } = {}) {
    // Serialize within this instance; CAS handles contention across instances.
    const previous = this.locks.get(roomId) || Promise.resolve();
    let release;
    const next = new Promise((r) => {
      release = r;
    });
    this.locks.set(roomId, next);
    await previous.catch(() => {});
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        let state = null;
        try {
          state = await this.state(roomId);
        } catch (e) {
          if (e.status !== 404) throw e;
        }
        if (!state && !create)
          throw new AppError(404, "채팅방을 찾을 수 없습니다.");
        const action = await build(state);
        if (!action) return state;
        const event = { ...action, seq: (state?.seq || 0) + 1, at: Date.now() };
        if (await this.driver.append(roomId, event.seq - 1, event)) {
          const updated = reduce(state, event);
          this.cache.set(roomId, { state: updated, loaded: updated.seq });
          return structuredClone(updated);
        }
      }
      throw new AppError(
        409,
        "접속이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      release();
      if (this.locks.get(roomId) === next) this.locks.delete(roomId);
    }
  }
  async rooms() {
    const roomIds = await this.driver.ids();
    return Promise.all(
      roomIds.map(async (key) => {
        const state = await this.state(key);
        return {
          ...state.room,
          messageCount: state.messages.filter((m) => !m.deleted).length,
          participantCount: Object.keys(state.participants).length,
        };
      }),
    );
  }
  async presence(roomId, participantId, remove = false) {
    return this.driver.presence(roomId, participantId, remove);
  }
  async members(roomId) {
    if (this.driver.members) return this.driver.members(roomId);
    return [];
  }
  async count(roomId) {
    return this.driver.count(roomId);
  }
  async kvSet(key, value, seconds = 600) {
    if (this.driver.kvSet) return this.driver.kvSet(key, value, seconds);
  }
  async kvGet(key, consume = false) {
    if (this.driver.kvGet) return this.driver.kvGet(key, consume);
    return null;
  }
  async kvDel(key) {
    if (this.driver.kvDel) return this.driver.kvDel(key);
  }
  async close() {
    this.driver.close?.();
  }
}

export async function localStore(filename) {
  const { DatabaseSync } = await import("node:sqlite");
  const file =
    filename === ":memory:"
      ? filename
      : resolve(filename || "data/sudaon.sqlite");
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ":memory:") chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS events (room TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(room, seq));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)").run(
    "session-secret",
    randomBytes(32).toString("hex"),
  );
  const sessionSecret = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("session-secret").value;
  const leases = new Map();
  const ephemeral = new Map();
  const active = (roomId) => {
    const group = leases.get(roomId) || new Map();
    const now = Date.now();
    for (const [key, expires] of group) if (expires < now) group.delete(key);
    leases.set(roomId, group);
    return group;
  };
  return new EventStore({
    sessionSecret,
    read: async (roomId, after) =>
      db
        .prepare(
          "SELECT body FROM events WHERE room = ? AND seq > ? ORDER BY seq",
        )
        .all(roomId, after)
        .map((r) => JSON.parse(r.body)),
    append: async (roomId, expected, event) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const { latest } = db
          .prepare(
            "SELECT COALESCE(MAX(seq), 0) AS latest FROM events WHERE room = ?",
          )
          .get(roomId);
        if (latest !== expected) {
          db.exec("ROLLBACK");
          return false;
        }
        db.prepare("INSERT INTO events (room, seq, body) VALUES (?, ?, ?)").run(
          roomId,
          event.seq,
          JSON.stringify(event),
        );
        db.exec("COMMIT");
        return true;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    ids: async () =>
      db
        .prepare("SELECT DISTINCT room FROM events")
        .all()
        .map((r) => r.room),
    presence: async (roomId, participantId, remove) => {
      const group = active(roomId);
      if (remove) {
        group.delete(participantId);
        return true;
      }
      const isOwner = String(participantId).startsWith("owner:");
      const audienceCount = [...group.keys()].filter(
        (k) => !String(k).startsWith("owner:"),
      ).length;
      if (!isOwner && !group.has(participantId) && audienceCount >= 200)
        throw new AppError(
          409,
          "채팅방이 가득 찼습니다. 최대 200명이 참여할 수 있습니다.",
        );
      group.set(participantId, Date.now() + 65000);
      return true;
    },
    members: async (roomId) => [...active(roomId).keys()],
    count: async (roomId) =>
      [...active(roomId).keys()].filter((k) => !String(k).startsWith("owner:"))
        .length,
    kvSet: async (key, value, seconds = 600) => {
      const now = Date.now();
      for (const [k, row] of ephemeral) {
        if (row.exp <= now) ephemeral.delete(k);
      }
      ephemeral.set(key, {
        value: structuredClone(value),
        exp: now + seconds * 1000,
      });
    },
    kvGet: async (key, consume = false) => {
      const entry = ephemeral.get(key);
      if (!entry) return null;
      if (entry.exp <= Date.now()) {
        ephemeral.delete(key);
        return null;
      }
      if (consume) ephemeral.delete(key);
      return structuredClone(entry.value);
    },
    kvDel: async (key) => {
      ephemeral.delete(key);
    },
    close: () => db.close(),
  });
}

export function redisStore({ url, token, prefix = "sudaon:v1" }) {
  if (!url?.startsWith("https://") || !token)
    throw new AppError(503, "클라우드 저장소 설정이 필요합니다.");
  const command = async (...args) => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("redis-http");
      const result = await response.json();
      if (result.error) throw new Error("redis-command");
      return result.result;
    } catch {
      throw new AppError(
        503,
        "기록 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
  };
  const eventsKey = (roomId) => `${prefix}:room:${roomId}:events`;
  const leasesKey = (roomId) => `${prefix}:room:${roomId}:presence`;
  return new EventStore({
    limit: (key, seconds) =>
      command("EVAL", THROTTLE, 1, `${prefix}:limit:${key}`, seconds),
    read: async (roomId, after) =>
      ((await command("LRANGE", eventsKey(roomId), after, -1)) || []).map((e) =>
        JSON.parse(e),
      ),
    append: async (roomId, expected, event) =>
      Boolean(
        await command(
          "EVAL",
          APPEND,
          2,
          eventsKey(roomId),
          `${prefix}:rooms`,
          expected,
          JSON.stringify(event),
          roomId,
        ),
      ),
    ids: () => command("SMEMBERS", `${prefix}:rooms`),
    presence: async (roomId, participantId, remove) => {
      if (remove) {
        await command("ZREM", leasesKey(roomId), participantId);
        return true;
      }
      const now = Date.now();
      if (
        !(await command(
          "EVAL",
          LEASE,
          1,
          leasesKey(roomId),
          now,
          participantId,
          now + 65000,
          200,
        ))
      ) {
        throw new AppError(
          409,
          "채팅방이 가득 찼습니다. 최대 200명이 참여할 수 있습니다.",
        );
      }
      return true;
    },
    members: async (roomId) =>
      (await command("ZRANGEBYSCORE", leasesKey(roomId), Date.now(), "+inf")) ||
      [],
    count: async (roomId) => {
      const list =
        (await command(
          "ZRANGEBYSCORE",
          leasesKey(roomId),
          Date.now(),
          "+inf",
        )) || [];
      return list.filter((k) => !String(k).startsWith("owner:")).length;
    },
    kvSet: async (key, value, seconds = 600) => {
      await command(
        "SET",
        `${prefix}:ephemeral:${key}`,
        JSON.stringify(value),
        "EX",
        seconds,
      );
    },
    kvGet: async (key, consume = false) => {
      const fullKey = `${prefix}:ephemeral:${key}`;
      const raw = await command("GET", fullKey);
      if (!raw) return null;
      if (consume) await command("DEL", fullKey);
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    kvDel: async (key) => {
      await command("DEL", `${prefix}:ephemeral:${key}`);
    },
  });
}
