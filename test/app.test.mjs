import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import ExcelJS from "exceljs";
import { createApplication } from "../server/app.mjs";
import { keywords, tokens } from "../server/model.mjs";
import { localStore } from "../server/store.mjs";
import { cloudConfiguration } from "../server/config.mjs";

const cookie = (response) =>
  response.headers.get("set-cookie")?.split(";")[0] || "";
async function setup(options = {}) {
  const instance = await createApplication({
    filename: ":memory:",
    messageInterval: 0,
    pollInterval: 30,
    ...options,
  });
  await new Promise((resolve) =>
    instance.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const request = async (
    path,
    { method = "GET", body, token = "", headers = {} } = {},
  ) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Cookie: token } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const owner = cookie(await request("/owner/local", { method: "POST" }));
  return { ...instance, base, request, owner };
}

test("QR room flow: permissions, distinct sessions, live fanout, dedupe, deletion, kick and close", async (t) => {
  const app = await setup();
  t.after(() => app.close());
  assert.equal((await app.request("/rooms")).status, 401);
  assert.equal(
    (
      await app.request("/owner/local", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await app.request("/owner/local", {
        method: "POST",
        headers: { "X-Forwarded-For": "203.0.113.1" },
      })
    ).status,
    403,
  );
  const created = await app.request("/rooms", {
    method: "POST",
    token: app.owner,
    body: { title: "새로운 아이디어 발표" },
  });
  assert.equal(created.status, 201);
  const room = (await created.json()).room;
  const joinGuest = () =>
    app.request(`/rooms/${room.id}/join`, {
      method: "POST",
      body: { nickname: "청중" },
    });
  const first = await joinGuest(),
    second = await joinGuest();
  const token1 = cookie(first),
    token2 = cookie(second);
  const firstData = await first.json(),
    secondData = await second.json();
  assert.notEqual(firstData.me, secondData.me);
  assert.equal(secondData.participants[1].nickname, "청중 · 2");
  assert.ok(!JSON.stringify(firstData).includes("tokenHash"));
  assert.equal((await app.request(`/rooms/${room.id}`)).status, 403);
  const ws = new WebSocket(
    `${app.base.replace("http", "ws")}/api/socket?room=${room.id}`,
    { headers: { Cookie: token2 } },
  );
  const events = [];
  ws.on("message", (data) => events.push(JSON.parse(data)));
  await once(ws, "open");
  const body = {
    text: "데이터가 데이터가 중요합니다. 실습은?",
    requestId: "retry-fixture-0001",
  };
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/messages`, {
        method: "POST",
        token: token1,
        body,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/messages`, {
        method: "POST",
        token: token1,
        body,
      })
    ).status,
    201,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    events.filter((e) => e.type === "event" && e.data.type === "message")
      .length,
    1,
  );
  const snapshot = await (
    await app.request(`/rooms/${room.id}`, { token: token1 })
  ).json();
  assert.equal(snapshot.messages.length, 1);
  assert.ok(!JSON.stringify(events).includes("tokenHash"));
  const meta = await (
    await app.request(`/rooms/${room.id}/keywords`, { token: app.owner })
  ).json();
  assert.equal(meta.all.find((k) => k.word === "데이터").count, 1);
  assert.equal(
    (
      await app.request(
        `/rooms/${room.id}/messages/${snapshot.messages[0].id}`,
        { method: "DELETE", token: token1 },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await app.request(
        `/rooms/${room.id}/messages/${snapshot.messages[0].id}`,
        { method: "DELETE", token: app.owner },
      )
    ).status,
    200,
  );
  const deleted = await (
    await app.request(`/rooms/${room.id}`, { token: token2 })
  ).json();
  assert.equal(deleted.messages[0].text, "");
  assert.deepEqual(
    (
      await (
        await app.request(`/rooms/${room.id}/keywords`, { token: app.owner })
      ).json()
    ).all,
    [],
  );
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/kick/${secondData.me}`, {
        method: "POST",
        token: app.owner,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/messages`, {
        method: "POST",
        token: token2,
        body: { text: "재입장", requestId: "retry-fixture-0002" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/join`, {
        method: "POST",
        token: token2,
        body: { nickname: "다른 별명" },
      })
    ).status,
    403,
  );
  await app.request(`/rooms/${room.id}/close`, {
    method: "POST",
    token: app.owner,
  });
  assert.equal((await joinGuest()).status, 410);
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/messages`, {
        method: "POST",
        token: token1,
        body: { text: "종료 뒤", requestId: "retry-fixture-0003" },
      })
    ).status,
    410,
  );
  ws.close();
});

