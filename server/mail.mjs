import { AppError, keywords, summarizePoll } from "./model.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function mailConfiguration(env = process.env) {
  const resendKey = env.RESEND_API_KEY || "";
  const webhookUrl = env.SUDAON_EMAIL_WEBHOOK_URL || "";
  const from = env.SUDAON_MAIL_FROM || "SudaOn <noreply@sudaon.app>";
  const configured = Boolean(resendKey || webhookUrl);
  return {
    configured,
    provider: resendKey ? "resend" : webhookUrl ? "webhook" : "mailto",
    from,
  };
}

export function buildSummaryDocument(state, { pollId = null, includeChat = true } = {}) {
  const createdStr = new Date(state.room.createdAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
  });
  const topWords = keywords(state, "all").slice(0, 10);
  const publicMessages = (state.messages || []).filter((m) => !m.deleted);
  const targetPolls = pollId
    ? (state.polls || []).filter((p) => p.id === pollId)
    : state.polls || [];

  const lines = [
    `[수다온 결과 요약] ${state.room.title}`,
    `생성 시각: ${createdStr} (Asia/Seoul)`,
    `상태: ${state.room.status === "open" ? "진행 중" : "종료됨"}`,
    `총 참여 세션: ${Object.keys(state.participants || {}).length}세션`,
    `공개 메시지 수: ${publicMessages.length}개`,
    "",
  ];

  if (topWords.length) {
    lines.push("■ 인기 키워드 TOP 10");
    for (const [idx, k] of topWords.entries()) {
      lines.push(`  ${idx + 1}. ${k.word} — ${k.count}회 언급 (${k.sessions}세션)`);
    }
    lines.push("");
  }

  if (targetPolls.length) {
    lines.push("■ 실시간 설문 결과");
    for (const rawPoll of targetPolls) {
      const p = summarizePoll(rawPoll, null, true);
      lines.push(`▶ 설문: ${p.title} (응답 ${p.totalResponses}명 · ${p.status === "open" ? "진행 중" : "종료"})`);
      for (const q of p.questions) {
        lines.push(`  Q. ${q.prompt}`);
        if (q.type === "text") {
          if (!q.textAnswers.length) lines.push("    - (응답 없음)");
          for (const ans of q.textAnswers.slice(0, 30)) {
            lines.push(`    - ${ans.text}`);
          }
        } else {
          q.options.forEach((opt, i) => {
            lines.push(`    - ${opt}: ${q.counts[i]}표 (${q.percentages[i]}%)`);
          });
        }
      }
      lines.push("");
    }
  }

  if (includeChat && publicMessages.length) {
    lines.push("■ 최근 주요 대화 (최대 30건)");
    for (const m of publicMessages.slice(-30)) {
      const t = new Date(m.at).toLocaleTimeString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      lines.push(`  [${t}] ${m.nickname}: ${m.text}`);
    }
  }

  const subject = `[수다온] ${state.room.title} — 설문 및 대화 결과 요약`;
  const textBody = lines.join("\n");
  return { subject, text: textBody };
}

export function createMailService(options = {}) {
  async function preview(state, params = {}) {
    const to = String(params.to || "").trim();
    if (to && !EMAIL_RE.test(to)) {
      throw new AppError(400, "유효한 수신 이메일 주소를 입력해 주세요.");
    }
    const doc = buildSummaryDocument(state, params);
    const config = mailConfiguration(options.env || process.env);
    return {
      ...doc,
      to,
      configured: config.configured,
      provider: config.provider,
    };
  }

  async function send(state, params = {}) {
    const to = String(params.to || "").trim();
    if (!EMAIL_RE.test(to)) {
      throw new AppError(400, "유효한 수신 이메일 주소를 입력해 주세요.");
    }
    if (params.confirmed !== true) {
      throw new AppError(400, "전송 전 미리보기 확인(명시적 전송 승인)이 필요합니다.");
    }
    const doc = buildSummaryDocument(state, params);
    const env = options.env || process.env;
    const config = mailConfiguration(env);

    if (options.adapter) {
      await options.adapter({ to, ...doc });
      return { sent: true, mode: "server", to, subject: doc.subject };
    }

    if (env.RESEND_API_KEY) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.from,
          to: [to],
          subject: doc.subject,
          text: doc.text,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        throw new AppError(
          502,
          "이메일 발송 서비스 요청에 실패했습니다. 설정 또는 수신 주소를 확인해 주세요.",
        );
      }
      return { sent: true, mode: "resend", to, subject: doc.subject };
    }

    if (env.SUDAON_EMAIL_WEBHOOK_URL) {
      const response = await fetch(env.SUDAON_EMAIL_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject: doc.subject, text: doc.text }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        throw new AppError(502, "이메일 웹훅 전송에 실패했습니다.");
      }
      return { sent: true, mode: "webhook", to, subject: doc.subject };
    }

    const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(doc.subject)}&body=${encodeURIComponent(doc.text.slice(0, 1800))}`;
    return {
      sent: false,
      configured: false,
      mode: "mailto_fallback",
      to,
      subject: doc.subject,
      text: doc.text,
      mailtoUrl,
      notice:
        "서버 메일 발송 키(RESEND_API_KEY)가 설정되지 않아 사용자 기본 메일 앱 열기 및 요약 본문 복사를 제공합니다.",
    };
  }

  return { preview, send, configuration: mailConfiguration };
}
