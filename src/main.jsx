import React, { useEffect, useState, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  MessageCircle,
  LayoutDashboard,
  History,
  BookOpen,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Users,
  MessagesSquare,
  Sparkles,
  Radio,
  QrCode,
  Copy,
  Check,
  X,
  LogOut,
  Send,
  Download,
  Monitor,
  PanelsTopLeft,
  Pin,
  PinOff,
  ChevronDown,
  ChevronUp,
  Trash2,
  UserRoundX,
  Settings2,
  ExternalLink,
  CircleHelp,
  MoreHorizontal,
  RotateCcw,
  ShieldCheck,
  Square,
  Clock3,
  EyeOff,
  Cloud,
  Laptop,
  Smile,
  Gamepad2,
  ClipboardList,
  Bot,
  Palette,
  Pencil,
  Maximize2,
  PictureInPicture2,
  Moon,
} from "lucide-react";
import QRCode from "qrcode";
import {
  api,
  navigate,
  localTime,
  localDate,
  clientDeviceType,
  deviceBadge,
} from "./api";
import { useRoom, useAutoScroll } from "./hooks";
import { EmojiPicker } from "./EmojiPicker";
import {
  loadUserTheme,
  computeThemeStyles,
  ThemeSettingsModal,
} from "./ThemeSettings";
import { WordCloudView } from "./WordCloudView";
import { SideAppHost, APP_MODULES } from "./SideApps";
import {
  QrZoomModal,
  DisplaySettingsContent,
  prefetchDisplayToken,
  launchWindowsDisplayApp,
} from "./PresentationModals";
import "./styles.css";

function Logo({ light = false }) {
  return (
    <a
      className={`logo ${light ? "light" : ""}`}
      href="/"
      onClick={(e) => {
        e.preventDefault();
        navigate("/");
      }}
      aria-label="수다온 홈"
    >
      <span className="logo-symbol">
        <MessageCircle size={22} strokeWidth={2.4} />
        <span />
      </span>
      <span>
        수다온<small>SUDAON</small>
      </span>
    </a>
  );
}

function Button({ children, variant = "", className = "", ...props }) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}

function Notice({ children }) {
  return children ? (
    <div className="notice" role="alert">
      <CircleHelp size={17} />
      <span>{children}</span>
    </div>
  ) : null;
}

function SetupPanel({ setup = {} }) {
  const project = "https://vercel.com/dalbits-projects-8eb7a82d/sudaon";
  return (
    <section className="panel setup-panel">
      <ShieldCheck size={35} />
      <span className="eyebrow">최초 1회 · 서비스 소유자 설정</span>
      <h2>방을 만들기 전에, 두 가지 설정이 필요해요</h2>
      <p>
        현재 온라인 채팅은 아직 열리지 않았습니다. 아래 설정과 재배포를 마치면
        발표자 로그인과 새 발표 만들기가 표시됩니다.
      </p>
      <ol className="setup-steps">
        <li>
          <div className="setup-step-heading">
            <h3>대화 기록 저장소 연결</h3>
            <span>{setup.storage ? "설정됨" : "설정 필요"}</span>
          </div>
          <p>
            Storage에서 Upstash for Redis를 만들고 <b>Free</b> 플랜을 선택한 뒤,
            이 프로젝트의 Production에 연결해 주세요. 다른 프로젝트의 저장소는
            연결하지 않아도 됩니다.
          </p>
          <a href={`${project}/stores`} target="_blank" rel="noreferrer">
            Vercel Storage 열기 <ArrowUpRight size={15} />
          </a>
        </li>
        <li>
          <div className="setup-step-heading">
            <h3>발표자 로그인 설정</h3>
            <span>
              {setup.ownerPassword && setup.sessionSecret
                ? "설정됨"
                : "설정 필요"}
            </span>
          </div>
          <p>
            Environment Variables에서 아래 두 항목을 <b>Production</b>에 추가해
            주세요. 실제 값은 이 화면이나 채팅에 보내지 마세요.
          </p>
          <dl className="setup-variables">
            <div>
              <dt>
                <code>SUDAON_OWNER_PASSWORD</code>
              </dt>
              <dd>
                발표자 암호 · 12자 이상{" "}
                {setup.ownerPassword && (
                  <Check size={14} aria-label="설정됨" />
                )}
              </dd>
            </div>
            <div>
              <dt>
                <code>SUDAON_SESSION_SECRET</code>
              </dt>
              <dd>
                세션 보호용 임의 문자열 · 32자 이상{" "}
                {setup.sessionSecret && (
                  <Check size={14} aria-label="설정됨" />
                )}
              </dd>
            </div>
          </dl>
          <a
            href={`${project}/settings/environment-variables`}
            target="_blank"
            rel="noreferrer"
          >
            환경 변수 설정 열기 <ArrowUpRight size={15} />
          </a>
        </li>
        <li>
          <h3>재배포 후 발표 시작</h3>
          <p>
            설정을 저장한 뒤 Deployments에서 최신 배포를 <b>Redeploy</b>해
            주세요. Ready가 되면 이 화면을 새로 확인하고 발표자 암호로
            로그인하세요.
          </p>
          <a href={`${project}/deployments`} target="_blank" rel="noreferrer">
            배포 화면 열기 <ArrowUpRight size={15} />
          </a>
        </li>
      </ol>
      <Button variant="secondary" onClick={() => location.reload()}>
        <RotateCcw size={16} />
        설정 상태 다시 확인
      </Button>
      <p className="setup-footnote">
        표시 상태는 현재 배포의 설정 유무입니다. 실제 저장소 연결은 로그인과 방
        생성 시 확인됩니다. 청중은 발표자가 만든 QR로 입장합니다.
      </p>
    </section>
  );
}

