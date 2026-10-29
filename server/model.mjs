import { randomBytes, createHash } from "node:crypto";

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
export function reduce(state, event) {
  const { type, data, seq, at } = event;
  if (!state && type === "created")
    state = {
      room: data,
      participants: {},
      messages: [],
      seq: 0,
      at,
      exclusions: [],
    };
  if (!state) throw new AppError(404, "채팅방을 찾을 수 없습니다.");
  if (type === "joined") state.participants[data.id] = data;
  if (type === "message") state.messages.push({ ...data, seq, at });
  if (type === "deleted") {
    const message = state.messages.find((m) => m.id === data.id);
    if (message) {
      message.deleted = true;
      message.text = "";
    }
  }
  if (type === "kicked" && state.participants[data.id])
    state.participants[data.id].kicked = true;
  if (type === "closed") state.room.status = "closed";
  if (type === "exclusions") state.exclusions = data.words;
  state.seq = seq;
  state.at = at;
  return state;
}
export function publicEvent(event) {
  if (event.type === "joined") {
    const { tokenHash, ...data } = event.data;
    return { ...event, data };
  }
  return event;
}
export function publicState(state) {
  return {
    room: state.room,
    seq: state.seq,
    participants: Object.values(state.participants).map(
      ({ tokenHash, ...p }) => p,
    ),
    messages: state.messages.slice(-100),
    exclusions: state.exclusions,
    totalMessages: state.messages.filter((m) => !m.deleted).length,
    earliestSeq: state.messages.slice(-100)[0]?.seq || 0,
  };
}

const STOP = new Set(
  "그리고 그러나 그래서 하지만 저는 제가 나는 내가 우리는 우리 오늘 정말 너무 조금 그냥 이것 저것 여기 거기 그것 있습니다 있어요 합니다 하는 하고 되는 대한 위해 수 있는 없는 입니다 입니다만 에서 으로 하고요 the a an and or but is are was were to for of in on at it this that with as be have has i we you your my our hello thank thanks".split(
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
    if (m.deleted || (scope !== "all" && m.at < now - 300000)) continue;
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
