import express from "express";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import {
  AppError,
  id,
  hash,
  text,
  keywords,
  publicState,
  publicEvent,
} from "./model.mjs";
import { auth as createAuth } from "./auth.mjs";
import { localStore, redisStore } from "./store.mjs";

const safeId = /^[A-Za-z0-9_-]{16}$/;
const loopback = (address) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
const localEnrollmentRequest = (req) => {
  let host;
  try {
    host = new URL(`http://${req.headers.host}`).hostname;
  } catch {
    return false;
  }
  return (
    loopback(req.socket.remoteAddress) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(host) &&
    ![
      "forwarded",
      "x-forwarded-for",
      "cf-connecting-ip",
      "x-forwarded-host",
    ].some((key) => req.headers[key])
  );
};
const sameSecret = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));

export async function createApplication(options = {}) {
  const cloud = options.cloud ?? Boolean(process.env.VERCEL);
  const ownerPassword =
    options.ownerPassword || process.env.SUDAON_OWNER_PASSWORD;
  const configured =
    options.configured ??
    (!cloud ||
      Boolean(
        process.env.SUDAON_SESSION_SECRET?.length >= 32 &&
          ownerPassword?.length >= 12 &&
          process.env.UPSTASH_REDIS_REST_URL &&
          process.env.UPSTASH_REDIS_REST_TOKEN,
      ));
  const store =
    options.store ||
    (configured
      ? cloud
        ? redisStore({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
          })
        : await localStore(options.filename || process.env.SUDAON_DATA_FILE)
      : null);
  const secret = options.secret || process.env.SUDAON_SESSION_SECRET || store?.driver.sessionSecret || randomBytes(32).toString('hex');
  const app = express();
  const server = createServer(app);
  const auth = createAuth(secret, cloud);
  const hub = new Map();
  const publicUrl = options.publicUrl || process.env.SUDAON_PUBLIC_URL || "";
  if (publicUrl && !/^https?:\/\//.test(publicUrl))
    throw new Error("SUDAON_PUBLIC_URL must be an HTTP(S) URL");

  app.disable("x-powered-by");
  if (cloud) app.set("trust proxy", 1);
  app.use((req, res, next) => {
    if (typeof req.query.route === "string") {
      const route = req.query.route;
      const query = new URLSearchParams(req.url.split("?")[1]);
      query.delete("route");
      req.url = `/api/${route}${query.size ? `?${query}` : ""}`;
    }
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    });
    next();
  });
  const allowedOrigin = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true; // Non-browser clients still need authentication.
    try {
      return (
        new URL(origin).host === req.headers.host ||
        (publicUrl && new URL(origin).origin === new URL(publicUrl).origin)
      );
    } catch {
      return false;
    }
  };
  app.use("/api", (req, res, next) => {
    if (!allowedOrigin(req))
      return next(new AppError(403, "이 주소에서는 요청할 수 없습니다."));
    next();
  });
  app.use(express.json({ limit: "8kb" }));
  app.get("/api/health", (req, res) =>
    res.json({
      ok: true,
      configured,
      mode: cloud ? "cloud" : "local",
      realtime: "websocket",
      maxParticipants: 200,
      publicUrl: publicUrl || (cloud ? `https://${req.headers.host}` : ""),
      version: "0.1.0",
    }),
  );
  app.use("/api", (req, res, next) =>
    configured
      ? next()
      : next(
          new AppError(
            503,
            "클라우드 초기 설정이 필요합니다. 발표자 PC의 로컬 앱으로도 사용할 수 있습니다.",
          ),
        ),
  );
  app.get("/api/session", (req, res) =>
    res.json({
      owner: auth.owner(req),
      localEnrollment: !cloud && localEnrollmentRequest(req),
    }),
  );
  app.post("/api/owner/local", (req, res, next) => {
    if (cloud || !localEnrollmentRequest(req))
      return next(new AppError(403, "발표자 PC에서만 사용할 수 있습니다."));
    auth.set(res, "sudaon_owner", { role: "owner" });
    res.json({ ok: true });
  });
  app.post("/api/owner/login", async (req, res, next) => {
    await store.limit(`login:${hash(req.ip || "unknown").slice(0, 24)}`);
    if (!ownerPassword || !sameSecret(req.body?.password, ownerPassword))
      return next(new AppError(401, "발표자 암호를 확인해 주세요."));
    auth.set(res, "sudaon_owner", { role: "owner" });
    res.json({ ok: true });
  });
  app.post("/api/owner/logout", (req, res) => {
    res.clearCookie("sudaon_owner", { path: "/api" });
    res.json({ ok: true });
  });
  app.get("/api/rooms", auth.requireOwner, async (req, res) =>
    res.json((await store.rooms()).sort((a, b) => b.createdAt - a.createdAt)),
  );
  app.post("/api/rooms", auth.requireOwner, async (req, res) => {
    const title = text(req.body?.title, 2, 80, "발표 제목");
    const roomId = id();
    const state = await store.write(
      roomId,
      () => ({
        type: "created",
        data: { id: roomId, title, status: "open", createdAt: Date.now() },
      }),
      { create: true },
    );
    res.status(201).json(publicState(state));
  });

  app.param("roomId", (req, res, next, value) =>
    safeId.test(value)
      ? next()
      : next(new AppError(404, "채팅방을 찾을 수 없습니다.")),
  );
  app.get("/api/rooms/:roomId/info", async (req, res) => {
    const state = await store.state(req.params.roomId);
    res.json({ ...state.room, online: await store.count(req.params.roomId) });
  });
  app.post("/api/rooms/:roomId/join", async (req, res) => {
    const { roomId } = req.params;
    let state = await store.state(roomId);
    if (state.room.status !== "open")
      throw new AppError(410, "종료된 채팅방입니다.");
    const previous = auth.guest(req, roomId);
    const existing = state.participants[previous?.id];
    if (existing?.kicked)
      throw new AppError(403, "이 세션의 참여가 제한되었습니다.");
    if (existing && existing.tokenHash === hash(previous.nonce)) {
      await store.presence(roomId, existing.id);
      return res.json({ ...publicState(state), me: existing.id });
    }
    const nickname = text(req.body?.nickname, 2, 20, "별명");
    const participantId = id();
    const nonce = id();
    await store.presence(roomId, participantId);
    try {
      state = await store.write(roomId, (current) => {
        if (current.room.status !== "open")
          throw new AppError(410, "종료된 채팅방입니다.");
        const duplicates = Object.values(current.participants).filter(
          (p) => p.baseNickname === nickname,
        ).length;
        return {
          type: "joined",
          data: {
            id: participantId,
            nickname: duplicates ? `${nickname} · ${duplicates + 1}` : nickname,
            baseNickname: nickname,
            tokenHash: hash(nonce),
          },
        };
      });
    } catch (error) {
      await store.presence(roomId, participantId, true);
      throw error;
    }
    auth.set(res, `sudaon_guest_${roomId}`, {
      id: participantId,
      roomId,
      nonce,
    });
    res.status(201).json({ ...publicState(state), me: participantId });
  });
  const access = (req, state, audience = false) =>
    !audience && auth.owner(req) ? null : auth.participant(req, state);
  app.get("/api/rooms/:roomId", async (req, res) => {
    const state = await store.state(req.params.roomId);
    const me = access(req, state, req.query.audience === '1');
    res.json({
      ...publicState(state),
      me: me?.id,
      owner: auth.owner(req),
      online: await store.count(req.params.roomId),
    });
  });
  app.get("/api/rooms/:roomId/messages", async (req, res) => {
    const state = await store.state(req.params.roomId);
    access(req, state);
    const before = Number(req.query.before) || Infinity;
    res.json(state.messages.filter((m) => m.seq < before).slice(-100));
  });
  app.post("/api/rooms/:roomId/messages", async (req, res) => {
    const { roomId } = req.params;
    const body = text(req.body?.text, 1, 500, "메시지");
    const requestId = text(req.body?.requestId, 8, 80, "요청 식별자");
    const messageId = id();
    const updated = await store.write(roomId, (state) => {
      if (state.room.status !== "open")
        throw new AppError(410, "종료된 채팅방입니다.");
      const participant = auth.participant(req, state);
      if (
        state.messages.some(
          (m) =>
            m.participantId === participant.id && m.requestId === requestId,
        )
      )
        return null;
      const last = state.messages.findLast(
        (m) => m.participantId === participant.id,
      );
      if (last && Date.now() - last.at < (options.messageInterval ?? 2000))
        throw new AppError(429, "메시지는 2초에 한 번 보낼 수 있습니다.");
      if (state.messages.length >= 50000)
        throw new AppError(
          409,
          "이 방의 기록 용량이 가득 찼습니다. 새 방을 만들어 주세요.",
        );
      return {
        type: "message",
        data: {
          id: messageId,
          participantId: participant.id,
          nickname: participant.nickname,
          text: body,
          requestId,
        },
      };
    });
    res
      .status(201)
      .json(
        updated.messages.find(
          (m) =>
            m.requestId === requestId &&
            m.participantId === auth.guest(req, roomId)?.id,
        ),
      );
  });
  app.post("/api/rooms/:roomId/leave", async (req, res) => {
    const state = await store.state(req.params.roomId);
    const p = auth.participant(req, state);
    await store.presence(req.params.roomId, p.id, true);
    res.json({ ok: true });
  });
  app.delete(
    "/api/rooms/:roomId/messages/:messageId",
    auth.requireOwner,
    async (req, res) => {
      await store.write(req.params.roomId, (state) => {
        if (!state.messages.some((m) => m.id === req.params.messageId))
          throw new AppError(404, "메시지를 찾을 수 없습니다.");
        return { type: "deleted", data: { id: req.params.messageId } };
      });
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/rooms/:roomId/kick/:participantId",
    auth.requireOwner,
    async (req, res) => {
      await store.write(req.params.roomId, (state) => {
        if (!state.participants[req.params.participantId])
          throw new AppError(404, "참여자를 찾을 수 없습니다.");
        return { type: "kicked", data: { id: req.params.participantId } };
      });
      await store.presence(req.params.roomId, req.params.participantId, true);
      res.json({ ok: true });
    },
  );
  app.post("/api/rooms/:roomId/close", auth.requireOwner, async (req, res) => {
    await store.write(req.params.roomId, (state) =>
      state.room.status === "closed" ? null : { type: "closed", data: {} },
    );
    res.json({ ok: true });
  });
  app.put(
    "/api/rooms/:roomId/exclusions",
    auth.requireOwner,
    async (req, res) => {
      const words = text(req.body?.words || " ", 0, 1000, "제외 단어")
        .split(/[\s,]+/u)
        .filter(Boolean)
        .slice(0, 100);
      await store.write(req.params.roomId, () => ({
        type: "exclusions",
        data: { words },
      }));
      res.json({ ok: true });
    },
  );
  app.get(
    "/api/rooms/:roomId/keywords",
    auth.requireOwner,
    async (req, res) => {
      const state = await store.state(req.params.roomId);
      res.json({
        recent: keywords(state),
        all: keywords(state, "all"),
        exclusions: state.exclusions,
        ruleVersion: "ko-suffix-v1",
      });
    },
  );
  app.get("/api/rooms/:roomId/export", auth.requireOwner, async (req, res) => {
    const state = await store.state(req.params.roomId);
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    book.creator = "수다온";
    const summary = book.addWorksheet("발표 요약");
    summary.addRows([
      ["발표 제목", state.room.title],
      [
        "생성 시각 (Asia/Seoul)",
        new Date(state.room.createdAt).toLocaleString("ko-KR", {
          timeZone: "Asia/Seoul",
        }),
      ],
      ["상태", state.room.status],
      ["참여 세션 수", Object.keys(state.participants).length],
      ["공개 메시지 수", state.messages.filter((m) => !m.deleted).length],
    ]);
    const chat = book.addWorksheet("채팅 기록");
    chat.addRow(["순번", "시각 (Asia/Seoul)", "별명", "메시지"]);
    for (const m of state.messages.filter((m) => !m.deleted))
      chat.addRow([
        m.seq,
        new Date(m.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
        m.nickname,
        m.text,
      ]);
    const words = book.addWorksheet("전체 키워드");
    words.addRow(["단어", "언급 메시지 수", "참여 세션 수"]);
    for (const k of keywords(state, "all"))
      words.addRow([k.word, k.count, k.sessions]);
    const rules = book.addWorksheet("집계 기준");
    rules.addRows([
      ["규칙 버전", "ko-suffix-v1"],
      ["범위", "방 전체"],
      ["중복", "한 메시지 안 같은 단어는 1회"],
      ["제외 단어", state.exclusions.join(", ")],
      ["한국어 처리", "조사 제거 휴리스틱. 형태소 분석 아님."],
      ["삭제 메시지", "본문 및 집계에서 제외"],
    ]);
    for (const sheet of book.worksheets) {
      sheet.getRow(1).font = { bold: true };
      sheet.columns.forEach((column, i) => {
        column.width = i === 3 ? 70 : 28;
      });
    }
    res.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sudaon-${state.room.id}.xlsx"`,
    });
    res.send(Buffer.from(await book.xlsx.writeBuffer()));
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", async (req, socket, head) => {
    try {
      if (!configured || !allowedOrigin(req)) throw new AppError(403, "");
      const address = new URL(req.url, "http://localhost");
      const roomId = address.searchParams.get("room");
      if (
        !(
          address.pathname === "/api/socket" ||
          address.searchParams.get("route") === "socket"
        ) ||
        !safeId.test(roomId || "")
      )
        throw new AppError(404, "");
      const state = await store.state(roomId);
      const audience = address.searchParams.get('audience') === '1';
      const participant = access(req, state, audience);
      if (participant && state.room.status === "open")
        await store.presence(roomId, participant.id);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.roomId = roomId;
        ws.participantId = participant?.id;
        ws.owner = !audience && auth.owner(req);
        ws.seq = state.seq;
        ws.alive = true;
        let group = hub.get(roomId);
        if (!group) {
          group = { clients: new Set(), cursor: state.seq };
          hub.set(roomId, group);
        }
        group.clients.add(ws);
        ws.send(
          JSON.stringify({
            type: "snapshot",
            data: {
              ...publicState(state),
              me: participant?.id,
              owner: ws.owner,
            },
          }),
        );
        ws.on("pong", () => {
          ws.alive = true;
        });
        ws.on("error", () => {});
        ws.on("close", () => {
          group.clients.delete(ws);
          if (!group.clients.size) hub.delete(roomId);
        });
      });
    } catch (error) {
      socket.end(
        `HTTP/1.1 ${error.status || 503} Error\r\nConnection: close\r\n\r\n`,
      );
    }
  });
  let polling = false;
  const poll = setInterval(async () => {
    if (polling || !store) return;
    polling = true;
    try {
      await Promise.allSettled(
        [...hub.entries()].map(async ([roomId, group]) => {
          let events;
          try {
            events = await store.driver.read(roomId, group.cursor);
            if (group.failed) {
              for (const ws of group.clients)
                if (ws.readyState === 1)
                  ws.send(JSON.stringify({ type: "serviceReady" }));
              group.failed = false;
            }
          } catch {
            if (!group.failed)
              for (const ws of group.clients)
                if (ws.readyState === 1)
                  ws.send(
                    JSON.stringify({
                      type: "serviceError",
                      data: "기록 서버 연결이 지연되고 있습니다. 자동으로 복구를 시도합니다.",
                    }),
                  );
            group.failed = true;
            return;
          }
          for (const event of events) {
            const payload = JSON.stringify({
              type: "event",
              data: publicEvent(event),
            });
            for (const ws of group.clients) {
              if (ws.readyState !== 1 || event.seq <= ws.seq) continue;
              if (ws.bufferedAmount > 1024 * 1024) {
                ws.close(1013, "연결을 다시 시도해 주세요.");
                continue;
              }
              ws.send(payload);
              ws.seq = event.seq;
              if (event.type === "kicked" && event.data.id === ws.participantId)
                ws.close(4003, "참여가 제한되었습니다.");
            }
            group.cursor = event.seq;
          }
        }),
      );
    } finally {
      polling = false;
    }
  }, options.pollInterval || (cloud ? 500 : 200));
  let metadataPolling = false;
  const metadata = setInterval(async () => {
    if (!store || metadataPolling) return;
    metadataPolling = true;
    try {
      await Promise.allSettled(
        [...hub.entries()].map(async ([roomId, group]) => {
          const online = await store.count(roomId);
          let keywordData;
          if ([...group.clients].some((ws) => ws.owner)) {
            const state = await store.state(roomId);
            keywordData = {
              recent: keywords(state),
              all: keywords(state, "all"),
              exclusions: state.exclusions,
            };
          }
          for (const ws of group.clients)
            if (ws.readyState === 1)
              ws.send(
                JSON.stringify({
                  type: "metadata",
                  data: { online, ...(ws.owner ? keywordData : {}) },
                }),
              );
        }),
      );
    } finally {
      metadataPolling = false;
    }
  }, 3000);
  const heartbeat = setInterval(async () => {
    for (const [roomId, group] of hub)
      for (const ws of group.clients) {
        if (!ws.alive) {
          ws.terminate();
          continue;
        }
        ws.alive = false;
        ws.ping();
        if (ws.participantId)
          store
            .presence(roomId, ws.participantId)
            .catch(() => ws.close(4003, "다시 입장해 주세요."));
      }
  }, 25000);
  for (const timer of [poll, metadata, heartbeat]) timer.unref();

  app.use("/api", (req, res, next) =>
    next(new AppError(404, "요청을 찾을 수 없습니다.")),
  );
  app.use((error, req, res, next) => {
    if (!req.path.startsWith("/api")) return next(error);
    const status = error.status || 500;
    res
      .status(status)
      .json({
        error:
          status >= 500 && !(error instanceof AppError)
            ? "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
            : error.message,
      });
  });
  const close = async () => {
    for (const timer of [poll, metadata, heartbeat]) clearInterval(timer);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise((resolve) =>
      server.listening ? server.close(resolve) : resolve(),
    );
    await store?.close();
  };
  return { app, server, store, close, auth };
}
