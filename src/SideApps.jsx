import React, { useState, useEffect, useRef } from "react";
import {
  Gamepad2,
  ClipboardList,
  Bot,
  Sparkles,
  Maximize2,
  Minimize2,
  ChevronUp,
  ChevronDown,
  X,
  Users,
  MessageCircle,
  GripVertical,
} from "lucide-react";
import {
  TetrisGame,
  StressGame,
  DartGame,
  LotsGame,
  LadderGame,
} from "./Games";
import { SurveyApp, AiToolApp } from "./SurveyAndAi";
import { WordCloudView } from "./WordCloudView";

/* =========================================================
 * 13.1 확장 가능한 부가 앱 모듈 레지스트리 (Extensible App Module Registry)
 * 새로운 게임/설문/투표/AI 도구/발표 보조 도구를 독립 모듈로 손쉽게 등록 가능
 * ========================================================= */
export const APP_MODULES = [
  {
    id: "survey",
    name: "실시간 설문",
    shortName: "설문",
    emoji: "📊",
    category: "tool",
    sharedCapable: true,
    ownerOnly: false,
    render: (ctx) => (
      <SurveyApp
        roomId={ctx.roomId}
        polls={ctx.roomData?.polls || []}
        isOwner={ctx.isOwner}
        audience={ctx.audience}
        onError={ctx.onError}
      />
    ),
  },
  {
    id: "ai",
    name: "수다온 AI",
    shortName: "AI",
    emoji: "🤖",
    category: "tool",
    sharedCapable: true,
    ownerOnly: false,
    render: (ctx) => (
      <AiToolApp
        roomId={ctx.roomId}
        aiEnabled={ctx.roomData?.aiEnabled !== false}
        aiStatus={ctx.aiStatus}
        aiFeatureInfo={ctx.aiFeatureInfo}
        isOwner={ctx.isOwner}
        audience={ctx.audience}
        onError={ctx.onError}
      />
    ),
  },
  {
    id: "tetris",
    name: "테트리스",
    shortName: "테트리스",
    emoji: "🧱",
    category: "game",
    sharedCapable: true,
    ownerOnly: false,
    render: (ctx) => (
      <TetrisGame
        roomId={ctx.roomId}
        sharedApp={ctx.roomData?.sharedApp}
        onShareChat={ctx.onShareChat}
        audience={ctx.audience}
        onError={ctx.onError}
      />
    ),
  },
  {
    id: "stress",
    name: "스트레스 팡팡",
    shortName: "팡팡",
    emoji: "💥",
    category: "game",
    sharedCapable: false,
    ownerOnly: false,
    render: (ctx) => <StressGame onShareChat={ctx.onShareChat} />,
  },
  {
    id: "dart",
    name: "점심 메뉴 다트",
    shortName: "다트",
    emoji: "🎯",
    category: "game",
    sharedCapable: true,
    ownerOnly: false,
    render: (ctx) => (
      <DartGame
        roomId={ctx.roomId}
        sharedApp={ctx.roomData?.sharedApp}
        isOwner={ctx.isOwner}
        me={ctx.roomData?.me}
        audience={ctx.audience}
        onShareChat={ctx.onShareChat}
        onError={ctx.onError}
      />
    ),
  },
  {
    id: "lots",
    name: "제비뽑기",
    shortName: "제비뽑기",
    emoji: "🎟️",
    category: "game",
    sharedCapable: true,
    ownerOnly: false,
    render: (ctx) => (
      <LotsGame
        roomId={ctx.roomId}
        sharedApp={ctx.roomData?.sharedApp}
        onlineParticipants={ctx.onlineParticipants}
        isOwner={ctx.isOwner}
        me={ctx.roomData?.me}
        audience={ctx.audience}
        onShareChat={ctx.onShareChat}
        onError={ctx.onError}
      />
    ),
  },
  {
    id: "ladder",
    name: "사다리타기",
    shortName: "사다리",
    emoji: "🪜",
    category: "game",
    sharedCapable: true,
    ownerOnly: false,
    render: (ctx) => (
      <LadderGame
        roomId={ctx.roomId}
        sharedApp={ctx.roomData?.sharedApp}
        onlineParticipants={ctx.onlineParticipants}
        isOwner={ctx.isOwner}
        me={ctx.roomData?.me}
        audience={ctx.audience}
        onShareChat={ctx.onShareChat}
        onError={ctx.onError}
      />
    ),
  },
  {
    id: "wordcloud",
    name: "워드클라우드",
    shortName: "키워드",
    emoji: "☁️",
    category: "tool",
    sharedCapable: false,
    ownerOnly: false,
    render: (ctx) => (
      <div className="side-wordcloud-wrap">
        <p className="muted">
          지금 대화방에서 가장 많이 언급된 키워드가 살아 움직입니다.
        </p>
        <WordCloudView words={ctx.meta?.recent || ctx.meta?.all || []} />
      </div>
    ),
  },
];

export function useIsMobileLayout(breakpoint = 960) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, [breakpoint]);
  return isMobile;
}

