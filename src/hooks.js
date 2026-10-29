import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./api";

function applyEvent(state, e) {
  if (!state || e.seq <= state.seq) return state;
  const next = { ...state, seq: e.seq };
  if (e.type === "message") {
    next.messages = [
      ...state.messages.filter((m) => m.id !== e.data.id),
      { ...e.data, at: e.at, seq: e.seq },
    ].slice(-500);
    next.totalMessages = (state.totalMessages || 0) + 1;
  }
  if (e.type === "joined")
    next.participants = [
      ...state.participants.filter((p) => p.id !== e.data.id),
      e.data,
    ];
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
  if (e.type === "kicked")
    next.participants = state.participants.map((p) =>
      p.id === e.data.id ? { ...p, kicked: true } : p,
    );
  if (e.type === "closed") next.room = { ...state.room, status: "closed" };
  if (e.type === "exclusions") next.exclusions = e.data.words;
  return next;
}
export function useRoom(roomId, enabled, audience = false) {
  const [data, setData] = useState(null);
  const [connection, setConnection] = useState("connecting");
  const [error, setError] = useState("");
  const [meta, setMeta] = useState({ recent: [], all: [], online: 0 });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    if (!roomId || !enabled) {
      setData(null);
      return;
    }
    let disposed = false,
      socket,
      timer,
      retries = 0;
    setData(null);
    setMeta({ recent: [], all: [], online: 0 });
    setConnection("connecting");
    setError("");
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/socket?room=${roomId}${audience ? '&audience=1' : ''}`,
      );
      socket.onopen = () => {
        retries = 0;
        setConnection("online");
        setError("");
      };
      socket.onmessage = (message) => {
        const payload = JSON.parse(message.data);
        if (payload.type === "snapshot") setData(payload.data);
        if (payload.type === "event")
          setData((current) => applyEvent(current, payload.data));
        if (payload.type === "metadata")
          setMeta((current) => ({ ...current, ...payload.data }));
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
    api(`/rooms/${roomId}${audience ? '?audience=1' : ''}`)
      .then((initial) => {
        if (disposed) return;
        setData(initial);
        setMeta((current) => ({ ...current, online: initial.online }));
        if (initial.owner)
          api(`/rooms/${roomId}/keywords`)
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
      socket?.close();
    };
  }, [roomId, enabled, revision, audience]);
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
  return { data, setData, connection, error, meta, retry, earlier };
}
export function useAutoScroll(dependencies) {
  const ref = useRef(null),
    pinned = useRef(true);
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (pinned.current)
      ref.current?.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "instant",
      });
    else setUnread(true);
  }, dependencies);
  const onScroll = () => {
    const node = ref.current;
    pinned.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < 70;
    if (pinned.current) setUnread(false);
  };
  const latest = () => {
    pinned.current = true;
    setUnread(false);
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  };
  return { ref, onScroll, unread, latest };
}