test("active admission allows 200 audience slots plus owner, rejects 201st, releases explicit leave", async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const { room } = await (
    await app.request("/rooms", {
      method: "POST",
      token: app.owner,
      body: { title: "200명 정원 검사" },
    })
  ).json();
  let firstCookie;
  for (let n = 0; n < 200; n++) {
    const response = await app.request(`/rooms/${room.id}/join`, {
      method: "POST",
      body: { nickname: `참여자${n}` },
    });
    assert.equal(response.status, 201);
    if (n === 0) firstCookie = cookie(response);
  }
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/join`, {
        method: "POST",
        body: { nickname: "정원초과" },
      })
    ).status,
    409,
  );
  assert.equal(
    (await app.request(`/rooms/${room.id}`, { token: app.owner })).status,
    200,
  );
  await app.request(`/rooms/${room.id}/leave`, {
    method: "POST",
    token: firstCookie,
  });
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/join`, {
        method: "POST",
        body: { nickname: "새로운청중" },
      })
    ).status,
    201,
  );
});

test("reconnection restores missed history, query rewrite keeps pagination, login attempts are throttled", async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const { room } = await (
    await app.request("/rooms", {
      method: "POST",
      token: app.owner,
      body: { title: "재연결과 라우팅" },
    })
  ).json();
  const joined = await app.request(`/rooms/${room.id}/join`, {
    method: "POST",
    body: { nickname: "복구청중" },
  });
  const token = cookie(joined);
  for (let n = 0; n < 3; n++)
    await app.request(`/rooms/${room.id}/messages`, {
      method: "POST",
      token,
      body: { text: `메시지 ${n}`, requestId: `reconnect-fixture-${n}` },
    });
  const page = await (
    await app.request(`/server?route=rooms/${room.id}/messages&before=5`, {
      token,
    })
  ).json();
  assert.equal(page.length, 2);
  const ws = new WebSocket(
    `${app.base.replace("http", "ws")}/api/socket?room=${room.id}`,
    { headers: { Cookie: token } },
  );
  const [payload] = await once(ws, "message");
  const snapshot = JSON.parse(payload);
  assert.equal(snapshot.type, "snapshot");
  assert.equal(snapshot.data.messages.length, 3);
  ws.close();
  for (let n = 0; n < 8; n++)
    assert.equal(
      (
        await app.request("/owner/login", {
          method: "POST",
          body: { password: "incorrect-fixture" },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await app.request("/owner/login", {
        method: "POST",
        body: { password: "incorrect-fixture" },
      })
    ).status,
    429,
  );
});

test("Excel is a real workbook, user formulas stay strings, deleted body is excluded", async (t) => {
  const app = await setup();
  t.after(() => app.close());
  const { room } = await (
    await app.request("/rooms", {
      method: "POST",
      token: app.owner,
      body: { title: "엑셀 파일 검증" },
    })
  ).json();
  const participant = await app.request(`/rooms/${room.id}/join`, {
    method: "POST",
    body: { nickname: "엑셀청중" },
  });
  const token = cookie(participant);
  const message = await (
    await app.request(`/rooms/${room.id}/messages`, {
      method: "POST",
      token,
      body: {
        text: '=HYPERLINK("https://example.com")',
        requestId: "excel-formula-01",
      },
    })
  ).json();
  const response = await app.request(`/rooms/${room.id}/export`, {
    token: app.owner,
  });
  assert.match(response.headers.get("content-type"), /spreadsheetml/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(book.worksheets.length, 4);
  assert.equal(
    book.getWorksheet("채팅 기록").getCell("D2").type,
    ExcelJS.ValueType.String,
  );
  assert.equal(
    book.getWorksheet("채팅 기록").getCell("D2").value,
    '=HYPERLINK("https://example.com")',
  );
  await app.request(`/rooms/${room.id}/messages/${message.id}`, {
    method: "DELETE",
    token: app.owner,
  });
  const after = await app.request(`/rooms/${room.id}/export`, {
    token: app.owner,
  });
  await book.xlsx.load(Buffer.from(await after.arrayBuffer()));
  assert.equal(book.getWorksheet("채팅 기록").rowCount, 1);
});

test("SQLite event log survives restart, interleaved store writes do not lose updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sudaon-store-"));
  const filename = join(directory, "test.sqlite");
  const first = await localStore(filename),
    second = await localStore(filename);
  const roomId = "1234567890abcdef";
  try {
    await first.write(
      roomId,
      () => ({
        type: "created",
        data: { id: roomId, title: "저장 검증", status: "open" },
      }),
      { create: true },
    );
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? first : second).write(roomId, (state) => ({
          type: "message",
          data: { id: `m${i}`, text: "안녕하세요", participantId: "test" },
        })),
      ),
    );
    assert.equal((await first.state(roomId)).messages.length, 20);
    await first.close();
    await second.close();
    const restored = await localStore(filename);
    assert.equal((await restored.state(roomId)).messages.length, 20);
    await restored.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keyword window expiration, duplicate words, exclusions and session counts", () => {
  const now = Date.now();
  const state = {
    exclusions: ["제외"],
    messages: [
      { text: "데이터 데이터 실습은 제외", at: now, participantId: "a" },
      { text: "데이터가 실습을", at: now - 1000, participantId: "b" },
      { text: "지난시간", at: now - 300001, participantId: "c" },
      { text: "삭제된단어", at: now, participantId: "a", deleted: true },
    ],
  };
  assert.equal(
    keywords(state, "recent", now).find((k) => k.word === "데이터").count,
    2,
  );
  assert.equal(
    keywords(state, "recent", now).find((k) => k.word === "데이터").sessions,
    2,
  );
  assert.ok(
    !keywords(state, "recent", now).some((k) =>
      ["제외", "지난시간", "삭제된단어"].includes(k.word),
    ),
  );
  assert.ok(keywords(state, "all", now).some((k) => k.word === "지난시간"));
  assert.deepEqual(tokens("THE and 123 https://example.com"), []);
});

