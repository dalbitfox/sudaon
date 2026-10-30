import React, { useEffect, useState, useRef } from "react";
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
  ChevronDown,
  Trash2,
  UserRoundX,
  Settings2,
  ExternalLink,
  WifiOff,
  CircleHelp,
  MoreHorizontal,
  RotateCcw,
  Link,
  ShieldCheck,
  Square,
  Clock3,
  ChevronLeft,
  Volume2,
  EyeOff,
  Cloud,
  Laptop,
} from "lucide-react";
import QRCode from "qrcode";
import { api, navigate, localTime, localDate } from "./api";
import { useRoom, useAutoScroll } from "./hooks";
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
      <p>현재 온라인 채팅은 아직 열리지 않았습니다. 아래 설정과 재배포를 마치면 발표자 로그인과 새 발표 만들기가 표시됩니다.</p>
      <ol className="setup-steps">
        <li>
          <div className="setup-step-heading"><h3>대화 기록 저장소 연결</h3><span>{setup.storage ? "설정됨" : "설정 필요"}</span></div>
          <p>Storage에서 Upstash for Redis를 만들고 <b>Free</b> 플랜을 선택한 뒤, 이 프로젝트의 Production에 연결해 주세요. 다른 프로젝트의 저장소는 연결하지 않아도 됩니다.</p>
          <a href={`${project}/stores`} target="_blank" rel="noreferrer">Vercel Storage 열기 <ArrowUpRight size={15} /></a>
        </li>
        <li>
          <div className="setup-step-heading"><h3>발표자 로그인 설정</h3><span>{setup.ownerPassword && setup.sessionSecret ? "설정됨" : "설정 필요"}</span></div>
          <p>Environment Variables에서 아래 두 항목을 <b>Production</b>에 추가해 주세요. 실제 값은 이 화면이나 채팅에 보내지 마세요.</p>
          <dl className="setup-variables">
            <div><dt><code>SUDAON_OWNER_PASSWORD</code></dt><dd>발표자 암호 · 12자 이상 {setup.ownerPassword && <Check size={14} aria-label="설정됨" />}</dd></div>
            <div><dt><code>SUDAON_SESSION_SECRET</code></dt><dd>세션 보호용 임의 문자열 · 32자 이상 {setup.sessionSecret && <Check size={14} aria-label="설정됨" />}</dd></div>
          </dl>
          <a href={`${project}/settings/environment-variables`} target="_blank" rel="noreferrer">환경 변수 설정 열기 <ArrowUpRight size={15} /></a>
        </li>
        <li>
          <h3>재배포 후 발표 시작</h3>
          <p>설정을 저장한 뒤 Deployments에서 최신 배포를 <b>Redeploy</b>해 주세요. Ready가 되면 이 화면을 새로 확인하고 발표자 암호로 로그인하세요.</p>
          <a href={`${project}/deployments`} target="_blank" rel="noreferrer">배포 화면 열기 <ArrowUpRight size={15} /></a>
        </li>
      </ol>
      <Button variant="secondary" onClick={() => location.reload()}><RotateCcw size={16} />설정 상태 다시 확인</Button>
      <p className="setup-footnote">표시 상태는 현재 배포의 설정 유무입니다. 실제 저장소 연결은 로그인과 방 생성 시 확인됩니다. 청중은 발표자가 만든 QR로 입장합니다.</p>
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
function Modal({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    ref.current.showModal();
    ref.current.querySelector('input:not([type="range"]):not([type="checkbox"]), textarea')?.focus();
    const dialog = ref.current;
    const close = () => onClose();
    dialog.addEventListener("cancel", close);
    return () => {
      dialog.removeEventListener("cancel", close);
      before?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className="modal">
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
function MessageFeed({
  room,
  manage = false,
  display = false,
  onError,
  earlier,
}) {
  const messages = room?.messages || [];
  const scroll = useAutoScroll([messages.at(-1)?.id, messages.length]);
  const [menu, setMenu] = useState(null),
    [hasEarlier, setHasEarlier] = useState(true);
  useEffect(() => setHasEarlier(true), [room?.room.id]);
  const moderate = async (path, method) => {
    try {
      await api(path, { method });
      setMenu(null);
    } catch (e) {
      onError?.(e.message);
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
        {!messages.length && (
          <Empty title="첫 번째 목소리를 기다려요">
            QR로 입장한 청중의 대화가 이곳에 표시됩니다.
          </Empty>
        )}
        {messages.map((m) => (
          <div
            className={`message ${m.participantId === room.me ? "mine" : ""}`}
            key={m.id}
          >
            <span
              className={`avatar tone-${(m.nickname?.codePointAt(0) || 0) % 5}`}
            >
              {m.nickname?.slice(0, 1)}
            </span>
            <div className="message-content">
              <div className="message-meta">
                <b>{m.nickname}</b>
                <time>{localTime(m.at)}</time>
              </div>
              <p className={m.deleted ? "deleted" : ""}>
                {m.deleted ? "삭제된 메시지입니다." : m.text}
              </p>
            </div>
            {manage && !m.deleted && (
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
                    <button
                      onClick={() => {
                        if (confirm(`${m.nickname} 님을 이 방에서 내보낼까요?`))
                          moderate(
                            `/rooms/${room.room.id}/kick/${m.participantId}`,
                            "POST",
                          );
                      }}
                    >
                      <UserRoundX size={15} /> 참여자 내보내기
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {scroll.unread && (
        <button className="new-messages" onClick={scroll.latest}>
          새 메시지 <ChevronDown size={15} />
        </button>
      )}
    </div>
  );
}
function KeywordPanel({ meta, compact = false, roomId, onError }) {
  const [mode, setMode] = useState("rank"),
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
            className={mode === "rank" ? "selected" : ""}
            aria-pressed={mode === "rank"}
            onClick={() => setMode("rank")}
          >
            인기 순위
          </button>
          <button
            className={mode === "cloud" ? "selected" : ""}
            aria-pressed={mode === "cloud"}
            onClick={() => setMode("cloud")}
          >
            워드클라우드
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
            청중의 관심사가 나타나요.
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
        <div
          className="word-cloud"
          aria-label="언급 메시지 수에 비례한 워드클라우드"
        >
          {words.slice(0, 20).map((w, i) => (
            <span
              key={w.word}
              title={`${w.count}개 메시지 · ${w.sessions}개 세션`}
              style={{
                fontSize: `${Math.min(44, 17 + (25 * w.count) / words[0].count)}px`,
                color: ["#17664d", "#4e7048", "#476b77", "#8c6834"][i % 4],
              }}
            >
              {w.word}
            </span>
          ))}
        </div>
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
function JoinCard({ room, health, onError, onDisplay }) {
  const [qr, setQr] = useState(""),
    [copied, setCopied] = useState(false);
  const base = health?.publicUrl || location.origin;
  const url = `${base.replace(/\/$/, "")}/r/${room.id}`;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
  useEffect(() => {
    let current = true;
    QRCode.toDataURL(url, {
      width: 280,
      margin: 1,
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
      <div className="qr-paper">
        {qr && (
          <img
            src={qr}
            alt={`${room.title} 입장 QR 코드`}
            width="180"
            height="180"
          />
        )}
        <b>카메라로 QR을 스캔해 주세요</b>
        <span>별명만 입력하면 대화가 시작됩니다.</span>
      </div>
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
        <p>채팅과 키워드를 나란히, 또는 따로.</p>
        <Button variant="dark full" onClick={onDisplay}>
          <PanelsTopLeft size={17} /> 발표 화면 띄우기{" "}
          <ArrowUpRight size={16} />
        </Button>
      </div>
    </section>
  );
}
function DisplaySettings({ roomId, onClose }) {
  const saved = () => {
    try {
      return JSON.parse(localStorage.getItem("sudaon-display") || "{}");
    } catch {
      return {};
    }
  };
  const [layout, setLayout] = useState(() => saved().layout || "combined"),
    [opacity, setOpacity] = useState(() => saved().opacity || 85),
    [font, setFont] = useState(() => saved().font || 20),
    [top, setTop] = useState(() => saved().top !== false);
  const native = Boolean(window.sudaon);
  const launch = () => {
    const params = new URLSearchParams({
      opacity: String(opacity),
      font: String(font),
      top: String(top),
    });
    const options = { roomId, layout, opacity, font, top };
    localStorage.setItem(
      "sudaon-display",
      JSON.stringify({ layout, opacity, font, top }),
    );
    if (native) window.sudaon.openDisplay(options);
    else {
      const kinds = layout === "split" ? ["chat", "keywords"] : ["combined"];
      for (const kind of kinds)
        window.open(
          `/display/${roomId}?${params}&kind=${kind}`,
          `sudaon-${roomId}-${kind}`,
          "popup,width=540,height=650",
        );
    }
    onClose();
  };
  return (
    <Modal title="발표 화면 설정" onClose={onClose}>
      <p className="muted">발표 자료를 가리지 않는 위치와 크기로 배치하세요.</p>
      <fieldset className="display-layout">
        <legend>표시 구성</legend>
        <div className="choice-grid">
          <button
            className={layout === "combined" ? "selected" : ""}
            aria-pressed={layout === "combined"}
            onClick={() => setLayout("combined")}
          >
            <PanelsTopLeft size={24} />
            <b>한 창에 함께</b>
            <small>채팅 + 키워드</small>
          </button>
          <button
            className={layout === "split" ? "selected" : ""}
            aria-pressed={layout === "split"}
            onClick={() => setLayout("split")}
          >
            <Monitor size={24} />
            <b>두 창으로 분리</b>
            <small>원하는 위치에 각각</small>
          </button>
        </div>
      </fieldset>
      <label>
        배경 불투명도 <b>{opacity}%</b>
        <input
          type="range"
          min="20"
          max="100"
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
        />
      </label>
      <label>
        글자 크기 <b>{font}px</b>
        <input
          type="range"
          min="16"
          max="36"
          value={font}
          onChange={(e) => setFont(Number(e.target.value))}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={top}
          onChange={(e) => setTop(e.target.checked)}
        />{" "}
        다른 창 위에 고정
      </label>
      {!native && (
        <Notice>
          브라우저에서는 일반 창으로 열립니다. 다른 프로그램 위에 고정하거나
          배경을 투명하게 표시하려면 Windows 앱을 사용해 주세요. 분리 창은 팝업
          허용이 필요할 수 있습니다.
        </Notice>
      )}
      <Button className="full" onClick={launch}>
        <Monitor size={18} /> 표시창 열기
      </Button>
    </Modal>
  );
}

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
    [localEnrollment, setLocalEnrollment] = useState(false),
    [loaded, setLoaded] = useState(false);
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
  const active = room.data?.room;
  const total = rooms.reduce(
    (sum, r) =>
      sum +
      (r.id === activeId && room.data
        ? room.data.totalMessages
        : r.messageCount),
    0,
  );
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
                    : "발표에 대화를 더하세요. 함께 나누는 이야기를 한눈에 확인할 수 있어요."}
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
            <Guide />
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
                      {room.meta.online}
                      <small>명</small>
                    </strong>
                    <p>청중 최대 200명</p>
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
                  <section className="panel chat-panel">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">LIVE CONVERSATION</span>
                        <h2>{active?.title || "실시간 채팅"}</h2>
                      </div>
                      {active && <Status connection={room.connection} />}
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
                          {active?.status === "open" ? "진행 중" : "기록 보기"}
                        </span>
                      </div>
                    )}
                    {active ? (
                      <>
                        <MessageFeed
                          room={room.data}
                          manage
                          onError={setError}
                          earlier={room.earlier}
                        />
                        <div className="chat-panel-footer">
                          <span>
                            <ShieldCheck size={14} /> 청중의 메시지는 바로
                            공개됩니다.
                          </span>
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
                  </section>
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
                      onDisplay={() => setDisplay(true)}
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
        <DisplaySettings roomId={activeId} onClose={() => setDisplay(false)} />
      )}
    </div>
  );
}

function Guide() {
  return (
    <div className="guide-grid">
      {[
        [
          QrCode,
          "01",
          "발표를 만들고 QR을 보여주세요",
          "청중은 별명만 입력하면 입장합니다. 방은 발표마다 새로 만들어집니다.",
        ],
        [
          Monitor,
          "02",
          "발표 자료 옆에 대화를 띄우세요",
          "Windows 앱에서 위치·크기·배경 투명도를 조절하세요. 화면 확장 모드에서는 투사할 모니터로 표시창을 옮겨 주세요.",
        ],
        [
          Sparkles,
          "03",
          "청중의 관심사를 확인하세요",
          "최근 5분 또는 방 전체의 키워드를 순위와 워드클라우드로 확인할 수 있습니다.",
        ],
        [
          Download,
          "04",
          "대화의 여운을 기록으로 남기세요",
          "발표를 종료해도 기록은 남습니다. 발표 기록에서 실제 Excel 파일을 내려받을 수 있습니다.",
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
        <h2>로컬에서 청중을 초대할 때</h2>
        <p>
          이 PC 전용 주소는 휴대폰 데이터에서 열리지 않습니다. 공개 HTTPS 주소를
          연결한 후 표시되는 QR로 참여를 확인해 주세요. 브라우저 일반 창은
          Windows 앱의 최상위 고정·투명 배경 기능을 제공하지 않습니다.
        </p>
        <a
          href="https://github.com/dalbitfox/sudaon"
          target="_blank"
          rel="noreferrer"
        >
          프로젝트와 설정 안내 <ArrowUpRight size={16} />
        </a>
      </section>
    </div>
  );
}

function Guest({ roomId }) {
  const [info, setInfo] = useState(null),
    [nickname, setNickname] = useState(""),
    [joined, setJoined] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState("");
  const pending = useRef(null),
    composing = useRef(false);
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
        body: { nickname },
      });
      setJoined(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const send = async (e) => {
    e?.preventDefault();
    if (busy || !draft.trim() || composing.current) return;
    setBusy(true);
    setError("");
    if (!pending.current || pending.current.text !== draft.trim())
      pending.current = { text: draft.trim(), requestId: crypto.randomUUID() };
    try {
      await api(`/rooms/${roomId}/messages`, {
        method: "POST",
        body: pending.current,
      });
      setDraft("");
      pending.current = null;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const closed = (room.data?.room.status || info?.status) === "closed";
  const denied = room.connection === "denied";
  return (
    <div className={`guest-shell ${joined ? "in-room" : ""}`}>
      <header className="guest-header">
        <Logo />
        <span className="tag">
          <Radio size={13} /> LIVE CHAT
        </span>
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
            <Notice>발표가 종료되었습니다. 다음 발표에서 만나요.</Notice>
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
                    보낸 메시지와 별명은 청중에게 공개되고 발표 기록으로
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
        <>
          <div className="guest-room-heading">
            <div>
              <span className="eyebrow">함께 나누는 이야기</span>
              <h1>{room.data?.room.title || info?.title}</h1>
              <div className="guest-room-meta">
                <Status connection={room.connection} />
                <span>
                  <Users size={14} />
                  {room.meta.online}명 참여 중
                </span>
              </div>
            </div>
            <button
              className="icon-button"
              aria-label="채팅방 나가기"
              onClick={async () => {
                try {
                  await api(`/rooms/${roomId}/leave`, { method: "POST" });
                  setJoined(false);
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <LogOut size={19} />
            </button>
          </div>
          <MessageFeed
            room={room.data}
            onError={setError}
            earlier={room.earlier}
          />
          <Notice>{error || room.error}</Notice>
          {closed || denied ? (
            <div className="ended-banner">
              {closed
                ? "발표가 종료되었습니다. 함께해 주셔서 감사합니다."
                : room.error || "다시 입장해 주세요."}
            </div>
          ) : (
            <form className="composer" onSubmit={send}>
              <label className="sr-only" htmlFor="message">
                메시지 입력
              </label>
              <textarea
                id="message"
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
                    send();
                  }
                }}
                rows={1}
                maxLength={500}
                placeholder="생각을 자유롭게 나눠보세요"
              />
              <button
                type="submit"
                aria-label="메시지 보내기"
                disabled={busy || !draft.trim() || room.connection !== "online"}
              >
                <Send size={20} />
              </button>
              <span className="composer-note">
                서로를 존중하는 대화로 함께해 주세요.
              </span>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function Display({ roomId }) {
  const params = new URLSearchParams(location.search),
    kind = params.get("kind") || "combined";
  const room = useRoom(roomId, true),
    [error, setError] = useState(""),
    [opacity, setOpacity] = useState(Number(params.get("opacity") || 85)),
    [font, setFont] = useState(Number(params.get("font") || 20)),
    [top, setTop] = useState(params.get("top") !== "false"),
    [tools, setTools] = useState(false);
  useEffect(() => {
    document.body.classList.add("display-body");
    return () => document.body.classList.remove("display-body");
  }, []);
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
          수다온
        </span>
        <b>{room.data?.room.title || "발표에 연결 중"}</b>
        <button
          className="icon-button"
          onClick={() => setTools((v) => !v)}
          aria-label="표시창 조절"
        >
          <Settings2 size={17} />
        </button>
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
          {window.sudaon ? (
            <>
              <button
                className={`icon-button ${top ? "active" : ""}`}
                aria-label="최상위 고정 전환"
                onClick={() => {
                  setTop(!top);
                  window.sudaon.control({ action: "pin", value: !top });
                }}
              >
                <Pin size={17} />
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  window.sudaon
                    .control({ action: "lower" })
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
                onClick={() => window.sudaon.control({ action: "hide" })}
              >
                숨기기
              </button>
            </>
          ) : (
            <small>일반 브라우저 창</small>
          )}
        </div>
      )}
      <Notice>{error || room.error}</Notice>
      {kind !== "keywords" && (
        <div className="display-chat">
          <MessageFeed room={room.data} display onError={setError} />
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
  if (match?.[1] === "r") return <Guest key={match[2]} roomId={match[2]} />;
  if (match?.[1] === "display")
    return <Display key={match[2]} roomId={match[2]} />;
  if (!health)
    return (
      <div className="loading-screen">
        <Logo />
        <span>{error || "대화를 연결하고 있어요…"}</span>
        {error && (
          <Button onClick={() => location.reload()}>
            <RotateCcw size={17} />
            다시 시도
          </Button>
        )}
      </div>
    );
  return <Dashboard health={health} owner={owner} setOwner={setOwner} />;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="loading-screen">
        <Logo />
        <h1>화면을 다시 불러와 주세요.</h1>
        <Button onClick={() => location.reload()}>새로고침</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
