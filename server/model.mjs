import { randomBytes, randomInt, createHash } from "node:crypto";

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const id = () => randomBytes(12).toString("base64url");
export const hash = (value) => createHash("sha256").update(value).digest("hex");

export function text(value, min, max, label) {
  const cleaned =
    typeof value === "string" ? value.trim().normalize("NFKC") : "";
  if (
    [...cleaned].length < min ||
    [...cleaned].length > max ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(cleaned)
  ) {
    throw new AppError(400, `${label}은(는) ${min}~${max}자로 입력해 주세요.`);
  }
  return cleaned;
}

export function multilineText(value, min, max, label) {
  const cleaned =
    typeof value === "string"
      ? value.replace(/\r\n/g, "\n").trim().normalize("NFKC")
      : "";
  if (
    [...cleaned].length < min ||
    [...cleaned].length > max ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(cleaned)
  ) {
    throw new AppError(400, `${label}은(는) ${min}~${max}자로 입력해 주세요.`);
  }
  return cleaned;
}

export function detectDevice(userAgent = "", clientDevice = "") {
  if (["pc", "mobile", "tablet"].includes(clientDevice)) return clientDevice;
  const ua = String(userAgent || "");
  if (!ua) return "pc";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua))
    return "tablet";
  if (/mobi|iphone|ipod|android|iemobile|opera mini/i.test(ua))
    return "mobile";
  return "pc";
}

export function summarizePoll(poll, viewerId = null, isOwner = false) {
  const responses = Object.values(poll.responses || {});
  const totalResponses = responses.length;
  const questions = (poll.questions || []).map((q) => {
    if (q.type === "text") {
      const answers = responses
        .map((r) => {
          const val = r.answers?.[q.id];
          if (typeof val !== "string" || !val.trim()) return null;
          return {
            text: val.trim(),
            ...(poll.anonymous && !isOwner ? {} : { nickname: r.nickname }),
            at: r.at,
          };
        })
        .filter(Boolean);
      return { ...q, total: answers.length, textAnswers: answers };
    }
    const counts = (q.options || []).map(() => 0);
    let answeredCount = 0;
    for (const r of responses) {
      const val = r.answers?.[q.id];
      const selected = Array.isArray(val)
        ? val
        : typeof val === "number"
          ? [val]
          : [];
      const uniqueValid = [
        ...new Set(
          selected.filter(
            (idx) =>
              Number.isInteger(idx) && idx >= 0 && idx < counts.length,
          ),
        ),
      ];
      if (uniqueValid.length) answeredCount++;
      for (const idx of uniqueValid) counts[idx]++;
    }
    return {
      ...q,
      total: answeredCount,
      counts,
      percentages: counts.map((c) =>
        totalResponses ? Math.round((c / totalResponses) * 100) : 0,
      ),
    };
  });
  return {
    id: poll.id,
    title: poll.title,
    description: poll.description || "",
    anonymous: Boolean(poll.anonymous),
    status: poll.status || "open",
    createdAt: poll.createdAt,
    closedAt: poll.closedAt || null,
    totalResponses,
    questions,
    myResponse: viewerId ? poll.responses?.[viewerId]?.answers || null : null,
    ...(isOwner ? { rawResponses: responses } : {}),
  };
}

