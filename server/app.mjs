import express from "express";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import {
  AppError,
  id,
  hash,
  text,
  multilineText,
  detectDevice,
  summarizePoll,
  spinDart,
  drawLots,
  generateLadder,
  keywords,
  activityRanking,
  publicState,
  publicEvent,
} from "./model.mjs";
import { auth as createAuth } from "./auth.mjs";
import { localStore, redisStore } from "./store.mjs";
import { cloudConfiguration } from "./config.mjs";
import { createAiService, extractAiPrompt } from "./ai.mjs";
import { createMailService } from "./mail.mjs";

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

function sanitizeTheme(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mode = ["default", "solid", "gradient", "preset", "image"].includes(
    raw.mode,
  )
    ? raw.mode
    : "default";
  const str = (v, max = 120) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const num = (v, min, max, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    mode,
    color: str(raw.color, 32) || "#eef3ea",
    gradientId: str(raw.gradientId, 40) || "sage-mist",
    gradient: str(raw.gradient, 180) || "",
    presetId: str(raw.presetId, 40) || "forest",
    panelOpacity: num(raw.panelOpacity, 0, 100, 50),
    overlayOpacity: num(raw.overlayOpacity, 0, 85, 25),
    overlayTone: raw.overlayTone === "light" ? "light" : "dark",
    bgFit: ["cover", "contain"].includes(raw.bgFit) ? raw.bgFit : "cover",
    bgPosX: num(raw.bgPosX, 0, 100, 50),
    bgPosY: num(raw.bgPosY, 0, 100, 50),
  };
}