test("cloud without persistent configuration refuses writes rather than pretending to be online", async (t) => {
  const app = await setup({ cloud: true, configured: false });
  t.after(() => app.close());
  const health = await (await app.request("/health")).json();
  assert.equal(health.configured, false);
  assert.deepEqual(Object.keys(health.setup).sort(), ["ownerPassword", "sessionSecret", "storage"]);
  assert.ok(Object.values(health.setup).every((value) => typeof value === "boolean"));
  assert.equal(
    (
      await app.request("/rooms", {
        method: "POST",
        body: { title: "저장되지 않을 방" },
      })
    ).status,
    503,
  );
});

test("cloud setup accepts Marketplace pairs without mixing partial credentials", () => {
  const env = {
    SUDAON_OWNER_PASSWORD: "test-only-owner-password",
    SUDAON_SESSION_SECRET: "test-only-session-secret-32-characters",
    KV_REST_API_URL: "https://marketplace.example.invalid",
    KV_REST_API_TOKEN: "test-only-marketplace-token",
    UPSTASH_REDIS_REST_URL: "https://partial.example.invalid",
  };
  const result = cloudConfiguration(env);
  assert.equal(result.configured, true);
  assert.equal(result.redis.url, env.KV_REST_API_URL);
  assert.equal(result.redis.token, env.KV_REST_API_TOKEN);
  const incomplete = cloudConfiguration({ ...env, KV_REST_API_TOKEN: undefined });
  assert.equal(incomplete.configured, false);
  assert.equal(incomplete.setup.storage, false);
  assert.equal(cloudConfiguration({ ...env, SUDAON_OWNER_PASSWORD: "short" }).configured, false);
  assert.equal(cloudConfiguration({ ...env, SUDAON_SESSION_SECRET: "short" }).configured, false);
});
