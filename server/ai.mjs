import { randomInt } from "node:crypto";
import { AppError, keywords } from "./model.mjs";

const DEPRECATED_GEMINI = /^gemini-(1\.5|2\.0|2\.5)/i;

export function aiConfiguration(env = process.env) {
  const explicitProvider = (env.SUDAON_AI_PROVIDER || "").toLowerCase();
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
  const openaiKey = env.OPENAI_API_KEY || "";

  let provider = "builtin";
  if (explicitProvider === "gemini" && geminiKey) provider = "gemini";
  else if (explicitProvider === "openai" && openaiKey) provider = "openai";
  else if (!explicitProvider && geminiKey) provider = "gemini";
  else if (!explicitProvider && openaiKey) provider = "openai";

  let model = env.SUDAON_AI_MODEL || "";
  if (provider === "gemini") {
    if (!model || DEPRECATED_GEMINI.test(model)) model = "gemini-3.8-flash";
  } else if (provider === "openai") {
    if (!model) model = "gpt-4o-mini";
  } else {
    model = "sudaon-smart-ko-v1";
  }

  return {
    provider,
    model,
    external: provider !== "builtin",
    contextLimit: 20,
    maxOutputLength: 750,
    privacyNotice:
      "호출 시 최근 공개 대화 최대 20건과 방 제목·인기 키워드만 전달되며, 삭제된 메시지는 제외됩니다.",
  };
}

function sanitizeOutput(raw, maxLen = 750) {
  const cleaned = String(raw || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, "")
    .trim();
  if (!cleaned) throw new AppError(502, "AI 응답이 비어 있습니다.");
  return [...cleaned].length > maxLen
    ? `${[...cleaned].slice(0, maxLen - 1).join("")}…`
    : cleaned;
}

function buildContextSummary(state, maxMessages = 20) {
  const recent = (state.messages || [])
    .filter((m) => !m.deleted && m.role !== "ai")
    .slice(-maxMessages);
  const topWords = keywords(state, "all").slice(0, 8);
  const activeCount = Object.values(state.participants || {}).filter(
    (p) => !p.left && !p.kicked,
  ).length;
  return { recent, topWords, activeCount };
}

function buildSystemInstruction(state, context) {
  const kwText = context.topWords.length
    ? context.topWords.map((k) => `${k.word}(${k.count}회)`).join(", ")
    : "아직 집계된 키워드 없음";
  return [
    "당신은 실시간 그룹 채팅·발표 플랫폼 '수다온(SudaOn)'의 친절하고 재치 있는 AI 참여자 '수다온 AI'입니다.",
    `현재 채팅방 제목: "${state.room.title}" / 참여 인원: 약 ${context.activeCount}명`,
    `주요 키워드: ${kwText}`,
    "원칙:",
    "1. 한국어로 간결하고 읽기 쉽게(최대 6~8문장 내외, 핵심 위주) 답변하세요.",
    "2. 대화 요약, 질문 답변, 브레인스토밍, 키워드 분석, 퀴즈 출제, 게임 진행 보조(테트리스·스트레스 해소·점심 메뉴 다트·제비뽑기·사다리타기), 설문 문항 추천, 회의 정리를 자연스럽게 수행하세요.",
    "3. HTML/스크립트 태그를 절대 출력하지 마세요.",
  ].join("\n");
}

async function callGemini({ prompt, systemInstruction, model, apiKey }) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
        "Api-Revision": "2026-05-20",
      },
      body: JSON.stringify({
        model,
        system_instruction: systemInstruction,
        input: prompt,
        store: false,
        generation_config: {
          thinking_level: "low",
          max_output_tokens: 600,
        },
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) {
    throw new AppError(
      502,
      "외부 AI 서비스 응답이 지연되거나 실패했습니다. 잠시 후 다시 호출해 주세요.",
    );
  }
  const data = await response.json();
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }
  const texts = [];
  for (const step of data.steps || []) {
    if (step.type === "model_output") {
      for (const item of step.content || []) {
        if (item.type === "text" && item.text) texts.push(item.text);
      }
    }
  }
  return texts.join("\n");
}