export function reduce(state, event) {
  const { type, data, seq, at } = event;
  if (!state && type === "created")
    state = {
      room: data,
      participants: {},
      messages: [],
      systemMessages: [],
      polls: [],
      sharedApp: null,
      roomTheme: null,
      aiEnabled: true,
      seq: 0,
      at,
      exclusions: [],
    };
  if (!state) throw new AppError(404, "채팅방을 찾을 수 없습니다.");
  state.systemMessages ||= [];
  state.polls ||= [];
  if (state.aiEnabled === undefined) state.aiEnabled = true;

  if (type === "joined") {
    const prev = state.participants[data.id];
    const wasActive = Boolean(prev && !prev.left && !prev.kicked);
    state.participants[data.id] = {
      ...prev,
      ...data,
      device: data.device || prev?.device || "pc",
      left: false,
      joinedAt: prev?.joinedAt || at,
      lastSeenAt: at,
    };
    if (!wasActive) {
      state.systemMessages.push({
        id: `sys-${seq}`,
        kind: "join",
        participantId: data.id,
        nickname: data.nickname,
        device: data.device || prev?.device || "pc",
        text: `${data.nickname} 님이 입장하셨습니다.`,
        seq,
        at,
      });
    }
  }
  if (type === "left") {
    const p = state.participants[data.id];
    if (p && !p.left && !p.kicked) {
      p.left = true;
      p.leftAt = at;
      state.systemMessages.push({
        id: `sys-${seq}`,
        kind: "leave",
        participantId: p.id,
        nickname: p.nickname,
        device: p.device || "pc",
        text: `${p.nickname} 님이 퇴장하셨습니다.`,
        seq,
        at,
      });
    }
  }
  if (type === "message") state.messages.push({ ...data, seq, at });
  if (type === "edited") {
    const message = state.messages.find((m) => m.id === data.id);
    if (message && !message.deleted) {
      message.text = data.text;
      message.editedAt = at;
    }
  }
  if (type === "deleted") {
    const message = state.messages.find((m) => m.id === data.id);
    if (message) {
      message.deleted = true;
      message.text = "";
    }
  }
  if (type === "kicked" && state.participants[data.id]) {
    const p = state.participants[data.id];
    const wasActive = !p.kicked && !p.left;
    p.kicked = true;
    p.left = true;
    p.leftAt = at;
    if (wasActive) {
      state.systemMessages.push({
        id: `sys-${seq}`,
        kind: "leave",
        participantId: p.id,
        nickname: p.nickname,
        device: p.device || "pc",
        text: `${p.nickname} 님이 퇴장하셨습니다.`,
        seq,
        at,
      });
    }
  }
  if (type === "closed") {
    const wasOpen = state.room.status !== "closed";
    state.room.status = "closed";
    state.room.closedAt = at;
    state.room.closeReason = data?.reason || "manual";
    if (wasOpen) {
      state.systemMessages.push({
        id: `sys-${seq}`,
        kind: "closed",
        text:
          data?.reason === "auto_empty"
            ? "모든 참여자가 퇴장하여 채팅방이 자동 종료되었습니다."
            : "채팅방이 종료되었습니다.",
        seq,
        at,
      });
    }
  }
  if (type === "exclusions") state.exclusions = data.words;
  if (type === "room_theme") state.roomTheme = data.theme || null;
  if (type === "ai_settings") state.aiEnabled = Boolean(data.enabled);
  if (type === "shared_app") {
    state.sharedApp = data.app ? { ...data.app, updatedAt: at, seq } : null;
  }
  if (type === "poll_created") {
    state.polls.push({
      ...data,
      status: "open",
      createdAt: at,
      responses: {},
    });
  }
  if (type === "poll_voted") {
    const poll = state.polls.find((p) => p.id === data.pollId);
    if (poll && poll.status === "open") {
      poll.responses ||= {};
      poll.responses[data.voterId] = {
        voterId: data.voterId,
        nickname: data.nickname,
        answers: data.answers,
        at,
      };
    }
  }
  if (type === "poll_closed") {
    const poll = state.polls.find((p) => p.id === data.pollId);
    if (poll) {
      poll.status = "closed";
      poll.closedAt = at;
    }
  }
  state.seq = seq;
  state.at = at;
  return state;
}

export function publicEvent(event, { viewerId = null, isOwner = false } = {}) {
  if (event.type === "joined") {
    const { tokenHash, ...data } = event.data;
    return { ...event, data };
  }
  if (event.type === "poll_voted") {
    const { voterId, nickname, ...rest } = event.data;
    return {
      ...event,
      data: {
        ...rest,
        voterKey: hash(String(voterId)).slice(0, 12),
        isMine: Boolean(viewerId && voterId === viewerId),
        ...(event.data.anonymous && !isOwner ? {} : { nickname }),
      },
    };
  }
  return event;
}

export function publicState(state, { viewerId = null, isOwner = false } = {}) {
  const recentMessages = state.messages.slice(-100);
  return {
    room: state.room,
    seq: state.seq,
    participants: Object.values(state.participants).map(
      ({ tokenHash, ...p }) => p,
    ),
    messages: recentMessages,
    systemMessages: (state.systemMessages || []).slice(-100),
    exclusions: state.exclusions,
    aiEnabled: state.aiEnabled !== false,
    roomTheme: state.roomTheme || null,
    sharedApp: state.sharedApp || null,
    polls: (state.polls || []).map((p) =>
      summarizePoll(p, viewerId, isOwner),
    ),
    totalMessages: state.messages.filter((m) => !m.deleted).length,
    earliestSeq: recentMessages[0]?.seq || 0,
  };
}

export function spinDart(items) {
  if (!Array.isArray(items) || items.length < 2)
    throw new AppError(400, "메뉴 항목을 2개 이상 입력해 주세요.");
  const winnerIndex = randomInt(0, items.length);
  const sliceAngle = 360 / items.length;
  // Point needle (top = 0deg) into the center +/- jitter of the chosen slice
  const jitter = (randomInt(20, 80) / 100 - 0.5) * sliceAngle * 0.65;
  const extraTurns = randomInt(5, 9) * 360;
  const targetAngle =
    extraTurns + (360 - (winnerIndex * sliceAngle + sliceAngle / 2)) + jitter;
  return {
    winnerIndex,
    winner: items[winnerIndex],
    rotation: Math.round(targetAngle * 10) / 10,
    spunAt: Date.now(),
  };
}

