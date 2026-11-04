import { useState, useEffect, useRef, useCallback } from "react";
import { api, clientDeviceType } from "./api";

function updatePollOnVote(poll, voteData) {
  if (!poll || poll.id !== voteData.pollId) return poll;
  const voterMap = { ...(poll._voters || {}) };
  voterMap[voteData.voterKey] = {
    answers: voteData.answers,
    nickname: voteData.nickname,
    at: Date.now(),
  };
  const responses = Object.values(voterMap);
  // If snapshot started with existing responses without _voters keys, preserve baseline delta
  const baseOffset = Math.max(
    0,
    (poll.totalResponses || 0) - Object.keys(poll._voters || {}).length,
  );
  const totalResponses = baseOffset + responses.length;

  const questions = (poll.questions || []).map((q) => {
    if (q.type === "text") {
      const existingBase = poll._voters ? [] : poll.textAnswers || [];
      const fresh = responses
        .map((r) => {
          const val = r.answers?.[q.id];
          if (typeof val !== "string" || !val.trim()) return null;
          return { text: val.trim(), nickname: r.nickname, at: r.at };
        })
        .filter(Boolean);
      const merged = [...existingBase, ...fresh];
      return { ...q, total: merged.length, textAnswers: merged };
    }
    const baseCounts = poll._voters
      ? q.options.map(() => 0)
      : [...(q.counts || q.options.map(() => 0))];
    // Subtract previous vote from same voter if we had _voters
    const counts = [...baseCounts];
    if (poll._voters) {
      let answered = 0;
      for (const r of responses) {
        const val = r.answers?.[q.id];
        const arr = Array.isArray(val)
          ? val
          : typeof val === "number"
            ? [val]
            : [];
        if (arr.length) answered++;
        for (const idx of arr) {
          if (counts[idx] !== undefined) counts[idx]++;
        }
      }
      return {
        ...q,
        total: baseOffset + answered,
        counts,
        percentages: counts.map((c) =>
          totalResponses ? Math.round((c / totalResponses) * 100) : 0,
        ),
      };
    }
    // First live vote after initial snapshot without _voters map
    const val = voteData.answers?.[q.id];
    const arr = Array.isArray(val)
      ? val
      : typeof val === "number"
        ? [val]
        : [];
    for (const idx of arr) {
      if (counts[idx] !== undefined) counts[idx]++;
    }
    const nextTotal = voteData.isMine && poll.myResponse ? poll.totalResponses : (poll.totalResponses || 0) + 1;
    return {
      ...q,
      total: (q.total || 0) + (arr.length ? 1 : 0),
      counts,
      percentages: counts.map((c) =>
        nextTotal ? Math.round((c / nextTotal) * 100) : 0,
      ),
    };
  });

  return {
    ...poll,
    _voters: poll._voters ? voterMap : undefined,
    totalResponses: poll._voters
      ? totalResponses
      : voteData.isMine && poll.myResponse
        ? poll.totalResponses
        : (poll.totalResponses || 0) + 1,
    questions,
    myResponse: voteData.isMine ? voteData.answers : poll.myResponse,
  };
}

