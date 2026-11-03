import React, { useState } from "react";
import {
  Plus,
  X,
  Check,
  Download,
  Mail,
  Send,
  Sparkles,
  Bot,
  ShieldCheck,
  Copy,
  ExternalLink,
} from "lucide-react";
import { api } from "./api";

/* =========================================================
 * 실시간 설문 & 이메일 발송 (Section 10)
 * ========================================================= */
export function SurveyApp({ roomId, polls = [], isOwner, audience, onError }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [questions, setQuestions] = useState([
    { type: "single", prompt: "", options: ["찬성", "반대"] },
  ]);
  const [draftVotes, setDraftVotes] = useState({});
  const [submitting, setSubmitting] = useState("");
  const [emailModalPollId, setEmailModalPollId] = useState(null);

  const addQuestion = () => {
    if (questions.length >= 8) return;
    setQuestions([
      ...questions,
      { type: "single", prompt: "", options: ["선택지 1", "선택지 2"] },
    ]);
  };

  const createPoll = async (e) => {
    e.preventDefault();
    setSubmitting("create");
    try {
      await api(`/rooms/${roomId}/polls`, {
        method: "POST",
        body: { title, anonymous, questions },
      });
      setCreating(false);
      setTitle("");
      setQuestions([{ type: "single", prompt: "", options: ["찬성", "반대"] }]);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSubmitting("");
    }
  };

  const submitVote = async (poll) => {
    setSubmitting(poll.id);
    try {
      const answers = draftVotes[poll.id] || poll.myResponse || {};
      await api(
        `/rooms/${roomId}/polls/${poll.id}/vote${audience ? "?audience=1" : ""}`,
        {
          method: "POST",
          body: { answers },
        },
      );
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSubmitting("");
    }
  };

  const closePoll = async (pollId) => {
    try {
      await api(`/rooms/${roomId}/polls/${pollId}/close`, { method: "POST" });
    } catch (err) {
      onError?.(err.message);
    }
  };

  const setAnswer = (pollId, qId, val) => {
    setDraftVotes((prev) => ({
      ...prev,
      [pollId]: { ...(prev[pollId] || {}), [qId]: val },
    }));
  };

  return (
    <div className="survey-module">
      {isOwner && (
        <div className="survey-toolbar">
          <button
            type="button"
            className="button sm"
            onClick={() => setCreating((v) => !v)}
          >
            <Plus size={15} /> {creating ? "작성 취소" : "새 설문 만들기"}
          </button>
          <button
            type="button"
            className="button secondary sm"
            onClick={() => setEmailModalPollId("ALL")}
          >
            <Mail size={14} /> 요약 이메일 발송
          </button>
        </div>
      )}

      {creating && isOwner && (
        <form className="poll-create-card" onSubmit={createPoll}>
          <h4>실시간 설문 만들기</h4>
          <label>
            설문 제목
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 오늘 세미나 만족도 및 다음 주제 투표"
              minLength={2}
              maxLength={100}
              required
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />
            익명 응답으로 수집
          </label>

          {questions.map((q, qIdx) => (
            <div className="poll-q-editor" key={qIdx}>
              <div className="poll-q-head">
                <b>문항 {qIdx + 1}</b>
                <select
                  value={q.type}
                  onChange={(e) => {
                    const next = [...questions];
                    next[qIdx] = {
                      ...q,
                      type: e.target.value,
                      options:
                        e.target.value === "text"
                          ? []
                          : q.options?.length >= 2
                            ? q.options
                            : ["선택지 1", "선택지 2"],
                    };
                    setQuestions(next);
                  }}
                >
                  <option value="single">객관식 (단일 선택)</option>
                  <option value="multiple">객관식 (복수 선택)</option>
                  <option value="text">주관식 (자유 서술)</option>
                </select>
                {questions.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="문항 삭제"
                    onClick={() =>
                      setQuestions(questions.filter((_, i) => i !== qIdx))
                    }
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <input
                type="text"
                value={q.prompt}
                onChange={(e) => {
                  const next = [...questions];
                  next[qIdx] = { ...q, prompt: e.target.value };
                  setQuestions(next);
                }}
                placeholder="질문을 입력하세요"
                required
              />
              {q.type !== "text" && (
                <div className="poll-opts-editor">
                  {(q.options || []).map((opt, oIdx) => (
                    <div className="poll-opt-row" key={oIdx}>
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => {
                          const next = [...questions];
                          const opts = [...q.options];
                          opts[oIdx] = e.target.value;
                          next[qIdx] = { ...q, options: opts };
                          setQuestions(next);
                        }}
                        placeholder={`선택지 ${oIdx + 1}`}
                        required
                      />
                      {q.options.length > 2 && (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => {
                            const next = [...questions];
                            next[qIdx] = {
                              ...q,
                              options: q.options.filter((_, i) => i !== oIdx),
                            };
                            setQuestions(next);
                          }}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                  {q.options.length < 8 && (
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => {
                        const next = [...questions];
                        next[qIdx] = {
                          ...q,
                          options: [
                            ...q.options,
                            `선택지 ${q.options.length + 1}`,
                          ],
                        };
                        setQuestions(next);
                      }}
                    >
                      + 선택지 추가
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="poll-create-actions">
            <button
              type="button"
              className="button secondary sm"
              onClick={addQuestion}
            >
              + 문항 추가
            </button>
            <button
              type="submit"
              className="button sm"
              disabled={submitting === "create"}
            >
              설문 시작하기
            </button>
          </div>
        </form>
      )}

      {!polls.length && !creating ? (
        <div className="side-empty">
          <p>진행 중인 설문이 없습니다.</p>
          {isOwner && (
            <small>상단의 '새 설문 만들기'로 실시간 의견을 모아보세요.</small>
          )}
        </div>
      ) : (
        <div className="poll-list">
          {[...polls].reverse().map((poll) => {
            const currentAns = draftVotes[poll.id] || poll.myResponse || {};
            const hasVoted = Boolean(poll.myResponse);
            return (
              <article className="poll-card" key={poll.id}>
                <div className="poll-card-head">
                  <div>
                    <span className={`room-tag ${poll.status}`}>
                      {poll.status === "open" ? "진행 중" : "마감"}
                    </span>
                    {poll.anonymous && <span className="tag">익명</span>}
                    <h4>{poll.title}</h4>
                  </div>
                  <small>{poll.totalResponses}명 참여</small>
                </div>

                {poll.questions.map((q) => (
                  <div className="poll-question-block" key={q.id}>
                    <p className="poll-q-title">
                      Q. {q.prompt}{" "}
                      <small>
                        (
                        {q.type === "multiple"
                          ? "복수 선택"
                          : q.type === "text"
                            ? "주관식"
                            : "단일 선택"}
                        )
                      </small>
                    </p>

                    {q.type === "text" ? (
                      <>
                        {poll.status === "open" && (
                          <textarea
                            rows={2}
                            maxLength={300}
                            placeholder="주관식 의견을 입력해 주세요"
                            value={currentAns[q.id] || ""}
                            onChange={(e) =>
                              setAnswer(poll.id, q.id, e.target.value)
                            }
                          />
                        )}
                        {q.textAnswers?.length > 0 && (
                          <div className="poll-text-answers">
                            {q.textAnswers.slice(-6).map((ans, idx) => (
                              <div key={idx} className="poll-text-item">
                                {ans.nickname && <b>{ans.nickname}: </b>}
                                <span>{ans.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="poll-options-list">
                        {q.options.map((opt, idx) => {
                          const pct = q.percentages?.[idx] || 0;
                          const cnt = q.counts?.[idx] || 0;
                          const selected =
                            q.type === "multiple"
                              ? Array.isArray(currentAns[q.id]) &&
                                currentAns[q.id].includes(idx)
                              : currentAns[q.id] === idx;
                          return (
                            <button
                              key={idx}
                              type="button"
                              disabled={poll.status !== "open"}
                              className={`poll-opt-bar ${selected ? "selected" : ""}`}
                              onClick={() => {
                                if (poll.status !== "open") return;
                                if (q.type === "multiple") {
                                  const prevArr = Array.isArray(
                                    currentAns[q.id],
                                  )
                                    ? currentAns[q.id]
                                    : [];
                                  const nextArr = prevArr.includes(idx)
                                    ? prevArr.filter((v) => v !== idx)
                                    : [...prevArr, idx];
                                  setAnswer(poll.id, q.id, nextArr);
                                } else {
                                  setAnswer(poll.id, q.id, idx);
                                }
                              }}
                            >
                              <i style={{ width: `${pct}%` }} />
                              <span className="opt-label">
                                {selected && <Check size={14} />}
                                {opt}
                              </span>
                              <b className="opt-stat">
                                {cnt}표 ({pct}%)
                              </b>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}

                <div className="poll-card-actions">
                  {poll.status === "open" && (
                    <button
                      type="button"
                      className="button sm"
                      disabled={submitting === poll.id}
                      onClick={() => submitVote(poll)}
                    >
                      {hasVoted ? "응답 수정하기" : "투표 제출하기"}
                    </button>
                  )}
                  {isOwner && (
                    <>
                      {poll.status === "open" && (
                        <button
                          type="button"
                          className="button secondary sm"
                          onClick={() => closePoll(poll.id)}
                        >
                          설문 마감
                        </button>
                      )}
                      <a
                        className="button secondary sm"
                        href={`/api/rooms/${roomId}/polls/${poll.id}/export`}
                      >
                        <Download size={13} /> 결과 내보내기
                      </a>
                      <button
                        type="button"
                        className="button secondary sm"
                        onClick={() => setEmailModalPollId(poll.id)}
                      >
                        <Mail size={13} /> 이메일
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {emailModalPollId && isOwner && (
        <EmailSummarySection
          roomId={roomId}
          pollId={emailModalPollId === "ALL" ? null : emailModalPollId}
          onClose={() => setEmailModalPollId(null)}
          onError={onError}
        />
      )}
    </div>
  );
}

function EmailSummarySection({ roomId, pollId, onClose, onError }) {
  const [to, setTo] = useState("");
  const [includeChat, setIncludeChat] = useState(true);
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const loadPreview = async (e) => {
    e.preventDefault();
    setSending(true);
    setResult(null);
    try {
      const data = await api(`/rooms/${roomId}/email/preview`, {
        method: "POST",
        body: { to, pollId, includeChat },
      });
      setPreview(data);
      setConfirmed(false);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSending(false);
    }
  };

  const confirmAndSend = async () => {
    if (!confirmed) return;
    setSending(true);
    try {
      const res = await api(`/rooms/${roomId}/email/send`, {
        method: "POST",
        body: { to, pollId, includeChat, confirmed: true },
      });
      setResult(res);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="email-drawer-card">
      <div className="email-drawer-head">
        <h4>
          <Mail size={16} /> 설문·대화 요약 이메일 전송
        </h4>
        <button type="button" className="icon-button" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <form onSubmit={loadPreview}>
        <label>
          수신 이메일 주소
          <input
            type="email"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPreview(null);
              setResult(null);
            }}
            placeholder="example@domain.com"
            required
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={includeChat}
            onChange={(e) => {
              setIncludeChat(e.target.checked);
              setPreview(null);
            }}
          />
          최근 주요 채팅 내역(최대 30건) 함께 포함
        </label>
        <button
          type="submit"
          className="button secondary full"
          disabled={sending}
        >
          1단계: 전송 내용 미리보기 생성
        </button>
      </form>

      {preview && !result && (
        <div className="email-preview-box">
          <b>제목: {preview.subject}</b>
          <pre>{preview.text}</pre>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            수신 주소({preview.to})와 개인정보·설문 내용 포함 여부를 확인했으며 전송에 동의합니다.
          </label>
          <button
            type="button"
            className="button full"
            disabled={!confirmed || sending}
            onClick={confirmAndSend}
          >
            <Send size={15} /> {sending ? "발송 처리 중…" : "2단계: 확인 후 이메일 보내기"}
          </button>
        </div>
      )}

      {result && (
        <div className="email-result-box">
          {result.sent ? (
            <p className="email-ok">
              ✅ {result.to} 주소로 요약 이메일이 정상 발송되었습니다!
            </p>
          ) : (
            <>
              <p className="muted">{result.notice}</p>
              <div className="lots-btn-row">
                <a className="button sm" href={result.mailtoUrl}>
                  <ExternalLink size={14} /> 기본 메일 앱으로 열기
                </a>
                <button
                  type="button"
                  className="button secondary sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(result.text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "복사됨" : "요약 본문 복사"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================
 * AI 도우미 패널 (Section 8)
 * ========================================================= */
const AI_QUICK_PROMPTS = [
  { label: "📋 대화 요약", prompt: "지금까지 나눈 대화를 핵심 위주로 요약해 줘" },
  { label: "🍽️ 점심 추천", prompt: "오늘 다 같이 먹기 좋은 점심 메뉴 추천해 줘" },
  { label: "🎯 깜짝 퀴즈", prompt: "분위기 띄울 수 있는 재미있는 퀴즈 하나 내줘" },
  { label: "🎮 게임 추천", prompt: "지금 우리끼리 같이 할 만한 게임 추천해 줘" },
  { label: "📊 설문 문항", prompt: "이 방 주제에 어울리는 실시간 설문 문항을 만들어 줘" },
  { label: "💡 브레인스토밍", prompt: "우리 주제와 관련된 신선한 아이디어 3가지만 제안해 줘" },
];

export function AiToolApp({
  roomId,
  aiEnabled = true,
  aiStatus,
  aiFeatureInfo,
  isOwner,
  audience,
  onError,
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const askAi = async (textToAsk) => {
    const q = (textToAsk || prompt).trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      await api(`/rooms/${roomId}/ai${audience ? "?audience=1" : ""}`, {
        method: "POST",
        body: { prompt: q },
      });
      if (!textToAsk) setPrompt("");
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleAi = async (enabled) => {
    try {
      await api(`/rooms/${roomId}/ai-settings`, {
        method: "PUT",
        body: { enabled },
      });
    } catch (err) {
      onError?.(err.message);
    }
  };

  return (
    <div className="ai-tool-module">
      <div className="ai-info-banner">
        <div className="ai-badge-row">
          <span className="ai-avatar-chip">
            <Bot size={16} /> 수다온 AI
          </span>
          <span className="tag">
            {aiFeatureInfo?.external
              ? `${aiFeatureInfo.provider.toUpperCase()} · ${aiFeatureInfo.model}`
              : "내장 스마트 어시스턴트"}
          </span>
        </div>
        <p>
          채팅창에서 <code>@AI 질문내용</code>을 입력하거나 아래 빠른 도구로 호출하면 모든 참여자에게 실시간 공유됩니다.
        </p>
        <small className="ai-privacy-note">
          <ShieldCheck size={13} />{" "}
          {aiFeatureInfo?.privacyNotice ||
            "호출 시 최근 공개 대화 최대 20건과 방 제목·인기 키워드만 전달됩니다."}
        </small>
      </div>

      {isOwner && (
        <label className="check-label ai-owner-toggle">
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(e) => toggleAi(e.target.checked)}
          />
          이 채팅방에서 AI 참여 허용
        </label>
      )}

      {!aiEnabled ? (
        <div className="side-empty">
          <p>관리자가 이 채팅방의 AI 호출을 비활성화했습니다.</p>
        </div>
      ) : (
        <>
          <div className="ai-quick-grid">
            {AI_QUICK_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                className="ai-quick-btn"
                disabled={busy || aiStatus?.thinking}
                onClick={() => askAi(item.prompt)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <form
            className="ai-ask-form"
            onSubmit={(e) => {
              e.preventDefault();
              askAi();
            }}
          >
            <textarea
              rows={2}
              maxLength={400}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="수다온 AI에게 질문·요약·퀴즈·정리를 요청해 보세요"
            />
            <button
              type="submit"
              className="button full"
              disabled={!prompt.trim() || busy || aiStatus?.thinking}
            >
              <Sparkles size={15} />{" "}
              {busy || aiStatus?.thinking
                ? "수다온 AI가 응답 작성 중…"
                : "채팅방에 AI 응답 부르기"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