function Empty({ icon: Icon = MessagesSquare, title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={27} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

function Status({ connection = "online" }) {
  const online = connection === "online";
  return (
    <span className={`status ${online ? "" : "offline"}`}>
      <i />
      {online
        ? "실시간 연결"
        : connection === "connecting"
          ? "연결 중"
          : connection === "denied"
            ? "연결 확인 필요"
            : "다시 연결 중"}
    </span>
  );
}

function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    ref.current.showModal();
    ref.current
      .querySelector(
        'input:not([type="range"]):not([type="checkbox"]):not([type="color"]):not([type="file"]), textarea',
      )
      ?.focus();
    const dialog = ref.current;
    const close = () => onClose();
    dialog.addEventListener("cancel", close);
    return () => {
      dialog.removeEventListener("cancel", close);
      before?.focus?.();
    };
  }, []);
  return (
    <dialog ref={ref} className={`modal ${wide ? "modal-wide" : ""}`}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="닫기">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function PresenceBadge({ status = "online", compact = false }) {
  const isAway = status === "away";
  if (isAway) {
    return (
      <span
        className={`presence-badge away ${compact ? "compact" : ""}`}
        title="자리비움 (화면 꺼짐 또는 비활성 상태)"
        aria-label="자리비움"
      >
        <Moon size={compact ? 9 : 10} strokeWidth={2.5} />
        {!compact && <span>자리비움</span>}
      </span>
    );
  }
  return (
    <span
      className={`presence-badge online ${compact ? "compact" : ""}`}
      title="온라인"
      aria-label="온라인"
    >
      <i className="presence-dot" />
      {!compact && <span>온라인</span>}
    </span>
  );
}

/* =========================================================
 * 실시간 온라인 참여자 바 & 접이식 목록 (온라인/자리비움 아이콘 + PC/Mobile/Tablet + 관리자 배지)
 * ========================================================= */
function ParticipantBar({ meta, me }) {
  const [open, setOpen] = useState(false);
  const list = meta?.onlineParticipants || [];
  const totalCount = meta?.onlineTotal ?? list.length ?? meta?.online ?? 0;
  const onlineCount =
    meta?.activeOnlineCount ?? list.filter((p) => p.status !== "away").length;
  const awayCount =
    meta?.awayCount ?? list.filter((p) => p.status === "away").length;

  return (
    <div className="participant-bar-wrap">
      <button
        type="button"
        className="participant-toggle-btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="participant-summary">
          <Users size={14} />
          <b>참여 {totalCount}명</b>
          <span className="participant-status-counts">
            <span className="cnt-online">
              <i /> 온라인 {onlineCount}
            </span>
            {awayCount > 0 && (
              <span className="cnt-away">
                <Moon size={10} strokeWidth={2.4} /> 자리비움 {awayCount}
              </span>
            )}
          </span>
          <span className="participant-preview-avatars">
            {list.slice(0, 4).map((p) => {
              const badge = deviceBadge(p.device);
              const pStatus = p.status || "online";
              return (
                <span
                  key={p.id}
                  className={`mini-chip ${pStatus === "away" ? "is-away" : ""}`}
                  title={`${p.nickname} · ${pStatus === "away" ? "자리비움" : "온라인"} (${badge.label})`}
                >
                  <PresenceBadge status={pStatus} compact />
                  <span>
                    {badge.icon} {p.nickname}
                  </span>
                </span>
              );
            })}
            {list.length > 4 && (
              <span className="mini-chip more">+{list.length - 4}</span>
            )}
          </span>
        </span>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {open && (
        <div
          className="participant-drawer"
          role="region"
          aria-label="현재 접속자 목록"
        >
          {!list.length ? (
            <p className="muted">현재 표시할 접속자 정보가 없습니다.</p>
          ) : (
            <ul className="participant-list">
              {list.map((p) => {
                const badge = deviceBadge(p.device);
                const isMe = Boolean(me && p.id === me);
                const pStatus = p.status || "online";
                return (
                  <li
                    key={p.id}
                    className={`participant-item ${pStatus === "away" ? "is-away" : ""}`}
                  >
                    <span
                      className={`avatar sm ${
                        p.role === "owner"
                          ? "avatar-owner"
                          : `tone-${(p.nickname?.codePointAt(0) || 0) % 5}`
                      }`}
                    >
                      {p.nickname?.slice(0, 1)}
                    </span>
                    <span className="participant-name">
                      <b>{p.nickname}</b>
                      <PresenceBadge status={pStatus} />
                      {p.role === "owner" && (
                        <i className="role-badge owner">관리자</i>
                      )}
                      {isMe && <i className="role-badge me">나</i>}
                    </span>
                    <span className="device-pill" title={badge.label}>
                      <span aria-hidden="true">{badge.icon}</span>
                      <small>
                        {p.device === "mobile"
                          ? "모바일"
                          : p.device === "tablet"
                            ? "태블릿"
                            : "PC"}
                      </small>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================
 * 실시간 채팅 피드 (카카오톡 읽음 숫자 · 온라인/자리비움 배지 · 좌/우 말풍선 · 본인 수정 · AI 답변)
 * ========================================================= */
function MessageFeed({
  room,
  meta,
  aiStatus,
  manage = false,
  audience = false,
  display = false,
  onError,
  earlier,
  onRead,
}) {
  const messages = room?.messages || [];
  const systemMessages = room?.systemMessages || [];
  const activeMembers = meta?.onlineParticipants || [];
  const readCursors = meta?.readCursors || {};
  const memberStatusMap = useMemo(
    () => new Map(activeMembers.map((u) => [u.id, u.status || "online"])),
    [activeMembers],
  );
  const latestMessageSeq = useMemo(
    () =>
      messages.length
        ? messages.reduce((max, m) => Math.max(max, m.seq || 0), 0)
        : 0,
    [messages],
  );
  const timeline = useMemo(() => {
    const msgItems = messages.map((m) => ({
      itemType: "message",
      seq: m.seq || 0,
      at: m.at || 0,
      key: m.id,
      data: m,
    }));
    const sysItems = display
      ? []
      : systemMessages.map((s) => ({
          itemType: "system",
          seq: s.seq || 0,
          at: s.at || 0,
          key: s.id,
          data: s,
        }));
    return [...msgItems, ...sysItems].sort(
      (a, b) => a.seq - b.seq || a.at - b.at,
    );
  }, [messages, systemMessages, display]);

  const scroll = useAutoScroll([
    timeline.at(-1)?.key,
    timeline.length,
    aiStatus?.thinking,
  ]);
  const [menu, setMenu] = useState(null);
  const [hasEarlier, setHasEarlier] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const roomOpen = room?.room?.status === "open";

  useEffect(() => {
    setHasEarlier(true);
    setEditingId(null);
  }, [room?.room?.id]);

  useEffect(() => {
    if (display || !roomOpen || !latestMessageSeq || scroll.unread > 0) return;
    if (
      typeof document === "undefined" ||
      document.visibilityState !== "hidden"
    ) {
      onRead?.(latestMessageSeq);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && scroll.unread === 0) {
        onRead?.(latestMessageSeq);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [display, roomOpen, latestMessageSeq, scroll.unread, onRead]);

  const moderate = async (path, method) => {
    try {
      await api(path, { method });
      setMenu(null);
    } catch (e) {
      onError?.(e.message);
    }
  };

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditText(m.text);
    setMenu(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const saveEdit = async (m) => {
    const trimmed = editText.trim();
    if (!trimmed) {
      onError?.("빈 메시지로 수정할 수 없습니다.");
      return;
    }
    if (trimmed === m.text) {
      cancelEdit();
      return;
    }
    setSavingEdit(true);
    try {
      await api(
        `/rooms/${room.room.id}/messages/${m.id}${audience ? "?audience=1" : ""}`,
        {
          method: "PATCH",
          body: { text: trimmed },
        },
      );
      cancelEdit();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className={`feed-wrapper ${display ? "display-feed" : ""}`}>
      <div
        className="message-feed"
        ref={scroll.ref}
        onScroll={scroll.onScroll}
        role="log"
        aria-label="채팅 메시지"
        aria-live={display ? "off" : "polite"}
      >
        {earlier && messages.length >= 100 && hasEarlier && (
          <button
            className="earlier"
            onClick={async () => {
              try {
                if (!(await earlier())) setHasEarlier(false);
              } catch (e) {
                onError?.(e.message);
              }
            }}
          >
            이전 대화 보기
          </button>
        )}
        {!timeline.length && (
          <Empty title="첫 번째 목소리를 기다려요">
            QR로 입장한 청중의 대화가 이곳에 표시됩니다.
          </Empty>
        )}

        {timeline.map((entry) => {
          if (entry.itemType === "system") {
            const s = entry.data;
            return (
              <div className={`system-message kind-${s.kind}`} key={s.id}>
                <span>
                  {s.device && s.kind !== "close"
                    ? `${deviceBadge(s.device).icon} `
                    : ""}
                  {s.text}
                </span>
                <time>{localTime(s.at)}</time>
              </div>
            );
          }

          const m = entry.data;
          const isAi = m.role === "ai";
          const isOwnerMsg = m.role === "owner";
          const isMine =
            !display &&
            !isAi &&
            Boolean(room?.me) &&
            m.participantId === room.me;
          const dev = !isAi ? deviceBadge(m.device) : null;
          const isEditing = editingId === m.id;
          const senderStatus = !isAi
            ? memberStatusMap.get(m.participantId)
            : null;
          const unreadCount =
            roomOpen && !m.deleted && m.seq && activeMembers.length > 0
              ? activeMembers.reduce((acc, u) => {
                  if (u.id === m.participantId) return acc;
                  const cursor = readCursors[u.id] ?? u.readSeq ?? 0;
                  return cursor < m.seq ? acc + 1 : acc;
                }, 0)
              : 0;

          return (
            <div
              className={[
                "message",
                isMine ? "mine" : "theirs",
                isAi ? "ai-msg" : "",
                isOwnerMsg ? "owner-msg" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={m.id}
            >
              {!isMine && (
                <span
                  className={`avatar ${
                    isAi
                      ? "avatar-ai"
                      : isOwnerMsg
                        ? "avatar-owner"
                        : `tone-${(m.nickname?.codePointAt(0) || 0) % 5}`
                  }`}
                >
                  {isAi ? <Bot size={16} /> : m.nickname?.slice(0, 1)}
                </span>
              )}

              <div className="message-content">
                <div className="message-meta">
                  {isMine ? (
                    <>
                      {!display && !m.deleted && roomOpen && !isEditing && (
                        <button
                          type="button"
                          className="msg-inline-edit-btn"
                          onClick={() => startEdit(m)}
                          aria-label="내 메시지 수정"
                          title="메시지 수정"
                        >
                          <Pencil size={12} /> 수정
                        </button>
                      )}
                      {m.editedAt && !m.deleted && (
                        <span className="edited-badge">수정됨</span>
                      )}
                      <time>{localTime(m.at)}</time>
                      {dev && (
                        <span className="msg-device" title={dev.label}>
                          {dev.icon}
                        </span>
                      )}
                      {isOwnerMsg && (
                        <i className="role-badge owner">관리자</i>
                      )}
                      {senderStatus && (
                        <PresenceBadge status={senderStatus} compact={display} />
                      )}
                      <b>{m.nickname} · 나</b>
                    </>
                  ) : (
                    <>
                      <b>{m.nickname}</b>
                      {senderStatus && (
                        <PresenceBadge status={senderStatus} compact={display} />
                      )}
                      {isAi && <i className="role-badge ai">AI</i>}
                      {isOwnerMsg && (
                        <i className="role-badge owner">관리자</i>
                      )}
                      {dev && (
                        <span className="msg-device" title={dev.label}>
                          {dev.icon}
                        </span>
                      )}
                      <time>{localTime(m.at)}</time>
                      {m.editedAt && !m.deleted && (
                        <span className="edited-badge">수정됨</span>
                      )}
                    </>
                  )}
                </div>

                {isEditing ? (
                  <div className="message-edit-box">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={2}
                      maxLength={500}
                      aria-label="메시지 수정 입력"
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          saveEdit(m);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                    />
                    <div className="message-edit-actions">
                      <button
                        type="button"
                        className="button secondary sm"
                        onClick={cancelEdit}
                        disabled={savingEdit}
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        className="button sm"
                        onClick={() => saveEdit(m)}
                        disabled={savingEdit || !editText.trim()}
                      >
                        {savingEdit ? "저장 중…" : "저장"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="message-bubble-row">
                    {isMine && unreadCount > 0 && (
                      <span
                        className="msg-unread-count"
                        title={`아직 읽지 않은 참여자 ${unreadCount}명`}
                        aria-label={`안 읽음 ${unreadCount}명`}
                      >
                        {unreadCount}
                      </span>
                    )}
                    <p className={m.deleted ? "deleted" : ""}>
                      {m.deleted ? "삭제된 메시지입니다." : m.text}
                    </p>
                    {!isMine && unreadCount > 0 && (
                      <span
                        className="msg-unread-count"
                        title={`아직 읽지 않은 참여자 ${unreadCount}명`}
                        aria-label={`안 읽음 ${unreadCount}명`}
                      >
                        {unreadCount}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {manage && !m.deleted && !display && (
                <div className="message-menu">
                  <button
                    className="icon-button"
                    aria-label={`${m.nickname} 메시지 관리`}
                    aria-expanded={menu === m.id}
                    onClick={() => setMenu(menu === m.id ? null : m.id)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                  {menu === m.id && (
                    <div className="popover">
                      {isMine && roomOpen && (
                        <button onClick={() => startEdit(m)}>
                          <Pencil size={15} /> 내 메시지 수정
                        </button>
                      )}
                      <button
                        onClick={() =>
                          moderate(
                            `/rooms/${room.room.id}/messages/${m.id}`,
                            "DELETE",
                          )
                        }
                      >
                        <Trash2 size={15} /> 메시지 삭제
                      </button>
                      {!isOwnerMsg && !isAi && (
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                `${m.nickname} 님을 이 방에서 내보낼까요?`,
                              )
                            )
                              moderate(
                                `/rooms/${room.room.id}/kick/${m.participantId}`,
                                "POST",
                              );
                          }}
                        >
                          <UserRoundX size={15} /> 참여자 내보내기
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {aiStatus?.thinking && (
          <div className="message theirs ai-msg ai-thinking-row">
            <span className="avatar avatar-ai">
              <Bot size={16} />
            </span>
            <div className="message-content">
              <div className="message-meta">
                <b>수다온 AI</b>
                <i className="role-badge ai">응답 생성 중</i>
              </div>
              <p className="ai-thinking-bubble">
                <span>
                  {aiStatus.requestedBy
                    ? `${aiStatus.requestedBy} 님의 질문에 답변을 작성하고 있습니다…`
                    : "답변을 작성하고 있습니다…"}
                </span>
                <i className="typing-dots">
                  <b />
                  <b />
                  <b />
                </i>
              </p>
            </div>
          </div>
        )}
      </div>

      {scroll.unread > 0 && (
        <button className="new-messages" onClick={scroll.latest}>
          새 메시지 {scroll.unread}개 <ChevronDown size={15} />
        </button>
      )}
    </div>
  );
}

/* =========================================================
 * 공용 액티비티 실시간 알림 배너 (설문 진행 중 / 공용 게임 열림)
 * ========================================================= */
function LiveActivityBanner({ roomData, activeAppId, onOpenApp }) {
  const sharedApp = roomData?.sharedApp;
  const openPolls = (roomData?.polls || []).filter((p) => p.status === "open");
  const sharedMod = sharedApp
    ? APP_MODULES.find((m) => m.id === sharedApp.appId)
    : null;

  if (!sharedMod && !openPolls.length) return null;

  return (
    <div className="live-activity-strip">
      {sharedMod && activeAppId !== sharedMod.id && (
        <button
          type="button"
          className="activity-pill game-pill"
          onClick={() => onOpenApp(sharedMod.id)}
        >
          <span>{sharedMod.emoji}</span>
          <span>
            지금 <b>{sharedMod.name}</b> 함께 진행 중!
          </span>
          <strong>참여하기 →</strong>
        </button>
      )}
      {openPolls.length > 0 && activeAppId !== "survey" && (
        <button
          type="button"
          className="activity-pill poll-pill"
          onClick={() => onOpenApp("survey")}
        >
          <span>📊</span>
          <span>
            실시간 설문 <b>{openPolls[0].title}</b> 진행 중
          </span>
          <strong>투표하기 →</strong>
        </button>
      )}
    </div>
  );
}

/* =========================================================
 * 통합 채팅 입력창 + 하단 확장 툴바 (이모티콘 · @AI · 게임 · 설문 · 배경/투명도)
 * ========================================================= */
function ChatComposer({
  roomId,
  roomData,
  connection,
  audience = false,
  activeAppId,
  onToggleApp,
  onOpenTheme,
  onError,
  externalDraftRef,
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const pending = useRef(null);
  const composing = useRef(false);
  const textareaRef = useRef(null);

  const openPollsCount = (roomData?.polls || []).filter(
    (p) => p.status === "open",
  ).length;
  const hasSharedGame = Boolean(roomData?.sharedApp?.appId);

  const sendText = async (customText = null) => {
    const raw = customText !== null ? customText : draft;
    const trimmed = raw.trim();
    if (busy || !trimmed || (customText === null && composing.current)) return;
    setBusy(true);
    onError?.("");
    if (!pending.current || pending.current.text !== trimmed) {
      pending.current = { text: trimmed, requestId: crypto.randomUUID() };
    }
    try {
      await api(
        `/rooms/${roomId}/messages${audience ? "?audience=1" : ""}`,
        {
          method: "POST",
          body: pending.current,
        },
      );
      if (customText === null) setDraft("");
      pending.current = null;
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (externalDraftRef) {
      externalDraftRef.current = {
        sendMessage: (msg) => sendText(msg),
        insertText: (txt) => {
          setDraft((prev) => `${prev}${txt}`);
          textareaRef.current?.focus();
        },
      };
    }
  });

  const insertEmoji = (ch) => {
    const el = textareaRef.current;
    if (!el) {
      setDraft((prev) => (prev + ch).slice(0, 500));
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = (draft.slice(0, start) + ch + draft.slice(end)).slice(0, 500);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = Math.min(next.length, start + ch.length);
      el.setSelectionRange(pos, pos);
    });
  };

  const insertAiPrefix = () => {
    if (!draft.trim().startsWith("@AI")) {
      setDraft((prev) => `@AI ${prev}`.slice(0, 500));
    }
    textareaRef.current?.focus();
  };

  return (
    <div className="composer-container">
      {emojiOpen && (
        <EmojiPicker
          onSelect={(ch) => insertEmoji(ch)}
          onClose={() => setEmojiOpen(false)}
        />
      )}

      <div className="composer-toolbar" role="toolbar" aria-label="채팅 부가 도구">
        <button
          type="button"
          className={`tool-chip ${emojiOpen ? "active" : ""}`}
          onClick={() => setEmojiOpen((v) => !v)}
          aria-expanded={emojiOpen}
          title="이모티콘 선택"
        >
          <Smile size={16} />
          <span>이모티콘</span>
        </button>

        <button
          type="button"
          className={`tool-chip ${activeAppId === "ai" ? "active" : ""}`}
          onClick={() => {
            insertAiPrefix();
            onToggleApp("ai");
          }}
          title="@AI 질문 및 AI 도구 열기"
        >
          <Bot size={16} />
          <span>@AI</span>
        </button>

        <button
          type="button"
          className={`tool-chip ${
            ["tetris", "stress", "dart", "lots", "ladder"].includes(activeAppId)
              ? "active"
              : ""
          }`}
          onClick={() =>
            onToggleApp(roomData?.sharedApp?.appId || "tetris")
          }
          title="미니 게임 패널 열기"
        >
          <Gamepad2 size={16} />
          <span>게임</span>
          {hasSharedGame && <i className="chip-dot" />}
        </button>

        <button
          type="button"
          className={`tool-chip ${activeAppId === "survey" ? "active" : ""}`}
          onClick={() => onToggleApp("survey")}
          title="실시간 설문 패널 열기"
        >
          <ClipboardList size={16} />
          <span>설문</span>
          {openPollsCount > 0 && (
            <b className="chip-count">{openPollsCount}</b>
          )}
        </button>

        <button
          type="button"
          className="tool-chip"
          onClick={onOpenTheme}
          title="배경 및 채팅창 투명도 설정"
        >
          <Palette size={16} />
          <span>배경·투명도</span>
        </button>
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          sendText();
        }}
      >
        <label className="sr-only" htmlFor={`msg-input-${roomId}`}>
          메시지 입력
        </label>
        <textarea
          ref={textareaRef}
          id={`msg-input-${roomId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              sendText();
            }
          }}
          rows={1}
          maxLength={500}
          placeholder="메시지 입력 (@AI 질문 시 AI가 함께 답변해요)"
        />
        <button
          type="submit"
          aria-label="메시지 보내기"
          disabled={busy || !draft.trim() || connection !== "online"}
        >
          <Send size={20} />
        </button>
        <span className="composer-note">
          서로를 존중하는 대화로 함께해 주세요 · 내 메시지는 전송 후에도 수정할 수 있어요.
        </span>
      </form>
    </div>
  );
}

/* =========================================================
 * 실시간 키워드 & 생동감 있는 플로팅 워드클라우드 패널
 * ========================================================= */
function KeywordPanel({ meta, compact = false, roomId, onError }) {
  const [mode, setMode] = useState("cloud"),
    [scope, setScope] = useState("recent"),
    [editing, setEditing] = useState(false),
    [excluded, setExcluded] = useState("");
  const words = (scope === "all" ? meta.all : meta.recent) || [];
  const save = async (e) => {
    e.preventDefault();
    try {
      await api(`/rooms/${roomId}/exclusions`, {
        method: "PUT",
        body: { words: excluded },
      });
      setEditing(false);
    } catch (error) {
      onError?.(error.message);
    }
  };
  return (
    <section className={`keyword-panel ${compact ? "compact" : ""}`}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">AUDIENCE INSIGHTS</span>
          <h2>
            <Sparkles size={18} /> 지금, 많이 나온 이야기
          </h2>
        </div>
        {roomId && (
          <button
            className="icon-button"
            aria-label="키워드 제외 단어 설정"
            onClick={() => {
              setExcluded((meta.exclusions || []).join(", "));
              setEditing(true);
            }}
          >
            <Settings2 size={18} />
          </button>
        )}
      </div>
      <div className="keyword-tools">
        <div className="segmented">
          <button
            className={mode === "cloud" ? "selected" : ""}
            aria-pressed={mode === "cloud"}
            onClick={() => setMode("cloud")}
          >
            워드클라우드
          </button>
          <button
            className={mode === "rank" ? "selected" : ""}
            aria-pressed={mode === "rank"}
            onClick={() => setMode("rank")}
          >
            인기 순위
          </button>
        </div>
        <label className="scope-select">
          <span className="sr-only">집계 범위</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="recent">최근 5분</option>
            <option value="all">방 전체</option>
          </select>
        </label>
      </div>
      {!words.length ? (
        <div className="keyword-empty">
          <Sparkles size={25} />
          <p>
            대화가 모이면
            <br />
            청중의 관심사가 살아 움직입니다.
          </p>
        </div>
      ) : mode === "rank" ? (
        <div className="keyword-ranking">
          {words.slice(0, 10).map((w, i) => (
            <div className="keyword-row" key={w.word}>
              <span className="rank">{String(i + 1).padStart(2, "0")}</span>
              <div className="keyword-bar">
                <i style={{ width: `${(w.count / words[0].count) * 100}%` }} />
                <b>{w.word}</b>
              </div>
              <strong>
                {w.count}
                <small>회</small>
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <WordCloudView words={words} compact={compact} />
      )}
      <p className="keyword-footnote">
        <Clock3 size={13} /> 3초마다 갱신 · 같은 메시지의 반복 단어는 1회
      </p>
      {editing && (
        <Modal title="집계에서 제외할 단어" onClose={() => setEditing(false)}>
          <form onSubmit={save}>
            <p className="muted">
              쉼표나 공백으로 구분해 입력하세요. 조사 제거 규칙을 사용하는 초기
              집계입니다.
            </p>
            <label>
              제외 단어
              <textarea
                value={excluded}
                onChange={(e) => setExcluded(e.target.value)}
                maxLength={1000}
                rows={4}
              />
            </label>
            <Button type="submit">적용하기</Button>
          </form>
        </Modal>
      )}
    </section>
  );
}

/* =========================================================
 * 청중 초대 QR 카드 + 80% 화면 확대 QR 모달 트리거
 * ========================================================= */
function JoinCard({ room, health, onError, onDisplay }) {
  const [qr, setQr] = useState(""),
    [copied, setCopied] = useState(false),
    [zoomQr, setZoomQr] = useState(false);
  const base = health?.publicUrl || location.origin;
  const url = `${base.replace(/\/$/, "")}/r/${room.id}`;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
  useEffect(() => {
    if (room?.id) prefetchDisplayToken(room.id);
  }, [room?.id]);
  useEffect(() => {
    let current = true;
    QRCode.toDataURL(url, {
      width: 280,
      margin: 2,
      color: { dark: "#153e35", light: "#ffffff" },
    })
      .then((image) => {
        if (current) setQr(image);
      })
      .catch(() => onError("QR 생성에 실패했습니다."));
    return () => {
      current = false;
    };
  }, [url]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError("링크를 복사하지 못했습니다. 아래 주소를 선택해 복사해 주세요.");
    }
  };
  return (
    <section className="join-card">
      <div className="section-heading">
        <h2>
          <QrCode size={18} /> 청중 초대하기
        </h2>
        <span className="tag">계정 없이 참여</span>
      </div>
      <div
        className="qr-paper clickable"
        role="button"
        tabIndex={0}
        aria-label="QR 코드 크게 보기"
        onClick={() => setZoomQr(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setZoomQr(true);
          }
        }}
      >
        {qr && (
          <img
            src={qr}
            alt={`${room.title} 입장 QR 코드`}
            width="180"
            height="180"
          />
        )}
        <b>카메라로 QR을 스캔해 주세요</b>
        <span>클릭하면 화면 80% 크기로 확대됩니다</span>
      </div>

      <Button
        variant=" full"
        className="qr-zoom-trigger-btn"
        onClick={() => setZoomQr(true)}
      >
        <Maximize2 size={16} /> QR 크게 보기 (80% 확대)
      </Button>

      {local && (
        <div className="local-warning">
          현재 QR은 이 PC 전용 주소입니다.
          <br />
          청중 초대 전에 공개 주소를 연결해 주세요.
        </div>
      )}
      <div className="join-link">
        <input
          readOnly
          value={url}
          aria-label="청중 입장 링크"
          onFocus={(e) => e.target.select()}
        />
        <button
          className="icon-button"
          onClick={copy}
          aria-label="입장 링크 복사"
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </div>
      <Button
        variant="secondary full"
        onClick={() => window.open(url, "_blank", "noopener")}
      >
        <ExternalLink size={16} /> 청중 화면 열기
      </Button>
      <div className="display-callout">
        <span className="display-mini">
          <Monitor size={24} />
          <i>
            <MessageCircle size={13} />
          </i>
        </span>
        <b>발표 자료 위에 대화를 띄워보세요</b>
        <p>수다온 Windows 앱 실행 · 발표창 1·2 투명 항상 위 고정</p>
        <div className="display-callout-btns">
          <Button
            variant="dark full"
            onClick={async () => {
              const res = await launchWindowsDisplayApp(room.id);
              if (res.mode !== "native") {
                onDisplay?.(true);
              }
            }}
          >
            <PanelsTopLeft size={17} /> 발표 화면 띄우기{" "}
            <ArrowUpRight size={16} />
          </Button>
          <button
            type="button"
            className="icon-button display-gear-btn"
            aria-label="발표 화면 세부 설정"
            title="발표 화면 레이아웃·고정·투명도 설정"
            onClick={() => onDisplay?.(false)}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </div>

      {zoomQr && (
        <QrZoomModal
          room={room}
          url={url}
          onClose={() => setZoomQr(false)}
          onError={onError}
        />
      )}
    </section>
  );
}

function DisplaySettings({
  roomId,
  desktopDownloadUrl,
  autoLaunched = false,
  onClose,
}) {
  return (
    <Modal title="발표 화면 및 항상 위 고정 설정" onClose={onClose}>
      <DisplaySettingsContent
        roomId={roomId}
        desktopDownloadUrl={desktopDownloadUrl}
        autoLaunched={autoLaunched}
        onClose={onClose}
      />
    </Modal>
  );
}

/* =========================================================
 * 발표자 대시보드 (관리자 실시간 채팅 · 좌측 부가 앱 패널 · 테마 분리 · 설문/이메일)
 * ========================================================= */
function Dashboard({ health, owner, setOwner }) {
  const [section, setSection] = useState("dashboard"),
    [rooms, setRooms] = useState([]),
    [activeId, setActiveId] = useState(""),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [title, setTitle] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [display, setDisplay] = useState(false),
    [displayAutoLaunched, setDisplayAutoLaunched] = useState(false),
    [localEnrollment, setLocalEnrollment] = useState(false),
    [loaded, setLoaded] = useState(false),
    [activeAppId, setActiveAppId] = useState(null),
    [themeModal, setThemeModal] = useState(false),
    [userTheme, setUserTheme] = useState(() => loadUserTheme());

  const composerBridgeRef = useRef(null);
  const room = useRoom(activeId, owner);
  const load = async () => {
    try {
      const result = await api("/rooms");
      setRooms(result);
      setActiveId((current) =>
        result.some((r) => r.id === current)
          ? current
          : result.find((r) => r.status === "open")?.id || result[0]?.id || "",
      );
      setLoaded(true);
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    if (owner) load();
    else if (health?.configured)
      api("/session")
        .then((s) => setLocalEnrollment(s.localEnrollment))
        .catch(() => {});
  }, [owner, health?.configured]);
  useEffect(() => {
    if (owner && section === "history") load();
  }, [owner, section]);
  useEffect(() => {
    if (room.data?.room.status === "closed") load();
  }, [room.data?.room.status]);

  const login = async (e, local = false) => {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(local ? "/owner/local" : "/owner/login", {
        method: "POST",
        ...(local ? {} : { body: { password } }),
      });
      setPassword("");
      setOwner(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api("/rooms", { method: "POST", body: { title } });
      await load();
      setActiveId(result.room.id);
      setCreating(false);
      setTitle("");
      setSection("dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const closeRoom = async () => {
    if (
      !confirm(
        "발표를 종료할까요? 종료 후에는 청중이 메시지를 보낼 수 없습니다. 기록은 보관됩니다.",
      )
    )
      return;
    try {
      await api(`/rooms/${activeId}/close`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleApp = (appId) => {
    setActiveAppId((prev) => (prev === appId ? null : appId));
  };

  const active = room.data?.room;
  const total = rooms.reduce(
    (sum, r) =>
      sum +
      (r.id === activeId && room.data
        ? room.data.totalMessages
        : r.messageCount),
    0,
  );

  const themeComputed = computeThemeStyles(userTheme, room.data?.roomTheme);

  return (
    <div className="app-shell">
      {owner && (
        <nav className="mobile-navigation" aria-label="모바일 발표자 메뉴">
          {[
            [LayoutDashboard, "dashboard", "대시보드"],
            [History, "history", "발표 기록"],
            [BookOpen, "guide", "사용 가이드"],
          ].map(([Icon, key, label]) => (
            <button
              key={key}
              className={section === key ? "active" : ""}
              onClick={() => {
                setSection(key);
                if (key === "history") load();
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      )}
      <aside className="sidebar">
        <Logo light />
        <div className="workspace-label">PRESENTER WORKSPACE</div>
        <nav>
          {[
            [LayoutDashboard, "dashboard", "대시보드"],
            [History, "history", "발표 기록"],
            [BookOpen, "guide", "사용 가이드"],
          ].map(([Icon, key, label]) => (
            <button
              key={key}
              className={section === key ? "active" : ""}
              onClick={() => setSection(key)}
            >
              <Icon size={19} />
              {label}
              {key === "dashboard" && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-icon">
            <Radio size={22} />
          </span>
          <h3>
            작은 목소리도
            <br />
            놓치지 않도록.
          </h3>
          <p>
            청중과 발표를 연결하는
            <br />
            가장 가벼운 대화 공간.
          </p>
          <div className="sidebar-dots">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="owner-avatar">P</div>
          <div>
            <b>발표자 공간</b>
            <span>{owner ? "개인 워크스페이스" : "로그인이 필요해요"}</span>
          </div>
          {owner && (
            <button
              className="icon-button"
              aria-label="로그아웃"
              onClick={async () => {
                await api("/owner/logout", { method: "POST" });
                setOwner(false);
              }}
            >
              <LogOut size={17} />
            </button>
          )}
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="mobile-logo">
            <Logo />
          </div>
          <div className="breadcrumb">
            내 워크스페이스 <span>/</span>{" "}
            <b>
              {section === "history"
                ? "발표 기록"
                : section === "guide"
                  ? "사용 가이드"
                  : "대시보드"}
            </b>
          </div>
          <div className="topbar-right">
            <span className="environment">
              {health?.mode === "cloud" ? (
                <Cloud size={14} />
              ) : (
                <Laptop size={14} />
              )}{" "}
              {health?.mode === "cloud" ? "온라인 모드" : "로컬 모드"}
            </span>
            <span className="topbar-divider" />
            <CircleHelp size={18} />
            <span className="top-avatar">P</span>
          </div>
        </header>
        <div className="workspace-inner">
          <div className="page-heading">
            <div>
              <div className="eyebrow">LET THE CONVERSATION BEGIN</div>
              <h1>
                {section === "history"
                  ? "대화는 끝나도, 기록은 남도록."
                  : section === "guide"
                    ? "처음부터, 가볍게 시작하세요."
                    : "청중의 목소리가 켜지는 순간."}
              </h1>
              <p>
                {section === "history"
                  ? "지난 발표의 대화와 관심사를 다시 만나보세요."
                  : section === "guide"
                    ? "QR로 연결하고, 발표 자료 위에서 실시간으로 소통하세요."
                    : "실시간 대화, AI 참여, 설문·이메일 요약, 미니 게임까지 한곳에서 함께하세요."}
              </p>
            </div>
            <Button
              onClick={() => {
                if (owner) setCreating(true);
                else document.querySelector("#owner-password")?.focus();
              }}
              disabled={!health?.configured}
            >
              <Plus size={18} /> 새 발표 만들기
            </Button>
          </div>
          <Notice>{error || room.error}</Notice>
          {!health?.configured ? (
            <SetupPanel setup={health?.setup} />
          ) : !owner ? (
            <section className="panel login-panel">
              <div className="login-illustration">
                <MessagesSquare size={64} />
                <span>
                  청중과 연결될 준비,
                  <br />
                  되셨나요?
                </span>
              </div>
              <form onSubmit={login}>
                <span className="eyebrow">WELCOME TO SUDAON</span>
                <h2>발표자 공간에 입장하기</h2>
                <p className="muted">
                  청중은 QR로 바로 참여할 수 있어요.
                  <br />방 생성과 기록 관리는 발표자만 할 수 있습니다.
                </p>
                {localEnrollment ? (
                  <Button
                    type="button"
                    className="full"
                    disabled={busy}
                    onClick={() => login(null, true)}
                  >
                    <Laptop size={18} /> 이 컴퓨터에서 시작하기
                  </Button>
                ) : (
                  <>
                    <label htmlFor="owner-password">발표자 암호</label>
                    <input
                      id="owner-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <Button type="submit" className="full" disabled={busy}>
                      {busy ? "확인 중…" : "입장하기"}
                      <ArrowRight size={17} />
                    </Button>
                  </>
                )}
                <div className="login-foot">
                  <ShieldCheck size={14} /> 개인·비상업적 발표를 위한 공간
                </div>
              </form>
            </section>
          ) : section === "guide" ? (
            <Guide desktopDownloadUrl={health?.features?.desktopDownloadUrl} />
          ) : section === "history" ? (
            <section className="panel history-panel">
              <div className="section-heading">
                <h2>발표별 기록</h2>
                <span className="muted">{rooms.length}개의 발표</span>
              </div>
              {!rooms.length ? (
                <Empty icon={History} title="아직 지난 발표가 없어요">
                  첫 발표를 만들면 대화와 키워드가 여기에 보관됩니다.
                </Empty>
              ) : (
                rooms.map((r) => (
                  <div className="history-row" key={r.id}>
                    <span className="history-icon">
                      <MessagesSquare size={21} />
                    </span>
                    <div>
                      <b>{r.title}</b>
                      <p>
                        {localDate(r.createdAt)} · 메시지 {r.messageCount}개 ·
                        참여 {r.participantCount}세션
                      </p>
                    </div>
                    <span className={`room-tag ${r.status}`}>
                      {r.status === "open" ? "진행 중" : "종료"}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`${r.title} 기록 열기`}
                      onClick={() => {
                        setActiveId(r.id);
                        setSection("dashboard");
                      }}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                    <a
                      className="button secondary"
                      href={`/api/rooms/${r.id}/export`}
                    >
                      <Download size={16} />
                      <span>Excel</span>
                    </a>
                  </div>
                ))
              )}
            </section>
          ) : (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-icon mint">
                    <Users size={21} />
                  </span>
                  <div>
                    <span>현재 참여 중</span>
                    <strong>
                      {room.meta.onlineTotal ?? room.meta.online}
                      <small>명</small>
                    </strong>
                    <p>
                      온라인 {room.meta.activeOnlineCount ?? room.meta.online}명 · 자리비움{" "}
                      {room.meta.awayCount ?? 0}명 (최대 200명)
                    </p>
                  </div>
                  <span className="stat-live">
                    <i /> LIVE
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-icon blue">
                    <MessagesSquare size={21} />
                  </span>
                  <div>
                    <span>이번 발표의 대화</span>
                    <strong>
                      {room.data?.totalMessages || 0}
                      <small>개</small>
                    </strong>
                    <p>지금까지 나눈 메시지</p>
                  </div>
                </div>
                <div className="stat-card">
                  <span className="stat-icon sand">
                    <Sparkles size={21} />
                  </span>
                  <div>
                    <span>청중의 관심 키워드</span>
                    <strong className="stat-word">
                      {room.meta.recent?.[0]?.word || "기다리는 중"}
                    </strong>
                    <p>
                      {room.meta.recent?.[0]
                        ? `최근 5분 · ${room.meta.recent[0].count}개 메시지에서 언급`
                        : "대화가 모이면 나타나요"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="dashboard-grid">
                <div className="main-column">
                  <div
                    className={`chat-workspace-split ${
                      activeAppId ? "has-side-app" : ""
                    }`}
                  >
                    {active && activeAppId && (
                      <SideAppHost
                        activeAppId={activeAppId}
                        onSelectApp={setActiveAppId}
                        onClose={() => setActiveAppId(null)}
                        roomId={activeId}
                        roomData={room.data}
                        meta={room.meta}
                        aiStatus={room.aiStatus}
                        aiFeatureInfo={health?.features?.ai}
                        isOwner
                        audience={false}
                        onShareChat={(msg) =>
                          composerBridgeRef.current?.sendMessage(msg)
                        }
                        onError={setError}
                      />
                    )}

                    <section
                      className={`panel chat-panel themed-chat-surface ${
                        themeComputed.isCustom ? "has-custom-bg" : ""
                      } ${themeComputed.isDarkSurface ? "dark-surface" : ""}`}
                      style={themeComputed.containerStyle}
                    >
                      {themeComputed.isCustom && (
                        <>
                          <div className="chat-bg-layer" aria-hidden="true" />
                          {themeComputed.overlayStyle && (
                            <div
                              className="chat-bg-overlay"
                              style={themeComputed.overlayStyle}
                              aria-hidden="true"
                            />
                          )}
                        </>
                      )}

                      <div className="themed-chat-inner">
                        <div className="section-heading">
                          <div>
                            <span className="eyebrow">LIVE CONVERSATION</span>
                            <h2 className="chat-title-with-count">
                              <span>{active?.title || "실시간 채팅"}</span>
                              {active && (
                                <span
                                  className="chat-header-count"
                                  title="채팅방 참여 인원"
                                >
                                  <Users size={13} />{" "}
                                  {room.meta.onlineTotal ?? room.meta.online ?? 0}
                                </span>
                              )}
                            </h2>
                          </div>
                          <div className="heading-actions">
                            {active && (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="배경 및 투명도 설정"
                                title="배경 및 채팅창 투명도 설정"
                                onClick={() => setThemeModal(true)}
                              >
                                <Palette size={17} />
                              </button>
                            )}
                            {active && <Status connection={room.connection} />}
                          </div>
                        </div>
                        {rooms.length > 0 && (
                          <div className="room-toolbar">
                            <label>
                              <span className="sr-only">표시할 발표</span>
                              <select
                                value={activeId}
                                onChange={(e) => setActiveId(e.target.value)}
                              >
                                {rooms.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.title}
                                    {r.status === "closed" ? " (종료)" : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <span
                              className={`room-tag ${active?.status || "closed"}`}
                            >
                              {active?.status === "open"
                                ? "진행 중"
                                : "기록 보기"}
                            </span>
                          </div>
                        )}
                        {active ? (
                          <>
                            <ParticipantBar
                              meta={room.meta}
                              me={room.data?.me}
                            />
                            <LiveActivityBanner
                              roomData={room.data}
                              activeAppId={activeAppId}
                              onOpenApp={setActiveAppId}
                            />
                            <MessageFeed
                              room={room.data}
                              meta={room.meta}
                              aiStatus={room.aiStatus}
                              manage
                              onError={setError}
                              earlier={room.earlier}
                              onRead={room.reportRead}
                            />
                            {active.status === "open" && (
                              <ChatComposer
                                roomId={activeId}
                                roomData={room.data}
                                connection={room.connection}
                                audience={false}
                                activeAppId={activeAppId}
                                onToggleApp={toggleApp}
                                onOpenTheme={() => setThemeModal(true)}
                                onError={setError}
                                externalDraftRef={composerBridgeRef}
                              />
                            )}
                            <div className="chat-panel-footer">
                              <span>
                                <ShieldCheck size={14} /> 관리자와 청중이 모두 나간
                                경우에만 방이 자동 종료됩니다.
                              </span>
                              <div className="footer-right-btns">
                                {active.status === "open" && (
                                  <button
                                    type="button"
                                    onClick={() => setActiveAppId("survey")}
                                  >
                                    <ClipboardList size={13} /> 설문·이메일
                                  </button>
                                )}
                                {active.status === "open" ? (
                                  <button onClick={closeRoom}>
                                    <Square size={12} /> 발표 종료
                                  </button>
                                ) : (
                                  <a href={`/api/rooms/${activeId}/export`}>
                                    <Download size={14} /> Excel 다운로드
                                  </a>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <Empty
                            title={
                              loaded
                                ? "아직 진행 중인 발표가 없어요"
                                : "발표를 불러오고 있어요"
                            }
                            action={
                              loaded && (
                                <Button
                                  variant="secondary"
                                  onClick={() => setCreating(true)}
                                >
                                  <Plus size={16} /> 첫 발표 만들기
                                </Button>
                              )
                            }
                          >
                            새 발표를 만들고 QR로 청중을 초대해 보세요.
                            <br />
                            별명 하나면 누구나 대화에 참여할 수 있어요.
                          </Empty>
                        )}
                      </div>
                    </section>
                  </div>

                  <section className="panel">
                    <KeywordPanel
                      meta={room.meta}
                      roomId={activeId}
                      onError={setError}
                    />
                  </section>
                </div>
                <aside className="side-column">
                  {active ? (
                    <JoinCard
                      room={active}
                      health={health}
                      onError={setError}
                      onDisplay={(auto = false) => {
                        setDisplayAutoLaunched(Boolean(auto));
                        setDisplay(true);
                      }}
                    />
                  ) : (
                    <section className="join-card">
                      <div className="section-heading">
                        <h2>
                          <QrCode size={18} /> 청중 초대하기
                        </h2>
                      </div>
                      <div className="qr-placeholder">
                        <QrCode size={90} strokeWidth={1} />
                      </div>
                      <h3>새 발표, 새로운 대화.</h3>
                      <p className="muted">
                        발표를 만들면 청중이 참여할
                        <br />
                        전용 QR이 여기에 나타납니다.
                      </p>
                      <div className="onboarding-steps">
                        <span>
                          <b>01</b> 발표 만들기
                        </span>
                        <span>
                          <b>02</b> QR로 청중 초대
                        </span>
                        <span>
                          <b>03</b> 실시간으로 소통하기
                        </span>
                      </div>
                    </section>
                  )}
                </aside>
              </div>
              <div className="workspace-footer">
                <span>수다온 · 청중과 가까워지는 시간</span>
                <span>
                  발표 {rooms.length}개 <i>·</i> 누적 대화 {total}개
                </span>
              </div>
            </>
          )}
        </div>
      </main>
      {creating && (
        <Modal title="새 발표 만들기" onClose={() => setCreating(false)}>
          <form onSubmit={create}>
            <p className="muted">발표마다 새로운 채팅방과 QR이 만들어집니다.</p>
            <label htmlFor="room-title">발표 제목</label>
            <input
              id="room-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 함께 만드는 새로운 아이디어"
              minLength={2}
              maxLength={80}
              required
              autoFocus
            />
            <p className="form-hint">
              청중에게 표시되는 이름이에요. 나중에 기록을 찾을 때도 사용합니다.
            </p>
            <Button type="submit" disabled={busy} className="full">
              {busy ? "만드는 중…" : "발표 만들고 QR 받기"}
              <ArrowRight size={17} />
            </Button>
          </form>
        </Modal>
      )}
      {display && active && (
        <DisplaySettings
          roomId={activeId}
          desktopDownloadUrl={health?.features?.desktopDownloadUrl}
          autoLaunched={displayAutoLaunched}
          onClose={() => {
            setDisplay(false);
            setDisplayAutoLaunched(false);
          }}
        />
      )}
      {themeModal && (
        <Modal
          title="배경 및 채팅창 투명도 설정"
          onClose={() => setThemeModal(false)}
          wide
        >
          <ThemeSettingsModal
            theme={userTheme}
            onChange={setUserTheme}
            onClose={() => setThemeModal(false)}
            isOwner
            roomId={activeId}
            onError={setError}
          />
        </Modal>
      )}
    </div>
  );
}

function Guide({
  desktopDownloadUrl = "https://github.com/dalbitfox/sudaon/releases/latest",
}) {
  return (
    <div className="guide-grid">
      {[
        [
          QrCode,
          "01",
          "발표를 만들고 80% 확대 QR을 보여주세요",
          "청중은 별명만 입력하면 즉시 입장합니다. 접속 기기(PC·모바일·태블릿)와 입장·퇴장 상태가 실시간으로 표시됩니다.",
        ],
        [
          Monitor,
          "02",
          "발표 화면 띄우기 → Windows 앱 즉시 실행",
          "[발표 화면 띄우기] 버튼을 누르면 수다온 Windows 앱(sudaon://)이 바로 실행되어 PPT·슬라이드 위에 투명한 발표창 1(채팅)·발표창 2(키워드)를 독립 최상위(Always on Top)로 고정합니다.",
        ],
        [
          Bot,
          "03",
          "@AI 참여 · 미니 게임 · 실시간 설문",
          "대화 중 @AI로 질문하거나, PC 좌측 패널·모바일 바텀시트에서 테트리스·다트·제비뽑기·사다리타기·실시간 설문을 채팅과 동시에 즐기세요.",
        ],
        [
          Download,
          "04",
          "Excel 다운로드 및 이메일 요약 전송",
          "발표 기록과 설문 결과를 Excel로 내려받거나 미리보기 확인 후 원하는 이메일로 안전하게 전송할 수 있습니다.",
        ],
      ].map(([Icon, num, title, body]) => (
        <section className="panel guide-card" key={num}>
          <span>{num}</span>
          <Icon size={28} />
          <h2>{title}</h2>
          <p>{body}</p>
        </section>
      ))}
      <section className="panel guide-card guide-wide">
        <h2>수다온 Windows 앱 연결 및 청중 초대 안내</h2>
        <p>
          발표자 PC에서 수다온 Windows 앱(.exe)을 최초 1회 실행해 두면, 이후 웹
          대시보드에서 <b>발표 화면 띄우기</b> 버튼 클릭 한 번으로 재로그인 없이
          투명 최상위 오버레이 창이 즉시 실행됩니다. 청중 모바일 참여 시에는 공개
          HTTPS 주소의 QR을 사용해 주세요.
        </p>
        <div className="guide-links">
          <a href={desktopDownloadUrl} target="_blank" rel="noreferrer">
            Windows 앱 다운로드 (.exe) <Download size={15} />
          </a>
          <a
            href="https://github.com/dalbitfox/sudaon"
            target="_blank"
            rel="noreferrer"
          >
            프로젝트와 설정 안내 <ArrowUpRight size={16} />
          </a>
        </div>
      </section>
    </div>
  );
}

/* =========================================================
 * 청중 참여 화면 (/r/:roomId) — PC 좌측 분할 / 모바일 바텀시트 + 배경·투명도 분리
 * ========================================================= */
function Guest({ roomId, health }) {
  const [info, setInfo] = useState(null),
    [nickname, setNickname] = useState(""),
    [joined, setJoined] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [activeAppId, setActiveAppId] = useState(null),
    [themeModal, setThemeModal] = useState(false),
    [userTheme, setUserTheme] = useState(() => loadUserTheme());

  const composerBridgeRef = useRef(null);
  const room = useRoom(roomId, joined, true);

  useEffect(() => {
    let current = true;
    Promise.all([
      api(`/rooms/${roomId}/info`),
      api(`/rooms/${roomId}?audience=1`).catch(() => null),
    ])
      .then(([i, session]) => {
        if (current) {
          setInfo(i);
          if (session?.me) setJoined(true);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [roomId]);

  const join = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/rooms/${roomId}/join`, {
        method: "POST",
        body: { nickname, device: clientDeviceType() },
      });
      setJoined(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleApp = (appId) => {
    setActiveAppId((prev) => (prev === appId ? null : appId));
  };

  const closed = (room.data?.room.status || info?.status) === "closed";
  const denied = room.connection === "denied";
  const themeComputed = computeThemeStyles(
    userTheme,
    room.data?.roomTheme || info?.roomTheme,
  );

  return (
    <div
      className={[
        "guest-shell",
        joined ? "in-room" : "",
        joined && activeAppId ? "with-side-app" : "",
        joined && themeComputed.isCustom ? "has-custom-bg" : "",
        joined && themeComputed.isDarkSurface ? "dark-surface" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={joined ? themeComputed.containerStyle : undefined}
    >
      {joined && themeComputed.isCustom && (
        <>
          <div className="chat-bg-layer" aria-hidden="true" />
          {themeComputed.overlayStyle && (
            <div
              className="chat-bg-overlay"
              style={themeComputed.overlayStyle}
              aria-hidden="true"
            />
          )}
        </>
      )}

      <header className="guest-header">
        <Logo />
        <div className="guest-header-right">
          {joined && (
            <button
              type="button"
              className="icon-button"
              aria-label="배경 및 투명도 설정"
              title="배경 및 투명도 설정"
              onClick={() => setThemeModal(true)}
            >
              <Palette size={18} />
            </button>
          )}
          <span className="tag">
            <Radio size={13} /> LIVE CHAT
          </span>
        </div>
      </header>

      {!joined ? (
        <main className="guest-join">
          <div className="guest-art">
            <MessagesSquare size={56} />
            <span className="guest-art-spark">
              <Sparkles size={20} />
            </span>
          </div>
          <span className="eyebrow">YOUR VOICE MATTERS</span>
          <h1>{info?.title || "함께 나누는 이야기"}</h1>
          <p>
            궁금한 점도, 떠오른 생각도.
            <br />
            별명 하나로 자유롭게 대화해 보세요.
          </p>
          <Notice>{error}</Notice>
          {loading ? (
            <p>채팅방을 확인하고 있어요…</p>
          ) : closed ? (
            <Notice>
              종료된 채팅방입니다. 모든 참여자가 퇴장했거나 발표가 마감되어 더
              이상 입장할 수 없습니다.
            </Notice>
          ) : (
            info && (
              <form onSubmit={join}>
                <label htmlFor="nickname">채팅방에서 사용할 별명</label>
                <input
                  id="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="어떤 이름으로 함께할까요?"
                  autoComplete="nickname"
                  minLength={2}
                  maxLength={20}
                  required
                />
                <Button type="submit" className="full" disabled={busy}>
                  {busy ? "입장 중…" : "입장하기"}
                  <ArrowRight size={18} />
                </Button>
                <div className="join-disclosure">
                  <EyeOff size={16} />
                  <span>
                    회원가입 없이 참여해요.
                    <br />
                    보낸 메시지와 별명은 참여자에게 공개되고 발표 기록으로
                    보관됩니다.
                  </span>
                </div>
              </form>
            )
          )}
          <div className="guest-bottom-note">
            청중과 가까워지는 시간, 수다온
          </div>
        </main>
      ) : (
        <div className="guest-body-split">
          {activeAppId && (
            <SideAppHost
              activeAppId={activeAppId}
              onSelectApp={setActiveAppId}
              onClose={() => setActiveAppId(null)}
              roomId={roomId}
              roomData={room.data}
              meta={room.meta}
              aiStatus={room.aiStatus}
              aiFeatureInfo={health?.features?.ai}
              isOwner={false}
              audience
              onShareChat={(msg) =>
                composerBridgeRef.current?.sendMessage(msg)
              }
              onError={setError}
            />
          )}

          <div className="guest-chat-column themed-chat-surface">
            <div className="guest-room-heading">
              <div>
                <span className="eyebrow">함께 나누는 이야기</span>
                <h1 className="chat-title-with-count">
                  <span>{room.data?.room.title || info?.title}</span>
                  <span className="chat-header-count" title="채팅방 참여 인원">
                    <Users size={13} />{" "}
                    {room.meta.onlineTotal ?? room.meta.online ?? 0}
                  </span>
                </h1>
                <div className="guest-room-meta">
                  <Status connection={room.connection} />
                </div>
              </div>
              <button
                className="icon-button"
                aria-label="채팅방 나가기"
                title="채팅방 나가기"
                onClick={async () => {
                  try {
                    await api(`/rooms/${roomId}/leave`, { method: "POST" });
                    setJoined(false);
                    setActiveAppId(null);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                <LogOut size={19} />
              </button>
            </div>

            <ParticipantBar meta={room.meta} me={room.data?.me} />

            <LiveActivityBanner
              roomData={room.data}
              activeAppId={activeAppId}
              onOpenApp={setActiveAppId}
            />

            <MessageFeed
              room={room.data}
              meta={room.meta}
              aiStatus={room.aiStatus}
              audience
              onError={setError}
              earlier={room.earlier}
              onRead={room.reportRead}
            />
            <Notice>{error || room.error}</Notice>
            {closed || denied ? (
              <div className="ended-banner">
                {closed
                  ? "채팅방이 종료되었습니다. 함께해 주셔서 감사합니다."
                  : room.error || "다시 입장해 주세요."}
              </div>
            ) : (
              <ChatComposer
                roomId={roomId}
                roomData={room.data}
                connection={room.connection}
                audience
                activeAppId={activeAppId}
                onToggleApp={toggleApp}
                onOpenTheme={() => setThemeModal(true)}
                onError={setError}
                externalDraftRef={composerBridgeRef}
              />
            )}
          </div>
        </div>
      )}

      {themeModal && (
        <Modal
          title="배경 및 채팅창 투명도 설정"
          onClose={() => setThemeModal(false)}
          wide
        >
          <ThemeSettingsModal
            theme={userTheme}
            onChange={setUserTheme}
            onClose={() => setThemeModal(false)}
            isOwner={false}
            roomId={roomId}
            onError={setError}
          />
        </Modal>
      )}
    </div>
  );
}

/* =========================================================
 * 발표 오버레이 표시창 (/display/:roomId) — 창 1(채팅) / 창 2(키워드) 독립 Always-on-Top 핀 고정
 * ========================================================= */
function Display({ roomId }) {
  const params = new URLSearchParams(location.search),
    kind = params.get("kind") || "combined";
  const room = useRoom(roomId, true, false, true),
    [error, setError] = useState(""),
    [opacity, setOpacity] = useState(Number(params.get("opacity") || 85)),
    [font, setFont] = useState(Number(params.get("font") || 20)),
    [top, setTop] = useState(params.get("top") !== "false"),
    [pipActive, setPipActive] = useState(false),
    [tools, setTools] = useState(false);

  const native = typeof window !== "undefined" && Boolean(window.sudaon);
  const supportsDocPiP =
    typeof window !== "undefined" && "documentPictureInPicture" in window;

  const windowLabel =
    kind === "chat"
      ? "발표창 1 · 채팅"
      : kind === "keywords"
        ? "발표창 2 · 키워드"
        : "통합 발표창";

  useEffect(() => {
    document.body.classList.add("display-body");
    return () => document.body.classList.remove("display-body");
  }, []);

  useEffect(() => {
    if (!native || !window.sudaon.onStateChange) return;
    const off = window.sudaon.onStateChange((payload) => {
      if (payload?.kind === kind && typeof payload.alwaysOnTop === "boolean") {
        setTop(payload.alwaysOnTop);
      } else if (payload?.[kind] && typeof payload[kind].alwaysOnTop === "boolean") {
        setTop(payload[kind].alwaysOnTop);
      }
    });
    return () => off?.();
  }, [native, kind]);

  const togglePin = async () => {
    if (native) {
      const next = !top;
      setTop(next);
      try {
        await window.sudaon.control({ action: "pin", kind, value: next });
      } catch {
        setError("최상위 고정 상태를 변경하지 못했습니다.");
      }
      return;
    }
    if (supportsDocPiP) {
      try {
        if (window.documentPictureInPicture.window) {
          window.documentPictureInPicture.window.close();
          setPipActive(false);
          setTop(false);
        } else {
          const pipWin = await window.documentPictureInPicture.requestWindow({
            width: 480,
            height: kind === "keywords" ? 420 : 620,
          });
          [...document.styleSheets].forEach((sheet) => {
            try {
              const cssRules = [...sheet.cssRules]
                .map((r) => r.cssText)
                .join("");
              const style = document.createElement("style");
              style.textContent = cssRules;
              pipWin.document.head.appendChild(style);
            } catch {}
          });
          const iframe = pipWin.document.createElement("iframe");
          iframe.src = location.href;
          iframe.style.cssText = "border:0;width:100%;height:100%;";
          pipWin.document.body.style.margin = "0";
          pipWin.document.body.appendChild(iframe);
          pipWin.addEventListener("pagehide", () => setPipActive(false));
          setPipActive(true);
          setTop(true);
        }
      } catch {
        setError(
          "브라우저 항상 위(PiP) 창을 열지 못했습니다. Windows 앱에서는 네이티브 최상위 고정을 지원합니다.",
        );
      }
      return;
    }
    setError(
      "현재 브라우저는 OS 레벨 항상 위 고정을 지원하지 않습니다. 수다온 Windows 앱 또는 Chrome/Edge 최신 버전을 이용해 주세요.",
    );
  };

  const isPinned = native ? top : pipActive;

  return (
    <main
      className="presentation-window"
      style={{
        "--panel-alpha": Math.max(0.2, Math.min(1, opacity / 100)),
        "--chat-font": `${Math.min(36, Math.max(16, font))}px`,
      }}
    >
      <header className="display-title">
        <span className="display-brand">
          <MessageCircle size={16} />
          {windowLabel}
        </span>
        <b>{room.data?.room.title || "발표에 연결 중"}</b>
        <div className="display-header-btns">
          <button
            type="button"
            className={`display-pin-chip ${isPinned ? "pinned" : ""}`}
            onClick={togglePin}
            aria-pressed={isPinned}
            aria-label={`${windowLabel} 항상 위 고정 전환`}
            title={
              isPinned
                ? "항상 위 고정 켜짐 (클릭하여 해제)"
                : "항상 위 고정 꺼짐 (클릭하여 고정)"
            }
          >
            {isPinned ? <Pin size={14} /> : <PinOff size={14} />}
            <span>{isPinned ? "고정됨" : "고정"}</span>
          </button>
          <button
            className="icon-button"
            onClick={() => setTools((v) => !v)}
            aria-label="표시창 조절"
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>
      {tools && (
        <div className="display-tools">
          <label>
            배경
            <input
              aria-label="배경 불투명도"
              type="range"
              min="20"
              max="100"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </label>
          <label>
            글자
            <input
              aria-label="글자 크기"
              type="range"
              min="16"
              max="36"
              value={font}
              onChange={(e) => setFont(Number(e.target.value))}
            />
          </label>
          {native ? (
            <>
              <button
                className={`button secondary ${top ? "active" : ""}`}
                onClick={togglePin}
              >
                <Pin size={13} /> {top ? "고정 해제" : "항상 위 고정"}
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  window.sudaon
                    .control({ action: "lower", kind })
                    .then(() => setTop(false))
                    .catch(() =>
                      setError(
                        "창을 뒤로 보내지 못했습니다. 최상위 고정을 해제하고 발표창을 선택해 주세요.",
                      ),
                    )
                }
              >
                뒤로 보내기
              </button>
              <button
                className="button secondary"
                onClick={() => window.sudaon.control({ action: "hide", kind })}
              >
                숨기기
              </button>
            </>
          ) : supportsDocPiP ? (
            <button className="button secondary" onClick={togglePin}>
              <PictureInPicture2 size={13} />{" "}
              {pipActive ? "PiP 닫기" : "항상 위 PiP로 열기"}
            </button>
          ) : (
            <small>일반 브라우저 창 (OS 고정은 Windows 앱 지원)</small>
          )}
        </div>
      )}
      <Notice>{error || room.error}</Notice>
      {kind !== "keywords" && (
        <div className="display-chat">
          <MessageFeed
            room={room.data}
            meta={room.meta}
            aiStatus={room.aiStatus}
            display
            onError={setError}
          />
        </div>
      )}
      {kind !== "chat" && (
        <KeywordPanel meta={room.meta} compact onError={setError} />
      )}
      <footer className="display-footer">
        <Status connection={room.connection} />
        <span>
          {room.data?.room.status === "closed"
            ? "종료된 발표"
            : `${room.meta.online}명과 함께 대화 중`}
        </span>
      </footer>
    </main>
  );
}

function App() {
  const [path, setPath] = useState(location.pathname),
    [health, setHealth] = useState(null),
    [owner, setOwner] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    api("/health")
      .then((h) => {
        setHealth(h);
        if (h.configured)
          api("/session")
            .then((s) => setOwner(s.owner))
            .catch(() => {});
      })
      .catch((e) => setError(e.message));
    return () => window.removeEventListener("popstate", update);
  }, []);
  const match = path.match(/^\/(r|display)\/([A-Za-z0-9_-]{16})\/?$/);
  if (match?.[1] === "r")
    return <Guest key={match[2]} roomId={match[2]} health={health} />;
  if (match?.[1] === "display")
    return <Display key={match[2]} roomId={match[2]} />;
  if (!health)
    return (
      <div className="loading-screen">
        <Logo />
        <p>{error || "수다온을 준비하고 있어요…"}</p>
      </div>
    );
  return <Dashboard health={health} owner={owner} setOwner={setOwner} />;
}

createRoot(document.querySelector("#root")).render(<App />);