export function applyEvent(state, e) {
  if (!state || e.seq <= state.seq) return state;
  const next = { ...state, seq: e.seq };
  const sysList = state.systemMessages || [];

  if (e.type === "message") {
    next.messages = [
      ...state.messages.filter((m) => m.id !== e.data.id),
      { ...e.data, at: e.at, seq: e.seq },
    ].slice(-500);
    next.totalMessages = (state.totalMessages || 0) + 1;
  }
  if (e.type === "edited") {
    next.messages = state.messages.map((m) =>
      m.id === e.data.id && !m.deleted
        ? { ...m, text: e.data.text, editedAt: e.at }
        : m,
    );
  }
  if (e.type === "joined") {
    const prev = (state.participants || []).find((p) => p.id === e.data.id);
    const wasActive = Boolean(prev && !prev.left && !prev.kicked);
    next.participants = [
      ...(state.participants || []).filter((p) => p.id !== e.data.id),
      { ...prev, ...e.data, left: false },
    ];
    if (!wasActive) {
      next.systemMessages = [
        ...sysList,
        {
          id: `sys-${e.seq}`,
          kind: "join",
          participantId: e.data.id,
          nickname: e.data.nickname,
          device: e.data.device || "pc",
          text: `${e.data.nickname} 님이 입장하셨습니다.`,
          seq: e.seq,
          at: e.at,
        },
      ].slice(-150);
    }
  }
  if (e.type === "left") {
    const prev = (state.participants || []).find((p) => p.id === e.data.id);
    const wasActive = Boolean(prev && !prev.left && !prev.kicked);
    next.participants = (state.participants || []).map((p) =>
      p.id === e.data.id ? { ...p, left: true, leftAt: e.at } : p,
    );
    if (wasActive) {
      next.systemMessages = [
        ...sysList,
        {
          id: `sys-${e.seq}`,
          kind: "leave",
          participantId: prev.id,
          nickname: prev.nickname,
          device: prev.device || "pc",
          text: `${prev.nickname} 님이 퇴장하셨습니다.`,
          seq: e.seq,
          at: e.at,
        },
      ].slice(-150);
    }
  }
  if (e.type === "deleted") {
    const visible = state.messages.some(
      (m) => m.id === e.data.id && !m.deleted,
    );
    next.messages = state.messages.map((m) =>
      m.id === e.data.id ? { ...m, deleted: true, text: "" } : m,
    );
    if (visible)
      next.totalMessages = Math.max(0, (state.totalMessages || 0) - 1);
  }
  if (e.type === "kicked") {
    const prev = (state.participants || []).find((p) => p.id === e.data.id);
    const wasActive = Boolean(prev && !prev.left && !prev.kicked);
    next.participants = (state.participants || []).map((p) =>
      p.id === e.data.id ? { ...p, kicked: true, left: true } : p,
    );
    if (wasActive) {
      next.systemMessages = [
        ...sysList,
        {
          id: `sys-${e.seq}`,
          kind: "leave",
          participantId: prev.id,
          nickname: prev.nickname,
          text: `${prev.nickname} 님이 퇴장하셨습니다.`,
          seq: e.seq,
          at: e.at,
        },
      ].slice(-150);
    }
  }
  if (e.type === "closed") {
    next.room = {
      ...state.room,
      status: "closed",
      closeReason: e.data?.reason || "manual",
    };
    next.systemMessages = [
      ...sysList,
      {
        id: `sys-${e.seq}`,
        kind: "closed",
        text:
          e.data?.reason === "auto_empty"
            ? "모든 참여자가 퇴장하여 채팅방이 자동 종료되었습니다."
            : "채팅방이 종료되었습니다.",
        seq: e.seq,
        at: e.at,
      },
    ].slice(-150);
  }
  if (e.type === "exclusions") next.exclusions = e.data.words;
  if (e.type === "room_theme") next.roomTheme = e.data.theme || null;
  if (e.type === "ai_settings") next.aiEnabled = Boolean(e.data.enabled);
  if (e.type === "shared_app") {
    next.sharedApp = e.data.app
      ? { ...e.data.app, updatedAt: e.at, seq: e.seq }
      : null;
  }
  if (e.type === "poll_created") {
    const newPoll = {
      ...e.data,
      status: "open",
      createdAt: e.at,
      totalResponses: 0,
      myResponse: null,
      _voters: {},
      questions: (e.data.questions || []).map((q) =>
        q.type === "text"
          ? { ...q, total: 0, textAnswers: [] }
          : {
              ...q,
              total: 0,
              counts: q.options.map(() => 0),
              percentages: q.options.map(() => 0),
            },
      ),
    };
    next.polls = [...(state.polls || []), newPoll];
  }
  if (e.type === "poll_voted") {
    next.polls = (state.polls || []).map((p) => updatePollOnVote(p, e.data));
  }
  if (e.type === "poll_closed") {
    next.polls = (state.polls || []).map((p) =>
      p.id === e.data.pollId ? { ...p, status: "closed", closedAt: e.at } : p,
    );
  }
  return next;
}

const IDLE_AWAY_MS = 60_000;