export async function createApplication(options = {}) {
  const cloud = options.cloud ?? Boolean(process.env.VERCEL);
  const configuration = cloudConfiguration();
  const ownerPassword =
    options.ownerPassword || process.env.SUDAON_OWNER_PASSWORD;
  const configured = options.configured ?? (!cloud || configuration.configured);
  const store =
    options.store ||
    (configured
      ? cloud
        ? redisStore(configuration.redis)
        : await localStore(options.filename || process.env.SUDAON_DATA_FILE)
      : null);
  const secret =
    options.secret ||
    process.env.SUDAON_SESSION_SECRET ||
    store?.driver.sessionSecret ||
    randomBytes(32).toString("hex");
  const app = express();
  const server = createServer(app);
  const auth = createAuth(secret, cloud);
  const ai = createAiService({ adapter: options.aiAdapter });
  const mail = createMailService({
    adapter: options.mailAdapter,
    env: options.env,
  });
  const hub = new Map();
  const occupiedRooms = new Set();
  const ownerDevices = new Map();
  const disconnectTimers = new Map();
  const autoCloseTimers = new Map();
  const presenceBroadcastTimers = new Map();
  const disconnectGraceMs = options.disconnectGraceMs ?? 8000;
  const autoCloseGraceMs = options.autoCloseGraceMs ?? 10000;

  const publicUrl = options.publicUrl || process.env.SUDAON_PUBLIC_URL || "";
  if (publicUrl && !/^https?:\/\//.test(publicUrl))
    throw new Error("SUDAON_PUBLIC_URL must be an HTTP(S) URL");

  const clearTimer = (map, key) => {
    const t = map.get(key);
    if (t) {
      clearTimeout(t);
      map.delete(key);
    }
  };

  const resolveActor = (req, state, audience = false) => {
    const guestData = auth.guest(req, state.room.id);
    if (guestData || audience) {
      const p = auth.participant(req, state);
      if (p.left)
        throw new AppError(403, "퇴장한 채팅방입니다. 다시 입장해 주세요.");
      return {
        id: p.id,
        nickname: p.nickname,
        role: "guest",
        device: p.device || detectDevice(req.headers["user-agent"]),
        participant: p,
      };
    }
    if (auth.owner(req)) {
      return {
        id: "owner",
        nickname: "관리자",
        role: "owner",
        device:
          ownerDevices.get(state.room.id) ||
          detectDevice(req.headers["user-agent"]),
        participant: null,
      };
    }
    throw new AppError(403, "입장이 필요하거나 참여가 제한된 세션입니다.");
  };

  const buildOnlineSnapshot = async (roomId, stateOverride = null) => {
    if (!store) {
      return {
        online: 0,
        onlineTotal: 0,
        activeOnlineCount: 0,
        awayCount: 0,
        onlineParticipants: [],
        readCursors: {},
      };
    }
    const state = stateOverride || (await store.state(roomId));
    const [memberKeys, mstates] = await Promise.all([
      store.members(roomId),
      store.memberStates(roomId),
    ]);
    const memberKeySet = new Set(memberKeys.map(String));
    const group = hub.get(roomId);
    const wsOwnerOnline = group
      ? [...group.clients].some(
          (ws) => ws.owner && !ws.displayOnly && ws.readyState === 1,
        )
      : false;
    const wsParticipantIds = new Set(
      group
        ? [...group.clients]
            .filter((ws) => ws.participantId && ws.readyState === 1)
            .map((ws) => ws.participantId)
        : [],
    );
    const ownerHasLease = memberKeys.some((k) =>
      String(k).startsWith("owner:"),
    );
    const onlineParticipants = [];
    if (state.room.status === "open") {
      if (wsOwnerOnline || ownerHasLease || mstates.owner) {
        const ownerLive = wsOwnerOnline || ownerHasLease;
        onlineParticipants.push({
          id: "owner",
          nickname: "관리자",
          role: "owner",
          device: ownerDevices.get(roomId) || "pc",
          status:
            ownerLive && mstates.owner?.status !== "away" ? "online" : "away",
          readSeq: Number(mstates.owner?.readSeq) || 0,
        });
      }
      const inRoomGuests = Object.values(state.participants || {})
        .filter((p) => p && !p.kicked && !p.left)
        .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
      for (const p of inRoomGuests) {
        const hasLiveConn =
          memberKeySet.has(p.id) || wsParticipantIds.has(p.id);
        const effectiveStatus =
          hasLiveConn && mstates[p.id]?.status !== "away" ? "online" : "away";
        onlineParticipants.push({
          id: p.id,
          nickname: p.nickname,
          role: "guest",
          device: p.device || "pc",
          status: effectiveStatus,
          readSeq: Number(mstates[p.id]?.readSeq) || 0,
        });
      }
    }
    const readCursors = Object.fromEntries(
      onlineParticipants.map((u) => [u.id, u.readSeq ?? 0]),
    );
    const activeOnlineCount = onlineParticipants.filter(
      (u) => u.status === "online",
    ).length;
    const awayCount = onlineParticipants.length - activeOnlineCount;
    const online = await store.count(roomId);
    return {
      online,
      onlineTotal: onlineParticipants.length,
      activeOnlineCount,
      awayCount,
      onlineParticipants,
      readCursors,
    };
  };

  const flushRoomEvents = async (roomId) => {
    const group = hub.get(roomId);
    if (!group || !store) return;
    try {
      const events = await store.driver.read(roomId, group.cursor);
      for (const event of events) {
        for (const ws of group.clients) {
          if (ws.readyState !== 1 || event.seq <= ws.seq) continue;
          if (ws.bufferedAmount > 1024 * 1024) {
            ws.close(1013, "연결을 다시 시도해 주세요.");
            continue;
          }
          const viewerId = ws.participantId || (ws.owner ? "owner" : null);
          const payload = JSON.stringify({
            type: "event",
            data: publicEvent(event, { viewerId, isOwner: ws.owner }),
          });
          ws.send(payload);
          ws.seq = event.seq;
          if (event.type === "kicked" && event.data.id === ws.participantId)
            ws.close(4003, "참여가 제한되었습니다.");
        }
        group.cursor = event.seq;
      }
    } catch {}
  };

  const broadcastMetadata = async (roomId) => {
    const group = hub.get(roomId);
    if (!group || !store) return;
    try {
      const state = await store.state(roomId);
      const presenceInfo = await buildOnlineSnapshot(roomId, state);
      const now = Date.now();
      const keywordData = {
        recent: keywords(state, "recent", now),
        all: keywords(state, "all", now),
        activityRecent: activityRanking(
          state,
          "recent",
          now,
          presenceInfo.onlineParticipants,
        ),
        activityAll: activityRanking(
          state,
          "all",
          now,
          presenceInfo.onlineParticipants,
        ),
        exclusions: state.exclusions,
      };
      const payload = JSON.stringify({
        type: "metadata",
        data: { ...presenceInfo, ...keywordData },
      });
      for (const ws of group.clients) {
        if (ws.readyState === 1) ws.send(payload);
      }
    } catch {}
  };

  const schedulePresenceBroadcast = (roomId, delayMs = 60) => {
    if (presenceBroadcastTimers.has(roomId)) return;
    const timer = setTimeout(async () => {
      presenceBroadcastTimers.delete(roomId);
      await broadcastMetadata(roomId);
    }, delayMs);
    timer.unref?.();
    presenceBroadcastTimers.set(roomId, timer);
  };

  const broadcastRoomSignal = (roomId, type, data) => {
    const group = hub.get(roomId);
    if (!group) return;
    const payload = JSON.stringify({ type, data });
    for (const ws of group.clients) {
      if (ws.readyState === 1) ws.send(payload);
    }
  };

  const scheduleAutoCloseCheck = async (roomId) => {
    if (!store || !occupiedRooms.has(roomId)) return;
    try {
      const state = await store.state(roomId);
      if (state.room.status !== "open") {
        clearTimer(autoCloseTimers, roomId);
        return;
      }
      const hasUnleftParticipants = Object.values(
        state.participants || {},
      ).some((p) => p && !p.left && !p.kicked);
      const members = await store.members(roomId);
      const group = hub.get(roomId);
      const activeSockets = group
        ? [...group.clients].filter(
            (ws) => ws.readyState === 1 && !ws.displayOnly,
          ).length
        : 0;
      if (hasUnleftParticipants || members.length > 0 || activeSockets > 0) {
        clearTimer(autoCloseTimers, roomId);
        return;
      }
      if (autoCloseTimers.has(roomId)) return;
      const timer = setTimeout(async () => {
        autoCloseTimers.delete(roomId);
        try {
          const currentState = await store.state(roomId);
          const stillUnleft = Object.values(
            currentState.participants || {},
          ).some((p) => p && !p.left && !p.kicked);
          const currentMembers = await store.members(roomId);
          const currentGroup = hub.get(roomId);
          const currentSockets = currentGroup
            ? [...currentGroup.clients].filter(
                (ws) => ws.readyState === 1 && !ws.displayOnly,
              ).length
            : 0;
          if (stillUnleft || currentMembers.length > 0 || currentSockets > 0)
            return;
          await store.write(roomId, (st) =>
            st.room.status === "closed"
              ? null
              : { type: "closed", data: { reason: "auto_empty" } },
          );
          await flushRoomEvents(roomId);
          await broadcastMetadata(roomId);
          occupiedRooms.delete(roomId);
        } catch {}
      }, autoCloseGraceMs);
      timer.unref?.();
      autoCloseTimers.set(roomId, timer);
    } catch {}
  };

  const triggerAiReply = (roomId, prompt, sender, replyToId) => {
    (async () => {
      broadcastRoomSignal(roomId, "aiStatus", {
        thinking: true,
        requestedBy: sender.nickname,
      });
      try {
        const state = await store.state(roomId);
        if (state.room.status !== "open") return;
        const result = await ai.ask({
          roomId,
          prompt,
          state,
          sender,
          env: options.env || process.env,
        });
        await store.write(roomId, (st) => {
          if (st.room.status !== "open") return null;
          return {
            type: "message",
            data: {
              id: id(),
              participantId: "ai",
              nickname: "수다온 AI",
              role: "ai",
              device: "ai",
              provider: result.provider,
              model: result.model,
              replyTo: replyToId || null,
              text: result.text,
              requestId: `ai-${replyToId || id()}`,
            },
          };
        });
        await flushRoomEvents(roomId);
      } catch (err) {
        broadcastRoomSignal(roomId, "aiError", {
          error:
            err instanceof AppError
              ? err.message
              : "AI 응답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        });
      } finally {
        broadcastRoomSignal(roomId, "aiStatus", { thinking: false });
      }
    })();
  };

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
  app.use(express.json({ limit: "64kb" }));
  app.get("/api/health", (req, res) =>
    res.json({
      ok: true,
      configured,
      ...(!configured && cloud ? { setup: configuration.setup } : {}),
      mode: cloud ? "cloud" : "local",
      realtime: "websocket",
      maxParticipants: 200,
      publicUrl: publicUrl || (cloud ? `https://${req.headers.host}` : ""),
      version: "0.2.0",
      features: {
        ai: ai.configuration(options.env || process.env),
        email: mail.configuration(options.env || process.env),
        desktopDownloadUrl:
          (options.env || process.env).SUDAON_DESKTOP_DOWNLOAD_URL ||
          "https://github.com/dalbitfox/sudaon/releases/latest/download/SudaOn-Setup.exe",
        desktopProtocol: "sudaon",
      },
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
    res.status(201).json(publicState(state, { viewerId: "owner", isOwner: true }));
  });

  app.param("roomId", (req, res, next, value) =>
    safeId.test(value)
      ? next()
      : next(new AppError(404, "채팅방을 찾을 수 없습니다.")),
  );
  app.get("/api/rooms/:roomId/info", async (req, res) => {
    const state = await store.state(req.params.roomId);
    const presenceInfo = await buildOnlineSnapshot(req.params.roomId, state);
    res.json({
      ...state.room,
      online: presenceInfo.online,
      onlineTotal: presenceInfo.onlineTotal,
      roomTheme: state.roomTheme || null,
    });
  });
  app.post("/api/rooms/:roomId/join", async (req, res) => {
    const { roomId } = req.params;
    let state = await store.state(roomId);
    if (state.room.status !== "open")
      throw new AppError(410, "종료된 채팅방입니다.");
    const device = detectDevice(req.headers["user-agent"], req.body?.device);
    const previous = auth.guest(req, roomId);
    const existing = state.participants[previous?.id];
    if (existing?.kicked)
      throw new AppError(403, "이 세션의 참여가 제한되었습니다.");
    clearTimer(autoCloseTimers, roomId);
    occupiedRooms.add(roomId);
    if (existing && existing.tokenHash === hash(previous.nonce)) {
      const wasLeft = Boolean(existing.left);
      clearTimer(disconnectTimers, `${roomId}:${existing.id}`);
      await store.presence(roomId, existing.id);
      if (wasLeft) {
        state = await store.write(roomId, (current) => {
          if (current.room.status !== "open")
            throw new AppError(410, "종료된 채팅방입니다.");
          return {
            type: "joined",
            data: { ...existing, device, left: false },
          };
        });
        await flushRoomEvents(roomId);
      }
      await store.memberStateSet(roomId, existing.id, {
        status: "online",
        ...(wasLeft ? { readSeq: state.seq } : {}),
      });
      await broadcastMetadata(roomId);
      const presenceInfo = await buildOnlineSnapshot(roomId, state);
      return res.json({
        ...publicState(state, { viewerId: existing.id }),
        me: existing.id,
        online: presenceInfo.online,
        onlineTotal: presenceInfo.onlineTotal,
        activeOnlineCount: presenceInfo.activeOnlineCount,
        awayCount: presenceInfo.awayCount,
        onlineParticipants: presenceInfo.onlineParticipants,
        readCursors: presenceInfo.readCursors,
      });
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
            device,
            tokenHash: hash(nonce),
          },
        };
      });
    } catch (error) {
      await store.presence(roomId, participantId, true);
      throw error;
    }
    await store.memberStateSet(roomId, participantId, {
      status: "online",
      readSeq: state.seq,
    });
    auth.set(res, `sudaon_guest_${roomId}`, {
      id: participantId,
      roomId,
      nonce,
    });
    await flushRoomEvents(roomId);
    await broadcastMetadata(roomId);
    const presenceInfo = await buildOnlineSnapshot(roomId, state);
    res.status(201).json({
      ...publicState(state, { viewerId: participantId }),
      me: participantId,
      online: presenceInfo.online,
      onlineTotal: presenceInfo.onlineTotal,
      activeOnlineCount: presenceInfo.activeOnlineCount,
      awayCount: presenceInfo.awayCount,
      onlineParticipants: presenceInfo.onlineParticipants,
      readCursors: presenceInfo.readCursors,
    });
  });

  const access = (req, state, audience = false, explicitDisplayToken = "") =>
    !audience &&
    (auth.owner(req) || auth.display(req, state.room.id, explicitDisplayToken))
      ? null
      : auth.participant(req, state);

  const normalizedIpKey = (req) => {
    const raw = String(req.ip || "unknown").trim();
    const cleaned = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(raw)
      ? "loopback"
      : raw.replace(/^::ffff:/, "");
    return hash(`pending-ip:${cleaned}`).slice(0, 32);
  };

  app.post(
    "/api/rooms/:roomId/display-token",
    auth.requireOwner,
    async (req, res) => {
      const state = await store.state(req.params.roomId);
      const token = auth.sign({
        role: "display",
        roomId: state.room.id,
      });
      const launchId = String(req.body?.launchId || "")
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 64);
      const opts = req.body?.options;
      if (launchId || (opts && typeof opts === "object")) {
        const reqOrigin =
          (typeof opts?.origin === "string" &&
            /^https?:\/\//.test(opts.origin) &&
            opts.origin.replace(/\/$/, "")) ||
          publicUrl ||
          `${cloud ? "https" : "http"}://${req.headers.host}`;
        await store.kvSet(
          `pending-launch:${normalizedIpKey(req)}`,
          {
            action: "display",
            targetOrigin: reqOrigin,
            roomId: state.room.id,
            layout: opts?.layout === "combined" ? "combined" : "split",
            opacity: Math.min(100, Math.max(15, Number(opts?.opacity) || 85)),
            font: Math.min(36, Math.max(16, Number(opts?.font) || 20)),
            top: opts?.topChat !== false,
            topChat: opts?.topChat !== false,
            topKeywords: opts?.topKeywords !== false,
            dt: token,
            launchId,
            createdAt: Date.now(),
          },
          600,
        );
      }
      if (launchId) {
        await store.kvSet(
          `launch-ack:${launchId}`,
          { status: "pending", roomId: state.room.id, at: Date.now() },
          600,
        );
      }
      res.json({ ok: true, roomId: state.room.id, token, launchId });
    },
  );

  app.get("/api/desktop/pending-launch", async (req, res) => {
    if (req.headers["x-sudaon-desktop"] !== "1") {
      throw new AppError(400, "데스크톱 앱 전용 요청입니다.");
    }
    const ipKey = normalizedIpKey(req);
    await store.limit(`desktop-pending:${ipKey}`, 30, 60);
    const launch = await store.kvGet(`pending-launch:${ipKey}`, true);
    res.json({ ok: true, launch: launch || null });
  });

  app.get(
    "/api/rooms/:roomId/display-ack",
    auth.requireOwner,
    async (req, res) => {
      const launchId = String(req.query.launchId || "")
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 64);
      if (!launchId) return res.json({ ok: true, connected: false });
      const ack = await store.kvGet(`launch-ack:${launchId}`, false);
      res.json({
        ok: true,
        connected: Boolean(
          ack && ack.roomId === req.params.roomId && ack.status === "connected",
        ),
      });
    },
  );

  app.post("/api/rooms/:roomId/display-session", async (req, res) => {
    const { roomId } = req.params;
    await store.state(roomId);
    const token = String(req.body?.token || "");
    if (!auth.display(req, roomId, token)) {
      throw new AppError(401, "유효하지 않은 표시창 실행 토큰입니다.");
    }
    auth.set(res, `sudaon_display_${roomId}`, {
      role: "display",
      roomId,
    });
    const launchId = String(req.body?.launchId || "")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 64);
    await store.kvDel(`pending-launch:${normalizedIpKey(req)}`);
    if (launchId) {
      await store.kvSet(
        `launch-ack:${launchId}`,
        { status: "connected", roomId, at: Date.now() },
        600,
      );
    }
    broadcastRoomSignal(roomId, "displayConnected", { roomId, launchId });
    res.json({ ok: true });
  });

  app.get("/api/rooms/:roomId", async (req, res) => {
    const state = await store.state(req.params.roomId);
    const audience = req.query.audience === "1";
    const me = access(req, state, audience);
    const isOwner = !audience && auth.owner(req);
    const viewerId = me?.id || (isOwner ? "owner" : null);
    const presenceInfo = await buildOnlineSnapshot(req.params.roomId, state);
    res.json({
      ...publicState(state, { viewerId, isOwner }),
      me: me?.id || (isOwner ? "owner" : undefined),
      owner: isOwner,
      online: presenceInfo.online,
      onlineTotal: presenceInfo.onlineTotal,
      activeOnlineCount: presenceInfo.activeOnlineCount,
      awayCount: presenceInfo.awayCount,
      onlineParticipants: presenceInfo.onlineParticipants,
      readCursors: presenceInfo.readCursors,
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
    const body = multilineText(req.body?.text, 1, 500, "메시지");
    const requestId = text(req.body?.requestId, 8, 80, "요청 식별자");
    const messageId = id();
    let actorInfo = null;
    const updated = await store.write(roomId, (state) => {
      if (state.room.status !== "open")
        throw new AppError(410, "종료된 채팅방입니다.");
      const actor = resolveActor(req, state, req.query.audience === "1");
      actorInfo = actor;
      if (
        state.messages.some(
          (m) => m.participantId === actor.id && m.requestId === requestId,
        )
      )
        return null;
      const last = state.messages.findLast(
        (m) => m.participantId === actor.id && m.role !== "ai",
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
          participantId: actor.id,
          nickname: actor.nickname,
          role: actor.role,
          device: actor.device,
          text: body,
          requestId,
        },
      };
    });
    await flushRoomEvents(roomId);
    const savedMsg = updated.messages.find(
      (m) => m.requestId === requestId && m.participantId === actorInfo?.id,
    );
    if (actorInfo && savedMsg?.seq) {
      const leaseKey = actorInfo.id === "owner" ? "owner:main" : actorInfo.id;
      await Promise.all([
        store.presence(roomId, leaseKey).catch(() => {}),
        store.memberStateSet(roomId, actorInfo.id, {
          status: "online",
          readSeq: savedMsg.seq,
        }),
      ]);
      schedulePresenceBroadcast(roomId, 30);
    }
    const aiPrompt = extractAiPrompt(body);
    if (aiPrompt && updated.aiEnabled !== false && savedMsg?.id === messageId) {
      triggerAiReply(roomId, aiPrompt, actorInfo, messageId);
    }
    res.status(201).json(savedMsg);
  });

  app.post("/api/rooms/:roomId/presence", async (req, res) => {
    const { roomId } = req.params;
    const state = await store.state(roomId);
    if (state.room.status !== "open") return res.json({ ok: true });
    const actor = resolveActor(req, state, req.query.audience === "1");
    const rawStatus = req.body?.status;
    const status =
      rawStatus === "online" || rawStatus === "away" ? rawStatus : undefined;
    const rawReadSeq = Number(req.body?.readSeq);
    const readSeq =
      Number.isFinite(rawReadSeq) && rawReadSeq >= 0
        ? Math.min(Math.floor(rawReadSeq), state.seq)
        : undefined;
    await store.memberStateSet(roomId, actor.id, { status, readSeq });
    if (status === "online" || readSeq !== undefined) {
      const leaseKey = actor.id === "owner" ? "owner:main" : actor.id;
      await store.presence(roomId, leaseKey).catch(() => {});
    }
    await broadcastMetadata(roomId);
    res.json({ ok: true });
  });

  app.patch("/api/rooms/:roomId/messages/:messageId", async (req, res) => {
    const { roomId, messageId } = req.params;
    const newBody = multilineText(req.body?.text, 1, 500, "수정할 메시지");
    const updated = await store.write(roomId, (state) => {
      if (state.room.status !== "open")
        throw new AppError(410, "종료된 채팅방입니다.");
      const actor = resolveActor(req, state, req.query.audience === "1");
      const target = state.messages.find((m) => m.id === messageId);
      if (!target || target.deleted)
        throw new AppError(404, "수정할 메시지를 찾을 수 없습니다.");
      if (target.role === "ai" || target.participantId !== actor.id)
        throw new AppError(403, "본인이 작성한 메시지만 수정할 수 있습니다.");
      if (target.text === newBody) return null;
      return {
        type: "edited",
        data: { id: messageId, text: newBody },
      };
    });
    await flushRoomEvents(roomId);
    res.json(updated.messages.find((m) => m.id === messageId));
  });

  app.post("/api/rooms/:roomId/leave", async (req, res) => {
    const { roomId } = req.params;
    const state = await store.state(roomId);
    const guestCookie = auth.guest(req, roomId);
    if (!guestCookie && auth.owner(req)) {
      clearTimer(disconnectTimers, `${roomId}:owner:main`);
      await Promise.all([
        store.presence(roomId, "owner:main", true),
        store.memberStateDel(roomId, "owner"),
      ]);
      const group = hub.get(roomId);
      if (group) {
        for (const ws of [...group.clients]) {
          if (ws.owner) {
            group.clients.delete(ws);
            ws.close(1000, "퇴장");
          }
        }
      }
      await broadcastMetadata(roomId);
      await scheduleAutoCloseCheck(roomId);
      return res.json({ ok: true });
    }
    const p = auth.participant(req, state);
    clearTimer(disconnectTimers, `${roomId}:${p.id}`);
    await Promise.all([
      store.presence(roomId, p.id, true),
      store.memberStateDel(roomId, p.id),
    ]);
    if (state.room.status === "open" && !p.left) {
      await store.write(roomId, (st) =>
        st.room.status === "open" &&
        st.participants[p.id] &&
        !st.participants[p.id].left
          ? { type: "left", data: { id: p.id, nickname: p.nickname } }
          : null,
      );
    }
    const group = hub.get(roomId);
    if (group) {
      for (const ws of [...group.clients]) {
        if (ws.participantId === p.id) {
          group.clients.delete(ws);
          ws.close(1000, "퇴장");
        }
      }
    }
    await flushRoomEvents(roomId);
    await broadcastMetadata(roomId);
    await scheduleAutoCloseCheck(roomId);
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
      await flushRoomEvents(req.params.roomId);
      await broadcastMetadata(req.params.roomId);
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/rooms/:roomId/kick/:participantId",
    auth.requireOwner,
    async (req, res) => {
      const { roomId, participantId } = req.params;
      clearTimer(disconnectTimers, `${roomId}:${participantId}`);
      await store.write(roomId, (state) => {
        if (!state.participants[participantId])
          throw new AppError(404, "참여자를 찾을 수 없습니다.");
        return { type: "kicked", data: { id: participantId } };
      });
      await Promise.all([
        store.presence(roomId, participantId, true),
        store.memberStateDel(roomId, participantId),
      ]);
      await flushRoomEvents(roomId);
      await broadcastMetadata(roomId);
      await scheduleAutoCloseCheck(roomId);
      res.json({ ok: true });
    },
  );
  app.post("/api/rooms/:roomId/close", auth.requireOwner, async (req, res) => {
    clearTimer(autoCloseTimers, req.params.roomId);
    await store.write(req.params.roomId, (state) =>
      state.room.status === "closed"
        ? null
        : { type: "closed", data: { reason: "manual" } },
    );
    await flushRoomEvents(req.params.roomId);
    await broadcastMetadata(req.params.roomId);
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
      await flushRoomEvents(req.params.roomId);
      await broadcastMetadata(req.params.roomId);
      res.json({ ok: true });
    },
  );
  app.put("/api/rooms/:roomId/theme", auth.requireOwner, async (req, res) => {
    const theme = sanitizeTheme(req.body?.theme);
    await store.write(req.params.roomId, () => ({
      type: "room_theme",
      data: { theme },
    }));
    await flushRoomEvents(req.params.roomId);
    res.json({ ok: true, theme });
  });
  app.put(
    "/api/rooms/:roomId/ai-settings",
    auth.requireOwner,
    async (req, res) => {
      const enabled = Boolean(req.body?.enabled);
      await store.write(req.params.roomId, () => ({
        type: "ai_settings",
        data: { enabled },
      }));
      await flushRoomEvents(req.params.roomId);
      res.json({ ok: true, aiEnabled: enabled });
    },
  );
  app.post("/api/rooms/:roomId/ai", async (req, res) => {
    const { roomId } = req.params;
    const state = await store.state(roomId);
    if (state.room.status !== "open")
      throw new AppError(410, "종료된 채팅방입니다.");
    const actor = resolveActor(req, state, req.query.audience === "1");
    await store.limit(
      `ai:${roomId}:${actor.id}`,
      10,
      60,
      "AI 호출이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.",
    );
    const prompt = multilineText(req.body?.prompt, 1, 400, "AI 요청 내용");
    broadcastRoomSignal(roomId, "aiStatus", {
      thinking: true,
      requestedBy: actor.nickname,
    });
    try {
      const result = await ai.ask({
        roomId,
        prompt,
        state,
        sender: actor,
        env: options.env || process.env,
      });
      const aiMsgId = id();
      const updated = await store.write(roomId, (st) => {
        if (st.room.status !== "open")
          throw new AppError(410, "종료된 채팅방입니다.");
        return {
          type: "message",
          data: {
            id: aiMsgId,
            participantId: "ai",
            nickname: "수다온 AI",
            role: "ai",
            device: "ai",
            provider: result.provider,
            model: result.model,
            promptBy: actor.nickname,
            text: result.text,
            requestId: `ai-direct-${aiMsgId}`,
          },
        };
      });
      await flushRoomEvents(roomId);
      res
        .status(201)
        .json(updated.messages.find((m) => m.id === aiMsgId) || { ok: true });
    } catch (err) {
      broadcastRoomSignal(roomId, "aiError", {
        error: err.message || "AI 응답 생성에 실패했습니다.",
      });
      throw err;
    } finally {
      broadcastRoomSignal(roomId, "aiStatus", { thinking: false });
    }
  });

  // Shared Games & Side-Apps synchronization
  app.post("/api/rooms/:roomId/apps", async (req, res) => {
    const { roomId } = req.params;
    const action = String(req.body?.action || "");
    const appId = String(req.body?.appId || "");
    const allowedApps = ["tetris", "stress", "dart", "lots", "ladder"];

    const updated = await store.write(roomId, (state) => {
      if (state.room.status !== "open")
        throw new AppError(410, "종료된 채팅방입니다.");
      const actor = resolveActor(req, state, req.query.audience === "1");
      const current = state.sharedApp;

      if (action === "close") {
        if (actor.role !== "owner" && current?.hostId !== actor.id) {
          throw new AppError(403, "공용 앱을 시작했거나 관리자만 닫을 수 있습니다.");
        }
        return { type: "shared_app", data: { app: null } };
      }

      if (!allowedApps.includes(appId)) {
        throw new AppError(400, "지원하지 않는 부가 앱입니다.");
      }

      if (action === "open") {
        const defaultState = {
          appId,
          hostId: actor.id,
          hostName: actor.nickname,
          status: "lobby",
          participants: [{ id: actor.id, nickname: actor.nickname }],
          scores: {},
          config:
            appId === "dart"
              ? {
                  items: Array.isArray(req.body?.items) && req.body.items.length >= 2
                    ? req.body.items.map((x) => text(String(x), 1, 30, "메뉴")).slice(0, 12)
                    : ["김치찌개", "돈까스", "쌀국수", "마라탕", "파스타", "비빔밥"],
                }
              : appId === "lots"
                ? {
                    winnerCount: 1,
                    labels: ["당첨 🎉"],
                  }
                : appId === "ladder"
                  ? {
                      players: ["참가자 1", "참가자 2", "참가자 3", "참가자 4"],
                      outcomes: ["당첨 🎉", "통과", "커피 쏘기 ☕", "통과"],
                    }
                  : {},
          result: null,
        };
        return { type: "shared_app", data: { app: defaultState } };
      }

      if (!current || current.appId !== appId) {
        throw new AppError(409, "실행 중인 공용 게임 상태가 변경되었습니다.");
      }

      if (action === "join") {
        const exists = (current.participants || []).some(
          (p) => p.id === actor.id,
        );
        const nextParticipants = exists
          ? current.participants
          : [
              ...(current.participants || []).slice(0, 49),
              { id: actor.id, nickname: actor.nickname },
            ];
        return {
          type: "shared_app",
          data: { app: { ...current, participants: nextParticipants } },
        };
      }

      if (action === "score") {
        const scoreVal = Math.max(
          0,
          Math.min(9999999, Math.floor(Number(req.body?.score) || 0)),
        );
        const prevBest = current.scores?.[actor.id]?.score || 0;
        const nextScores = {
          ...(current.scores || {}),
          [actor.id]: {
            nickname: actor.nickname,
            score: Math.max(prevBest, scoreVal),
            at: Date.now(),
          },
        };
        return {
          type: "shared_app",
          data: { app: { ...current, scores: nextScores } },
        };
      }

      if (action === "configure") {
        if (actor.role !== "owner" && current.hostId !== actor.id) {
          throw new AppError(403, "진행자 또는 관리자만 설정을 변경할 수 있습니다.");
        }
        const nextConfig = { ...current.config };
        if (appId === "dart" && Array.isArray(req.body?.items)) {
          nextConfig.items = req.body.items
            .map((x) => text(String(x), 1, 30, "메뉴 항목"))
            .slice(0, 12);
          if (nextConfig.items.length < 2)
            throw new AppError(400, "메뉴 항목은 최소 2개 이상 필요합니다.");
        }
        if (appId === "lots") {
          if (Array.isArray(req.body?.customNames)) {
            nextConfig.customNames = req.body.customNames
              .map((x) => text(String(x), 1, 20, "참가자 이름"))
              .slice(0, 50);
          }
          if (Array.isArray(req.body?.labels)) {
            nextConfig.labels = req.body.labels
              .map((x) => text(String(x), 1, 30, "제비 항목"))
              .slice(0, 50);
          }
        }
        if (appId === "ladder") {
          if (Array.isArray(req.body?.players)) {
            nextConfig.players = req.body.players
              .map((x) => text(String(x), 1, 20, "참가자"))
              .slice(0, 12);
          }
          if (Array.isArray(req.body?.outcomes)) {
            nextConfig.outcomes = req.body.outcomes
              .map((x) => text(String(x), 1, 25, "결과"))
              .slice(0, 12);
          }
        }
        return {
          type: "shared_app",
          data: {
            app: { ...current, config: nextConfig, status: "lobby", result: null },
          },
        };
      }

      if (action === "run") {
        if (actor.role !== "owner" && current.hostId !== actor.id) {
          throw new AppError(403, "진행자 또는 관리자만 추첨/게임을 시작할 수 있습니다.");
        }
        let result = null;
        if (appId === "dart") {
          result = spinDart(current.config?.items || []);
        } else if (appId === "lots") {
          const names =
            current.config?.customNames?.length > 0
              ? current.config.customNames
              : (current.participants || []).map((p) => p.nickname);
          result = drawLots(names, current.config?.labels || ["당첨 🎉"]);
        } else if (appId === "ladder") {
          const players =
            current.config?.players?.length >= 2
              ? current.config.players
              : (current.participants || []).map((p) => p.nickname);
          result = generateLadder(players, current.config?.outcomes || []);
        }
        return {
          type: "shared_app",
          data: {
            app: {
              ...current,
              status: "completed",
              result,
              runBy: actor.nickname,
              runAt: Date.now(),
            },
          },
        };
      }

      if (action === "reset") {
        if (actor.role !== "owner" && current.hostId !== actor.id) {
          throw new AppError(403, "진행자 또는 관리자만 초기화할 수 있습니다.");
        }
        return {
          type: "shared_app",
          data: { app: { ...current, status: "lobby", result: null } },
        };
      }

      throw new AppError(400, "알 수 없는 게임 명령입니다.");
    });

    await flushRoomEvents(roomId);
    res.json({ ok: true, sharedApp: updated.sharedApp });
  });

  // Real-time Surveys
  app.post("/api/rooms/:roomId/polls", auth.requireOwner, async (req, res) => {
    const { roomId } = req.params;
    const title = text(req.body?.title, 2, 100, "설문 제목");
    const description = req.body?.description
      ? multilineText(req.body.description, 0, 300, "설문 설명")
      : "";
    const anonymous = Boolean(req.body?.anonymous);
    const rawQuestions = Array.isArray(req.body?.questions)
      ? req.body.questions
      : [];
    if (rawQuestions.length < 1 || rawQuestions.length > 10) {
      throw new AppError(400, "설문 문항은 1~10개 사이로 구성해 주세요.");
    }
    const questions = rawQuestions.map((q, idx) => {
      const qType = ["single", "multiple", "text"].includes(q?.type)
        ? q.type
        : "single";
      const prompt = text(q?.prompt, 1, 150, `${idx + 1}번 문항 질문`);
      if (qType === "text") {
        return { id: `q${idx + 1}`, type: "text", prompt };
      }
      const opts = Array.isArray(q?.options)
        ? q.options
            .map((o) => text(String(o), 1, 80, "선택지"))
            .slice(0, 10)
        : [];
      if (opts.length < 2) {
        throw new AppError(
          400,
          `${idx + 1}번 객관식 문항에는 최소 2개의 선택지가 필요합니다.`,
        );
      }
      return { id: `q${idx + 1}`, type: qType, prompt, options: opts };
    });

    const pollId = id();
    const updated = await store.write(roomId, (state) => {
      if (state.room.status !== "open")
        throw new AppError(410, "종료된 채팅방입니다.");
      return {
        type: "poll_created",
        data: { id: pollId, title, description, anonymous, questions },
      };
    });
    await flushRoomEvents(roomId);
    const createdPoll = updated.polls.find((p) => p.id === pollId);
    res.status(201).json(summarizePoll(createdPoll, "owner", true));
  });

  app.post("/api/rooms/:roomId/polls/:pollId/vote", async (req, res) => {
    const { roomId, pollId } = req.params;
    const rawAnswers = req.body?.answers;
    if (!rawAnswers || typeof rawAnswers !== "object") {
      throw new AppError(400, "응답 내용이 올바르지 않습니다.");
    }
    let actorInfo = null;
    const updated = await store.write(roomId, (state) => {
      if (state.room.status !== "open")
        throw new AppError(410, "종료된 채팅방입니다.");
      const actor = resolveActor(req, state, req.query.audience === "1");
      actorInfo = actor;
      const poll = (state.polls || []).find((p) => p.id === pollId);
      if (!poll) throw new AppError(404, "설문을 찾을 수 없습니다.");
      if (poll.status !== "open")
        throw new AppError(410, "종료된 설문입니다.");

      const cleanedAnswers = {};
      for (const q of poll.questions) {
        const val = rawAnswers[q.id];
        if (q.type === "text") {
          if (val !== undefined && val !== null && String(val).trim() !== "") {
            cleanedAnswers[q.id] = multilineText(
              String(val),
              1,
              300,
              "주관식 답변",
            );
          }
        } else if (q.type === "single") {
          const idx = Number(val);
          if (
            !Number.isInteger(idx) ||
            idx < 0 ||
            idx >= q.options.length
          ) {
            throw new AppError(400, `"${q.prompt}" 항목을 선택해 주세요.`);
          }
          cleanedAnswers[q.id] = idx;
        } else if (q.type === "multiple") {
          const arr = Array.isArray(val) ? val.map(Number) : [];
          const valid = [
            ...new Set(
              arr.filter(
                (idx) =>
                  Number.isInteger(idx) && idx >= 0 && idx < q.options.length,
              ),
            ),
          ];
          if (!valid.length) {
            throw new AppError(
              400,
              `"${q.prompt}"에서 하나 이상 선택해 주세요.`,
            );
          }
          cleanedAnswers[q.id] = valid;
        }
      }
      return {
        type: "poll_voted",
        data: {
          pollId,
          voterId: actor.id,
          nickname: actor.nickname,
          anonymous: Boolean(poll.anonymous),
          answers: cleanedAnswers,
        },
      };
    });
    await flushRoomEvents(roomId);
    const poll = updated.polls.find((p) => p.id === pollId);
    res.json(
      summarizePoll(poll, actorInfo?.id, actorInfo?.role === "owner"),
    );
  });

  app.post(
    "/api/rooms/:roomId/polls/:pollId/close",
    auth.requireOwner,
    async (req, res) => {
      const { roomId, pollId } = req.params;
      const updated = await store.write(roomId, (state) => {
        const poll = (state.polls || []).find((p) => p.id === pollId);
        if (!poll) throw new AppError(404, "설문을 찾을 수 없습니다.");
        if (poll.status === "closed") return null;
        return { type: "poll_closed", data: { pollId } };
      });
      await flushRoomEvents(roomId);
      const poll = updated.polls.find((p) => p.id === pollId);
      res.json(summarizePoll(poll, "owner", true));
    },
  );

  app.get(
    "/api/rooms/:roomId/polls/:pollId/export",
    auth.requireOwner,
    async (req, res) => {
      const state = await store.state(req.params.roomId);
      const rawPoll = (state.polls || []).find(
        (p) => p.id === req.params.pollId,
      );
      if (!rawPoll) throw new AppError(404, "설문을 찾을 수 없습니다.");
      const poll = summarizePoll(rawPoll, "owner", true);
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook();
      book.creator = "수다온";
      const sheet = book.addWorksheet("설문 집계");
      sheet.addRow(["설문 제목", poll.title]);
      sheet.addRow(["총 응답 수", poll.totalResponses]);
      sheet.addRow(["상태", poll.status === "open" ? "진행 중" : "종료"]);
      sheet.addRow([]);
      sheet.addRow(["문항", "유형", "선택지 / 응답", "득표수", "비율(%)"]);
      for (const q of poll.questions) {
        if (q.type === "text") {
          if (!q.textAnswers.length) {
            sheet.addRow([q.prompt, "주관식", "(응답 없음)", 0, 0]);
          } else {
            for (const a of q.textAnswers) {
              sheet.addRow([q.prompt, "주관식", String(a.text), 1, ""]);
            }
          }
        } else {
          q.options.forEach((opt, i) => {
            sheet.addRow([
              q.prompt,
              q.type === "multiple" ? "복수 선택" : "단일 선택",
              String(opt),
              q.counts[i],
              q.percentages[i],
            ]);
          });
        }
      }
      sheet.columns.forEach((col) => {
        col.width = 32;
      });
      res.set({
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="sudaon-poll-${poll.id}.xlsx"`,
      });
      res.send(Buffer.from(await book.xlsx.writeBuffer()));
    },
  );

  // Email preview & explicit confirmed send (Owner only)
  app.post(
    "/api/rooms/:roomId/email/preview",
    auth.requireOwner,
    async (req, res) => {
      const state = await store.state(req.params.roomId);
      const result = await mail.preview(state, {
        to: req.body?.to,
        pollId: req.body?.pollId || null,
        includeChat: req.body?.includeChat !== false,
      });
      res.json(result);
    },
  );
  app.post(
    "/api/rooms/:roomId/email/send",
    auth.requireOwner,
    async (req, res) => {
      await store.limit(
        `email:${req.params.roomId}`,
        5,
        60,
        "이메일 전송 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      );
      const state = await store.state(req.params.roomId);
      const result = await mail.send(state, {
        to: req.body?.to,
        pollId: req.body?.pollId || null,
        includeChat: req.body?.includeChat !== false,
        confirmed: req.body?.confirmed === true,
      });
      res.json(result);
    },
  );

  app.get("/api/rooms/:roomId/keywords", async (req, res) => {
    if (!auth.owner(req) && !auth.display(req, req.params.roomId)) {
      throw new AppError(401, "발표자 로그인이 필요합니다.");
    }
    const state = await store.state(req.params.roomId);
    const presenceInfo = await buildOnlineSnapshot(req.params.roomId, state);
    const now = Date.now();
    res.json({
      recent: keywords(state, "recent", now),
      all: keywords(state, "all", now),
      activityRecent: activityRanking(
        state,
        "recent",
        now,
        presenceInfo.onlineParticipants,
      ),
      activityAll: activityRanking(
        state,
        "all",
        now,
        presenceInfo.onlineParticipants,
      ),
      exclusions: state.exclusions,
      ruleVersion: "ko-suffix-v1",
    });
  });
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
        String(m.nickname || ""),
        String(m.text || ""),
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
    if (state.polls?.length) {
      const pollSheet = book.addWorksheet("설문 결과");
      pollSheet.addRow(["설문 제목", "문항", "선택지 / 응답", "득표수 / 비고"]);
      for (const rawPoll of state.polls) {
        const p = summarizePoll(rawPoll, "owner", true);
        for (const q of p.questions) {
          if (q.type === "text") {
            for (const ans of q.textAnswers) {
              pollSheet.addRow([p.title, q.prompt, String(ans.text), "주관식"]);
            }
          } else {
            q.options.forEach((opt, idx) => {
              pollSheet.addRow([
                p.title,
                q.prompt,
                String(opt),
                `${q.counts[idx]}표 (${q.percentages[idx]}%)`,
              ]);
            });
          }
        }
      }
    }
    for (const sheet of book.worksheets) {
      sheet.getRow(1).font = { bold: true };
      sheet.columns.forEach((column, i) => {
        column.width = i === 3 ? 70 : 28;
      });
    }
    // Explicitly force string cell type on chat text column to prevent formula execution
    chat.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        const cell = row.getCell(4);
        cell.value = String(cell.value ?? "");
      }
    });
    res.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sudaon-${state.room.id}.xlsx"`,
    });
    res.send(Buffer.from(await book.xlsx.writeBuffer()));
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
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
      let state = await store.state(roomId);
      const audience = address.searchParams.get("audience") === "1";
      const dt = address.searchParams.get("dt") || "";
      const hasDisplayAuth = !audience && auth.display(req, roomId, dt);
      const isOwner = !audience && auth.owner(req);
      const displayOnly =
        address.searchParams.get("display") === "1" ||
        (!isOwner && hasDisplayAuth);
      const clientDevice = detectDevice(
        req.headers["user-agent"],
        address.searchParams.get("device") || "",
      );
      const participant = access(req, state, audience, dt);

      if (participant?.left) throw new AppError(403, "");

      if (participant && state.room.status === "open") {
        clearTimer(disconnectTimers, `${roomId}:${participant.id}`);
        clearTimer(autoCloseTimers, roomId);
        occupiedRooms.add(roomId);
        await Promise.all([
          store.presence(roomId, participant.id),
          store.memberStateSet(roomId, participant.id, { status: "online" }),
        ]);
      } else if (isOwner && !displayOnly && state.room.status === "open") {
        clearTimer(disconnectTimers, `${roomId}:owner:main`);
        clearTimer(autoCloseTimers, roomId);
        occupiedRooms.add(roomId);
        ownerDevices.set(roomId, clientDevice);
        await Promise.all([
          store.presence(roomId, "owner:main"),
          store.memberStateSet(roomId, "owner", {
            status: "online",
            readSeq: state.seq,
          }),
        ]);
      }

      const presenceInfo = await buildOnlineSnapshot(roomId, state);

      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.roomId = roomId;
        ws.participantId = participant?.id;
        ws.owner = isOwner;
        ws.displayOnly = displayOnly;
        ws.seq = state.seq;
        ws.alive = true;
        let group = hub.get(roomId);
        if (!group) {
          group = { clients: new Set(), cursor: state.seq };
          hub.set(roomId, group);
        }
        group.clients.add(ws);
        const viewerId = participant?.id || (isOwner ? "owner" : null);
        ws.send(
          JSON.stringify({
            type: "snapshot",
            data: {
              ...publicState(state, { viewerId, isOwner }),
              me: participant?.id || (isOwner ? "owner" : undefined),
              owner: ws.owner,
              online: presenceInfo.online,
              onlineTotal: presenceInfo.onlineTotal,
              activeOnlineCount: presenceInfo.activeOnlineCount,
              awayCount: presenceInfo.awayCount,
              onlineParticipants: presenceInfo.onlineParticipants,
              readCursors: presenceInfo.readCursors,
            },
          }),
        );
        broadcastMetadata(roomId);

        ws.on("message", async (raw) => {
          if (ws.displayOnly || !store) return;
          const memberId =
            ws.participantId || (ws.owner && !ws.displayOnly ? "owner" : null);
          if (!memberId) return;
          try {
            const msg = JSON.parse(String(raw));
            if (msg?.type !== "presence") return;
            const st = await store.state(roomId);
            if (st.room.status !== "open") return;
            if (ws.participantId) {
              const p = st.participants[ws.participantId];
              if (!p || p.left || p.kicked) return;
            }
            const status =
              msg.status === "online" || msg.status === "away"
                ? msg.status
                : undefined;
            const rawRead = Number(msg.readSeq);
            const readSeq =
              Number.isFinite(rawRead) && rawRead >= 0
                ? Math.min(Math.floor(rawRead), st.seq)
                : undefined;
            if (!status && readSeq === undefined) return;
            await store.memberStateSet(roomId, memberId, { status, readSeq });
            if (status === "online" || readSeq !== undefined) {
              const leaseKey =
                memberId === "owner" ? "owner:main" : memberId;
              store.presence(roomId, leaseKey).catch(() => {});
            }
            schedulePresenceBroadcast(roomId, 40);
          } catch {}
        });

        ws.on("pong", () => {
          ws.alive = true;
        });
        ws.on("error", () => {});
        ws.on("close", () => {
          group.clients.delete(ws);
          if (!group.clients.size) hub.delete(roomId);

          const memberKey =
            ws.participantId ||
            (ws.owner && !ws.displayOnly ? "owner:main" : null);
          if (!memberKey) return;

          const stillConnected = [...(hub.get(roomId)?.clients || [])].some(
            (other) =>
              other.readyState === 1 &&
              (ws.participantId
                ? other.participantId === ws.participantId
                : other.owner && !other.displayOnly),
          );
          if (stillConnected) return;

          const timerKey = `${roomId}:${memberKey}`;
          clearTimer(disconnectTimers, timerKey);
          const timer = setTimeout(async () => {
            disconnectTimers.delete(timerKey);
            const activeNow = [...(hub.get(roomId)?.clients || [])].some(
              (other) =>
                other.readyState === 1 &&
                (ws.participantId
                  ? other.participantId === ws.participantId
                  : other.owner && !other.displayOnly),
            );
            if (activeNow) return;
            try {
              await store.presence(roomId, memberKey, true);
              const st = await store.state(roomId);
              if (st.room.status === "open") {
                if (memberKey.startsWith("owner:")) {
                  const mstates = await store.memberStates(roomId);
                  if (mstates.owner) {
                    await store.memberStateSet(roomId, "owner", {
                      status: "away",
                    });
                  }
                } else {
                  const p = st.participants[memberKey];
                  if (p && !p.left && !p.kicked) {
                    await store.memberStateSet(roomId, memberKey, {
                      status: "away",
                    });
                  }
                }
              }
              await broadcastMetadata(roomId);
              await scheduleAutoCloseCheck(roomId);
            } catch {}
          }, disconnectGraceMs);
          timer.unref?.();
          disconnectTimers.set(timerKey, timer);
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
            for (const ws of group.clients) {
              if (ws.readyState !== 1 || event.seq <= ws.seq) continue;
              if (ws.bufferedAmount > 1024 * 1024) {
                ws.close(1013, "연결을 다시 시도해 주세요.");
                continue;
              }
              const viewerId = ws.participantId || (ws.owner ? "owner" : null);
              const payload = JSON.stringify({
                type: "event",
                data: publicEvent(event, { viewerId, isOwner: ws.owner }),
              });
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
        [...hub.entries()].map(([roomId]) => broadcastMetadata(roomId)),
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
        else if (ws.owner && !ws.displayOnly)
          store.presence(roomId, "owner:main").catch(() => {});
      }
  }, 25000);
  for (const timer of [poll, metadata, heartbeat]) timer.unref();

  app.use("/api", (req, res, next) =>
    next(new AppError(404, "요청을 찾을 수 없습니다.")),
  );
  app.use((error, req, res, next) => {
    if (!req.path.startsWith("/api")) return next(error);
    const status = error.status || 500;
    res.status(status).json({
      error:
        status >= 500 && !(error instanceof AppError)
          ? "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
          : error.message,
    });
  });
  const close = async () => {
    for (const timer of [poll, metadata, heartbeat]) clearInterval(timer);
    for (const timer of disconnectTimers.values()) clearTimeout(timer);
    for (const timer of autoCloseTimers.values()) clearTimeout(timer);
    for (const timer of presenceBroadcastTimers.values()) clearTimeout(timer);
    disconnectTimers.clear();
    autoCloseTimers.clear();
    presenceBroadcastTimers.clear();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise((resolve) =>
      server.listening ? server.close(resolve) : resolve(),
    );
    await store?.close();
  };
  return { app, server, store, close, auth };
}