async function callOpenAI({
  prompt,
  systemInstruction,
  model,
  apiKey,
  baseUrl,
}) {
  const endpoint = `${(baseUrl || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new AppError(
      502,
      "외부 AI 서비스 응답이 지연되거나 실패했습니다. 잠시 후 다시 호출해 주세요.",
    );
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

const LUNCH_MENUS = [
  ["김치찌개 & 계란말이", "든든하고 호불호 없는 한국인의 소울푸드!"],
  ["수제 돈까스 & 냉모밀", "바삭한 식감과 시원한 국물의 완벽 조합이에요."],
  ["쌀국수 & 짜조", "속이 편안하면서도 감칠맛 나는 따끈한 한 끼!"],
  ["제육볶음 쌈밥 정식", "에너지 충전이 필요할 때 최고예요."],
  ["연어 포케 & 아보카도 볼", "가볍고 산뜻하게 오후 집중력을 높여줘요."],
  ["마라탕 / 마라샹궈", "스트레스가 확 풀리는 매콤 얼얼한 맛!"],
  ["화덕 피자 & 파스타", "팀원들과 함께 나눠 먹기 좋은 메뉴예요."],
  ["비빔밥 & 된장국", "영양 밸런스가 뛰어난 깔끔한 선택!"],
];

const QUIZZES = [
  {
    q: "세상에서 가장 빠른 닭은 무엇일까요?",
    a: "후다닥! 🐔 (정답을 아셨다면 채팅에 웃음을 남겨주세요!)",
  },
  {
    q: "왕이 넘어지면 무엇이 될까요?",
    a: "킹콩! 👑",
  },
  {
    q: "웹에서 실시간 양방향 통신을 위해 수다온에서도 사용하는 프로토콜의 이름은?",
    a: "WebSocket(웹소켓)입니다! ⚡",
  },
  {
    q: "커피를 마시기 전에 하는 인사는 무엇일까요?",
    a: "원두(One-Two) 쓰리 포! ☕",
  },
  {
    q: "바나나가 웃으면 무엇이 될까요?",
    a: "바나나킥! 🍌",
  },
];

function builtinAssistant({ cleanPrompt, state, sender, context }) {
  const p = cleanPrompt.toLowerCase();
  const { recent, topWords, activeCount } = context;

  if (/(요약|정리|회의록|지금 대화|무슨 얘기)/u.test(p)) {
    const validRecent = recent.filter((m) => !/^@ai\b/iu.test(m.text));
    if (!validRecent.length) {
      return `📋 [${state.room.title}] 아직 요약할 일반 대화가 충분하지 않아요. 먼저 자유롭게 의견을 나눠보시면 핵심 내용을 깔끔하게 정리해 드릴게요!`;
    }
    const speakers = [...new Set(validRecent.map((m) => m.nickname))];
    const kwLine = topWords.length
      ? topWords
          .slice(0, 5)
          .map((k) => `#${k.word}(${k.count})`)
          .join(" ")
      : "집계 중";
    const highlights = validRecent
      .slice(-4)
      .map((m) => `• ${m.nickname}: "${m.text.slice(0, 60)}"`)
      .join("\n");
    return [
      `📋 [${state.room.title}] 실시간 대화 요약`,
      `- 참여 흐름: ${speakers.length}명 발언 (최근 ${validRecent.length}건 기준)`,
      `- 핵심 키워드: ${kwLine}`,
      `- 주요 발언:\n${highlights}`,
    ].join("\n");
  }

  if (/(키워드|단어|관심사|트렌드|분위기)/u.test(p)) {
    if (!topWords.length) {
      return "🔍 아직 분석할 키워드가 모이지 않았어요. 몇 마디 더 대화를 나누면 인기 단어를 바로 분석해 드립니다!";
    }
    const list = topWords
      .slice(0, 5)
      .map((k, idx) => `${idx + 1}위 '${k.word}' (${k.count}회 언급, ${k.sessions}명)`)
      .join("\n");
    return `📊 현재 채팅방 핵심 키워드 분석입니다!\n${list}\n가장 뜨거운 주제는 '${topWords[0].word}'이네요!`;
  }

  if (/(점심|저녁|메뉴|밥|먹을|야식|간식)/u.test(p)) {
    const pick1 = LUNCH_MENUS[randomInt(0, LUNCH_MENUS.length)];
    let pick2 = LUNCH_MENUS[randomInt(0, LUNCH_MENUS.length)];
    if (pick2[0] === pick1[0])
      pick2 = LUNCH_MENUS[(LUNCH_MENUS.indexOf(pick1) + 1) % LUNCH_MENUS.length];
    return [
      `🍽️ ${sender.nickname} 님을 위한 오늘의 추천 메뉴!`,
      `1) ${pick1[0]} — ${pick1[1]}`,
      `2) ${pick2[0]} — ${pick2[1]}`,
      `💡 다 같이 정하고 싶다면 하단 [게임] 버튼에서 '점심 메뉴 다트'를 돌려보세요!`,
    ].join("\n");
  }

  if (/(퀴즈|문제|수수께끼|상식)/u.test(p)) {
    const item = QUIZZES[randomInt(0, QUIZZES.length)];
    return `🎯 깜짝 퀴즈 타임!\nQ. ${item.q}\n\n(잠깐 생각해보세요... 정답: ${item.a})`;
  }

  if (/(게임|놀거리|레크리에이션|아이스브레이킹|심심)/u.test(p)) {
    return [
      `🎮 지금 ${Math.max(1, activeCount)}명이 함께 즐길 수 있는 수다온 추천 활동!`,
      `• 결정이 필요할 때: [점심 메뉴 다트] 또는 [사다리타기]`,
      `• 행운의 주인공 뽑기: [제비뽑기] (실시간 결과 동기화!)`,
      `• 가볍게 손 풀기: [테트리스] & [스트레스 해소 팝]`,
      `하단 입력창 옆 🎮 게임 아이콘을 눌러 바로 시작해 보세요!`,
    ].join("\n");
  }

  if (/(설문|투표|문항|의견 수렴)/u.test(p)) {
    return [
      `📊 [${state.room.title}] 추천 설문 문항 초안입니다:`,
      `1. (객관식 단일) 오늘 다룬 주제 중 가장 유익했던 파트는 무엇인가요?`,
      `   - ① 핵심 개념 소개  ② 실전 사례 공유  ③ 질의응답 및 토론`,
      `2. (객관식 복수) 다음 모임에서 다뤘으면 하는 주제를 골라주세요.`,
      `3. (주관식) 오늘 세션에서 느낀 점이나 건의사항을 자유롭게 남겨주세요.`,
      `💡 하단 [설문] 탭에서 바로 실시간 투표를 개설할 수 있습니다!`,
    ].join("\n");
  }

  if (/(아이디어|브레인스토밍|주제 추천|기획)/u.test(p)) {
    const focus = topWords[0]?.word || state.room.title;
    return [
      `💡 '${focus}' 관련 브레인스토밍 제안 3가지!`,
      `1. 현장의 가장 작은 불편함 1가지를 5분 안에 해결하는 마이크로 실험 해보기`,
      `2. 참여자 각자 키워드 1개씩 채팅에 던지고 워드클라우드 1위 주제 깊게 파기`,
      `3. 찬성/대안 관점으로 나누어 실시간 설문으로 빠른 의사결정 진행하기`,
    ].join("\n");
  }

  return [
    `✨ 안녕하세요, ${sender.nickname} 님! 수다온 AI입니다.`,
    `질문하신 "${cleanPrompt.slice(0, 80)}"에 대해 함께 이야기해 볼까요?`,
    `저는 다음 요청을 특히 잘 도와드려요:`,
    `• "@AI 지금 대화 요약해 줘" / "@AI 키워드 분석해 줘"`,
    `• "@AI 오늘 점심 메뉴 추천해 줘" / "@AI 재미있는 퀴즈 내줘"`,
    `• "@AI 설문 문항 만들어 줘" / "@AI 우리끼리 할 게임 추천해 줘"`,
  ].join("\n");
}