export function useRoom(roomId, enabled, audience = false, display = false) {
  const [data, setData] = useState(null);
  const [connection, setConnection] = useState("connecting");
  const [error, setError] = useState("");
  const [aiStatus, setAiStatus] = useState({ thinking: false, requestedBy: "" });
  const [meta, setMeta] = useState({
    recent: [],
    all: [],
    activityRecent: [],
    activityAll: [],
    online: 0,
    onlineTotal: 0,
    activeOnlineCount: 0,
    awayCount: 0,
    onlineParticipants: [],
    readCursors: {},
  });
  const [revision, setRevision] = useState(0);
  const socketRef = useRef(null);
  const lastSentReadSeqRef = useRef(0);
  const pendingReadSeqRef = useRef(0);
  const readDebounceRef = useRef(null);
  const presenceStatusRef = useRef("online");

  const retry = useCallback(() => setRevision((v) => v + 1), []);

  const sendPresence = useCallback(
    (patch, { urgent = false } = {}) => {
      if (!roomId || !enabled || display) return;
      const ws = socketRef.current;
      let sentViaWs = false;
      if (ws && ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ type: "presence", ...patch }));
          sentViaWs = true;
        } catch {}
      }
      if (urgent || !sentViaWs) {
        fetch(`/api/rooms/${roomId}/presence${audience ? "?audience=1" : ""}`, {
          method: "POST",
          credentials: "include",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }).catch(() => {});
      }
    },
    [roomId, enabled, audience, display],
  );

  const reportRead = useCallback(
    (seq) => {
      if (!roomId || !enabled || display) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      const target = Math.floor(Number(seq) || 0);
      if (target <= 0 || target <= lastSentReadSeqRef.current) return;
      pendingReadSeqRef.current = Math.max(pendingReadSeqRef.current, target);
      if (readDebounceRef.current) return;
      readDebounceRef.current = setTimeout(() => {
        readDebounceRef.current = null;
        const nextSeq = pendingReadSeqRef.current;
        if (nextSeq <= lastSentReadSeqRef.current) return;
        lastSentReadSeqRef.current = nextSeq;
        sendPresence({
          readSeq: nextSeq,
          ...(presenceStatusRef.current === "online"
            ? { status: "online" }
            : {}),
        });
      }, 70);
    },
    [roomId, enabled, display, sendPresence],
  );

  const refreshRoom = useCallback(async () => {
    if (!roomId) return;
    try {
      const fresh = await api(
        `/rooms/${roomId}${audience ? "?audience=1" : ""}`,
      );
      setData(fresh);
      setMeta((cur) => ({
        ...cur,
        online: fresh.online ?? cur.online,
        onlineTotal: fresh.onlineTotal ?? cur.onlineTotal,
        activeOnlineCount: fresh.activeOnlineCount ?? cur.activeOnlineCount,
        awayCount: fresh.awayCount ?? cur.awayCount,
        onlineParticipants: fresh.onlineParticipants || cur.onlineParticipants,
        readCursors: fresh.readCursors || cur.readCursors,
      }));
    } catch {}
  }, [roomId, audience]);

  useEffect(() => {
    lastSentReadSeqRef.current = 0;
    pendingReadSeqRef.current = 0;
    presenceStatusRef.current =
      typeof document !== "undefined" && document.visibilityState === "hidden"
        ? "away"
        : "online";
    return () => {
      if (readDebounceRef.current) {
        clearTimeout(readDebounceRef.current);
        readDebounceRef.current = null;
      }
    };
  }, [roomId, enabled]);

  useEffect(() => {
    if (!roomId || !enabled || display || typeof window === "undefined") return;
    let idleTimer = null;
    let lastMoveAt = 0;

    const armIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (presenceStatusRef.current !== "away") {
          presenceStatusRef.current = "away";
          sendPresence({ status: "away" });
        }
      }, IDLE_AWAY_MS);
    };

    const markAway = (urgent = false) => {
      clearTimeout(idleTimer);
      if (presenceStatusRef.current === "away" && !urgent) return;
      presenceStatusRef.current = "away";
      sendPresence({ status: "away" }, { urgent });
    };

    const markActive = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      armIdleTimer();
      if (presenceStatusRef.current !== "online") {
        presenceStatusRef.current = "online";
        const latestRead = Math.max(
          lastSentReadSeqRef.current,
          pendingReadSeqRef.current,
        );
        sendPresence({
          status: "online",
          ...(latestRead > 0 ? { readSeq: latestRead } : {}),
        });
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markAway(true);
      } else {
        markActive();
        const ws = socketRef.current;
        if (!ws || ws.readyState > 1) {
          setRevision((v) => v + 1);
        }
      }
    };

    const onPageHide = () => markAway(true);
    const onMouseMove = () => {
      const now = Date.now();
      if (now - lastMoveAt < 2000) return;
      lastMoveAt = now;
      markActive();
    };

    if (document.visibilityState === "hidden") {
      markAway(false);
    } else {
      armIdleTimer();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("focus", markActive);
    window.addEventListener("pageshow", markActive);
    window.addEventListener("pointerdown", markActive, { passive: true });
    window.addEventListener("keydown", markActive, { passive: true });
    window.addEventListener("touchstart", markActive, { passive: true });
    window.addEventListener("wheel", markActive, { passive: true });
    window.addEventListener("scroll", markActive, {
      capture: true,
      passive: true,
    });
    window.addEventListener("mousemove", onMouseMove, { passive: true });

    return () => {
      clearTimeout(idleTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("focus", markActive);
      window.removeEventListener("pageshow", markActive);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("touchstart", markActive);
      window.removeEventListener("wheel", markActive);
      window.removeEventListener("scroll", markActive, { capture: true });
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, [roomId, enabled, display, sendPresence]);

  useEffect(() => {
    if (!roomId || !enabled) {
      setData(null);
      return;
    }
    let disposed = false,
      socket,
      timer,
      retries = 0;
    const device = clientDeviceType();
    const searchParams =
      display && typeof location !== "undefined"
        ? new URLSearchParams(location.search)
        : null;
    const displayToken = searchParams ? searchParams.get("dt") || "" : "";
    const displayLaunchId = searchParams ? searchParams.get("lid") || "" : "";
    const roomQueryParams = new URLSearchParams({
      ...(audience ? { audience: "1" } : {}),
      ...(displayToken ? { dt: displayToken } : {}),
    });
    const roomQuery = roomQueryParams.toString()
      ? `?${roomQueryParams.toString()}`
      : "";

    setData(null);
    setMeta({
      recent: [],
      all: [],
      activityRecent: [],
      activityAll: [],
      online: 0,
      onlineTotal: 0,
      activeOnlineCount: 0,
      awayCount: 0,
      onlineParticipants: [],
      readCursors: {},
    });
    setConnection("connecting");
    setError("");
    setAiStatus({ thinking: false, requestedBy: "" });

    const connect = () => {
      if (disposed) return;
      const qs = new URLSearchParams({
        room: roomId,
        device,
        ...(audience ? { audience: "1" } : {}),
        ...(display ? { display: "1" } : {}),
        ...(displayToken ? { dt: displayToken } : {}),
      });
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/socket?${qs}`,
      );
      socketRef.current = socket;
      socket.onopen = () => {
        retries = 0;
        setConnection("online");
        setError("");
        if (!display) {
          const isHidden =
            typeof document !== "undefined" &&
            document.visibilityState === "hidden";
          const currentStatus = isHidden ? "away" : presenceStatusRef.current;
          const latestRead = Math.max(
            lastSentReadSeqRef.current,
            pendingReadSeqRef.current,
          );
          try {
            socket.send(
              JSON.stringify({
                type: "presence",
                status: currentStatus,
                ...(latestRead > 0 && !isHidden ? { readSeq: latestRead } : {}),
              }),
            );
          } catch {}
        }
      };
      socket.onmessage = (message) => {
        const payload = JSON.parse(message.data);
        if (payload.type === "snapshot") {
          setData(payload.data);
          setMeta((current) => ({
            ...current,
            online: payload.data.online ?? current.online,
            onlineTotal: payload.data.onlineTotal ?? current.onlineTotal,
            activeOnlineCount:
              payload.data.activeOnlineCount ?? current.activeOnlineCount,
            awayCount: payload.data.awayCount ?? current.awayCount,
            onlineParticipants:
              payload.data.onlineParticipants || current.onlineParticipants,
            readCursors: payload.data.readCursors || current.readCursors,
          }));
        }
        if (payload.type === "event") {
          setData((current) => applyEvent(current, payload.data));
          if (payload.data.type === "poll_voted") {
            // Ensure exact server poll totals stay synced
            api(`/rooms/${roomId}${roomQuery}`)
              .then((fresh) => {
                if (!disposed) {
                  setData((cur) =>
                    cur ? { ...cur, polls: fresh.polls } : fresh,
                  );
                }
              })
              .catch(() => {});
          }
        }
        if (payload.type === "metadata")
          setMeta((current) => ({ ...current, ...payload.data }));
        if (payload.type === "aiStatus") setAiStatus(payload.data);
        if (
          payload.type === "displayConnected" &&
          typeof window !== "undefined"
        ) {
          window.dispatchEvent(
            new CustomEvent("sudaon:displayConnected", {
              detail: payload.data || {},
            }),
          );
        }
        if (payload.type === "aiError") {
          setAiStatus({ thinking: false, requestedBy: "" });
          setError(payload.data?.error || "AI 호출 중 오류가 발생했습니다.");
        }
        if (payload.type === "serviceError") {
          setError(payload.data);
          setConnection("reconnecting");
        }
        if (payload.type === "serviceReady") {
          setError("");
          setConnection("online");
        }
      };
      socket.onclose = (event) => {
        if (socketRef.current === socket) socketRef.current = null;
        if (disposed) return;
        if (event.code === 4003) {
          setConnection("denied");
          setError(event.reason || "참여가 제한되었습니다.");
          return;
        }
        setConnection("reconnecting");
        timer = setTimeout(
          connect,
          Math.min(1000 * 2 ** retries++, 8000) + Math.random() * 500,
        );
      };
    };

    const bootstrapSession = displayToken
      ? api(`/rooms/${roomId}/display-session`, {
          method: "POST",
          body: {
            token: displayToken,
            ...(displayLaunchId ? { launchId: displayLaunchId } : {}),
          },
        }).catch(() => {})
      : Promise.resolve();

    bootstrapSession
      .then(() => api(`/rooms/${roomId}${roomQuery}`))
      .then((initial) => {
        if (disposed) return;
        setData(initial);
        setMeta((current) => ({
          ...current,
          online: initial.online,
          onlineTotal: initial.onlineTotal ?? initial.online,
          activeOnlineCount:
            initial.activeOnlineCount ??
            (initial.onlineParticipants || []).filter(
              (u) => u.status !== "away",
            ).length,
          awayCount:
            initial.awayCount ??
            (initial.onlineParticipants || []).filter(
              (u) => u.status === "away",
            ).length,
          onlineParticipants: initial.onlineParticipants || [],
          readCursors: initial.readCursors || {},
        }));
        if (initial.owner || display)
          api(
            `/rooms/${roomId}/keywords${displayToken ? `?dt=${encodeURIComponent(displayToken)}` : ""}`,
          )
            .then((value) => {
              if (!disposed) setMeta((current) => ({ ...current, ...value }));
            })
            .catch(() => {});
        connect();
      })
      .catch((e) => {
        if (!disposed) {
          setError(e.message);
          setConnection("denied");
        }
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (socketRef.current === socket) socketRef.current = null;
      socket?.close();
    };
  }, [roomId, enabled, revision, audience, display]);

  const earlier = async () => {
    if (!data?.messages.length) return;
    const messages = await api(
      `/rooms/${roomId}/messages?before=${data.messages[0].seq}`,
    );
    setData((current) => ({
      ...current,
      earliestSeq: messages[0]?.seq || 0,
      messages: [
        ...messages,
        ...current.messages.filter(
          (m) => !messages.some((old) => old.id === m.id),
        ),
      ],
    }));
    return messages.length;
  };
  return {
    data,
    setData,
    connection,
    error,
    setError,
    aiStatus,
    meta,
    retry,
    earlier,
    refreshRoom,
    reportRead,
  };
}

export function useAutoScroll(dependencies) {
  const ref = useRef(null),
    pinned = useRef(true);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (pinned.current) {
      ref.current?.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "instant",
      });
      setUnread(0);
    } else {
      setUnread((n) => n + 1);
    }
  }, dependencies);
  const onScroll = () => {
    const node = ref.current;
    if (!node) return;
    pinned.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < 70;
    if (pinned.current) setUnread(0);
  };
  const latest = () => {
    pinned.current = true;
    setUnread(0);
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  };
  return { ref, onScroll, unread, latest };
}