export function SideAppHost({
  activeAppId,
  onSelectApp,
  onClose,
  roomId,
  roomData,
  meta,
  aiStatus,
  aiFeatureInfo,
  isOwner = false,
  audience = false,
  onShareChat,
  onError,
}) {
  const isMobile = useIsMobileLayout(960);
  const [panelWidth, setPanelWidth] = useState(410);
  const [fullscreen, setFullscreen] = useState(false);
  // Mobile sheet stage: "compact" | "expanded" | "fullscreen"
  const [sheetStage, setSheetStage] = useState("expanded");
  const [unreadWhileOpen, setUnreadWhileOpen] = useState(0);
  const lastMsgIdRef = useRef(roomData?.messages?.at(-1)?.id || null);
  const dragRef = useRef(null);

  const modules = APP_MODULES.filter((m) => !m.ownerOnly || isOwner);
  const activeModule =
    modules.find((m) => m.id === activeAppId) || modules[0];

  const openPollsCount = (roomData?.polls || []).filter(
    (p) => p.status === "open",
  ).length;
  const sharedAppId = roomData?.sharedApp?.appId || null;

  // Track incoming chat messages while mobile sheet or fullscreen is covering chat
  useEffect(() => {
    const latestId = roomData?.messages?.at(-1)?.id || null;
    if (!latestId) return;
    if (lastMsgIdRef.current && latestId !== lastMsgIdRef.current) {
      if (activeAppId && (fullscreen || isMobile)) {
        setUnreadWhileOpen((c) => c + 1);
      }
    }
    lastMsgIdRef.current = latestId;
  }, [roomData?.messages, activeAppId, fullscreen, isMobile]);

  useEffect(() => {
    if (!activeAppId) {
      setFullscreen(false);
      setUnreadWhileOpen(0);
    }
  }, [activeAppId]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape" && fullscreen) {
        setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  if (!activeAppId || !activeModule) return null;

  const startResize = (e) => {
    if (isMobile || fullscreen) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const maxW = Math.min(720, Math.floor(window.innerWidth * 0.6));
      setPanelWidth(Math.max(320, Math.min(maxW, startWidth + delta)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const cycleSheetStage = () => {
    setSheetStage((prev) =>
      prev === "compact"
        ? "expanded"
        : prev === "expanded"
          ? "fullscreen"
          : "compact",
    );
  };

  const ctx = {
    roomId,
    roomData,
    meta,
    onlineParticipants:
      meta?.onlineParticipants || roomData?.onlineParticipants || [],
    aiStatus,
    aiFeatureInfo,
    isOwner,
    audience,
    onShareChat,
    onError,
  };

  const containerClass = [
    "side-app-host",
    isMobile ? `mobile-sheet stage-${sheetStage}` : "pc-left-panel",
    fullscreen ? "is-fullscreen" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside
      className={containerClass}
      style={
        !isMobile && !fullscreen ? { width: `${panelWidth}px` } : undefined
      }
      aria-label={`${activeModule.name} 도구 패널`}
    >
      {isMobile && (
        <div className="sheet-grab-bar" onClick={cycleSheetStage}>
          <span className="sheet-pill-handle" />
        </div>
      )}

      <header className="side-app-header">
        <div className="side-app-title">
          <span className="side-app-emoji" aria-hidden="true">
            {activeModule.emoji}
          </span>
          <b>{activeModule.name}</b>
          {sharedAppId === activeModule.id && (
            <span className="shared-live-pill">
              <Users size={11} /> 공용 진행 중
            </span>
          )}
        </div>

        <div className="side-app-window-btns">
          {isMobile ? (
            <button
              type="button"
              className="icon-button sm"
              onClick={cycleSheetStage}
              aria-label="패널 크기 조절"
              title="크기 전환 (축소/확장/전체화면)"
            >
              {sheetStage === "fullscreen" ? (
                <ChevronDown size={17} />
              ) : (
                <ChevronUp size={17} />
              )}
            </button>
          ) : (
            <button
              type="button"
              className="icon-button sm"
              onClick={() => {
                setFullscreen((v) => !v);
                setUnreadWhileOpen(0);
              }}
              aria-label={fullscreen ? "분할 화면으로 복귀" : "전체화면 확대"}
              title={fullscreen ? "분할 화면으로 복귀" : "전체화면 확대"}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          <button
            type="button"
            className="icon-button sm"
            onClick={onClose}
            aria-label="도구 패널 닫기"
            title="닫기"
          >
            <X size={17} />
          </button>
        </div>
      </header>

      {/* Module Switcher Tabs */}
      <nav className="side-app-tabs" aria-label="부가 앱 전환">
        {modules.map((mod) => {
          const isCurrent = mod.id === activeModule.id;
          const hasSharedBadge = sharedAppId === mod.id;
          const hasPollBadge = mod.id === "survey" && openPollsCount > 0;
          return (
            <button
              key={mod.id}
              type="button"
              className={`side-app-tab ${isCurrent ? "active" : ""}`}
              aria-pressed={isCurrent}
              onClick={() => onSelectApp(mod.id)}
            >
              <span aria-hidden="true">{mod.emoji}</span>
              <span>{mod.shortName}</span>
              {hasPollBadge && (
                <i className="tab-badge">{openPollsCount}</i>
              )}
              {hasSharedBadge && <i className="tab-dot" title="공용 실행 중" />}
            </button>
          );
        })}
      </nav>

      {/* Unread Chat Notification Banner on Mobile / Fullscreen */}
      {unreadWhileOpen > 0 && (isMobile || fullscreen) && (
        <button
          type="button"
          className="side-unread-chat-banner"
          onClick={() => {
            setUnreadWhileOpen(0);
            if (fullscreen) setFullscreen(false);
            else if (sheetStage === "fullscreen" || sheetStage === "expanded")
              setSheetStage("compact");
            else onClose?.();
          }}
        >
          <MessageCircle size={14} />
          <span>새 채팅 {unreadWhileOpen}개 도착 · 대화 확인하기</span>
        </button>
      )}

      <div className="side-app-content">{activeModule.render(ctx)}</div>

      {!isMobile && !fullscreen && (
        <div
          ref={dragRef}
          className="side-app-resizer"
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="패널 너비 조절 핸들"
          title="드래그하여 패널 너비 조절"
        >
          <GripVertical size={14} />
        </div>
      )}
    </aside>
  );
}