export function drawLots(participants, labels) {
  if (!Array.isArray(participants) || participants.length < 1)
    throw new AppError(400, "추첨 대상자를 1명 이상 등록해 주세요.");
  const pool = [...labels];
  while (pool.length < participants.length) pool.push("꽝");
  const trimmedPool = pool.slice(0, participants.length);
  for (let i = trimmedPool.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [trimmedPool[i], trimmedPool[j]] = [trimmedPool[j], trimmedPool[i]];
  }
  return participants.map((name, idx) => ({
    name,
    result: trimmedPool[idx],
    isWinner: trimmedPool[idx] !== "꽝" && trimmedPool[idx] !== "통과",
  }));
}

export function generateLadder(players, outcomes) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 12)
    throw new AppError(400, "사다리타기는 2~12명 사이로 설정해 주세요.");
  const cols = players.length;
  const rows = Math.max(7, cols + 3);
  const rungs = [];
  for (let r = 0; r < rows; r++) {
    const rowRungs = Array(cols - 1).fill(false);
    for (let c = 0; c < cols - 1; c++) {
      if (c > 0 && rowRungs[c - 1]) continue;
      if (randomInt(0, 100) < 48) rowRungs[c] = true;
    }
    // Guarantee at least one bridge on sparse rows when cols >= 2
    if (!rowRungs.some(Boolean) && r % 2 === 0) {
      rowRungs[randomInt(0, cols - 1)] = true;
    }
    rungs.push(rowRungs);
  }
  const normalizedOutcomes = Array.from({ length: cols }, (_, i) =>
    outcomes?.[i]?.trim() ? outcomes[i].trim() : i === 0 ? "당첨" : "통과",
  );
  const paths = players.map((player, startCol) => {
    let col = startCol;
    const steps = [{ r: 0, c: col }];
    for (let r = 0; r < rows; r++) {
      steps.push({ r: r + 0.5, c: col });
      if (col < cols - 1 && rungs[r][col]) {
        col = col + 1;
        steps.push({ r: r + 0.5, c: col });
      } else if (col > 0 && rungs[r][col - 1]) {
        col = col - 1;
        steps.push({ r: r + 0.5, c: col });
      }
      steps.push({ r: r + 1, c: col });
    }
    return {
      player,
      startCol,
      endCol: col,
      outcome: normalizedOutcomes[col],
      steps,
    };
  });
  return { players, outcomes: normalizedOutcomes, rows, rungs, paths };
}

const STOP = new Set(
  "그리고 그러나 그래서 하지만 저는 제가 나는 내가 우리는 우리 오늘 정말 너무 조금 그냥 이것 저것 여기 거기 그것 있습니다 있어요 합니다 하는 하고 되는 대한 위해 수 있는 없는 입니다 입니다만 에서 으로 하고요 the a an and or but is are was were to for of in on at it this that with as be have has i we you your my our hello thank thanks ai".split(
    " ",
  ),
);
const SUFFIX =
  /(에서는|으로는|이라고|이라는|에서|에게|까지|부터|처럼|보다|하고|이랑|으로|은|는|을|를|이|가|의|에|와|과|도|로)$/u;
const EXCEPTIONS = new Set([
  "데이터",
  "아이디어",
  "디자인",
  "이야기",
  "공유",
  "대화",
  "참여",
  "수다온",
  "강의",
  "회의",
  "발표",
  "차이",
]);
export function tokens(value, exclusions = []) {
  const excluded = new Set(
    exclusions.map((x) => x.normalize("NFKC").toLowerCase()),
  );
  const words =
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/^@ai\b/giu, " ")
      .match(/[\p{L}\p{N}]+/gu) || [];
  return [
    ...new Set(
      words
        .map((w) => {
          if (!EXCEPTIONS.has(w) && /^[가-힣]{3,}$/u.test(w))
            w = w.replace(SUFFIX, "");
          return w;
        })
        .filter(
          (w) =>
            w.length >= 2 &&
            !/^\d+$/u.test(w) &&
            !STOP.has(w) &&
            !excluded.has(w),
        ),
    ),
  ];
}
export function keywords(state, scope = "recent", now = Date.now()) {
  const scores = new Map();
  for (const m of state.messages) {
    if (
      m.deleted ||
      m.role === "ai" ||
      (scope !== "all" && m.at < now - 300000)
    )
      continue;
    for (const word of tokens(m.text, state.exclusions)) {
      const row = scores.get(word) || { word, count: 0, people: new Set() };
      row.count++;
      row.people.add(m.participantId);
      scores.set(word, row);
    }
  }
  return [...scores.values()]
    .map((r) => ({ word: r.word, count: r.count, sessions: r.people.size }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "ko"))
    .slice(0, 30);
}