export function extractAiPrompt(messageText) {
  if (typeof messageText !== "string") return null;
  const match = messageText.trim().match(/^@ai(?:\s+|$)(.*)$/isu);
  if (!match) return null;
  return match[1].trim() || "인사와 함께 할 수 있는 기능을 알려줘";
}

export function createAiService(options = {}) {
  const activeRooms = new Set();

  async function ask({ roomId, prompt, state, sender, env = process.env }) {
    if (state.aiEnabled === false) {
      throw new AppError(403, "관리자가 이 채팅방의 AI 참여 기능을 비활성화했습니다.");
    }
    if (activeRooms.has(roomId)) {
      throw new AppError(
        429,
        "AI가 이전 요청에 응답하고 있습니다. 잠시 후 다시 호출해 주세요.",
      );
    }
    const cleanPrompt = String(prompt || "")
      .replace(/^@ai\s*/iu, "")
      .trim();
    if (!cleanPrompt || [...cleanPrompt].length > 400) {
      throw new AppError(400, "AI 질문은 1~400자 이내로 입력해 주세요.");
    }

    activeRooms.add(roomId);
    try {
      const config = aiConfiguration(env);
      const context = buildContextSummary(state, config.contextLimit);
      const systemInstruction = buildSystemInstruction(state, context);
      const recentTranscript = context.recent
        .map((m) => `[${m.nickname}]: ${m.text}`)
        .join("\n");
      const fullInput = [
        recentTranscript ? `최근 채팅 내역:\n${recentTranscript}\n` : "",
        `요청자(${sender.nickname})의 질문: ${cleanPrompt}`,
      ]
        .filter(Boolean)
        .join("\n");

      let rawReply;
      if (options.adapter) {
        rawReply = await options.adapter({
          prompt: cleanPrompt,
          fullInput,
          systemInstruction,
          state,
          sender,
          config,
        });
      } else if (config.provider === "gemini") {
        rawReply = await callGemini({
          prompt: fullInput,
          systemInstruction,
          model: config.model,
          apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
        });
      } else if (config.provider === "openai") {
        rawReply = await callOpenAI({
          prompt: fullInput,
          systemInstruction,
          model: config.model,
          apiKey: env.OPENAI_API_KEY,
          baseUrl: env.OPENAI_BASE_URL,
        });
      } else {
        rawReply = builtinAssistant({
          cleanPrompt,
          state,
          sender,
          context,
        });
      }

      return {
        text: sanitizeOutput(
          typeof rawReply === "object" && rawReply !== null
            ? rawReply.text
            : rawReply,
          config.maxOutputLength,
        ),
        provider: config.provider,
        model: config.model,
      };
    } finally {
      activeRooms.delete(roomId);
    }
  }

  return { ask, configuration: aiConfiguration };
}
