import React, { useEffect, useState, useRef } from "react";
import {
  QrCode,
  Copy,
  Check,
  X,
  Maximize2,
  Pin,
  PinOff,
  PanelsTopLeft,
  Monitor,
  PictureInPicture2,
  CircleHelp,
  Download,
  ExternalLink,
  Laptop,
  CheckCircle2,
  RefreshCw,
  Loader2,
  Sparkles,
} from "lucide-react";
import QRCode from "qrcode";
import { api } from "./api";

const tokenCache = new Map();
const activeLaunches = new Map();

function makeLaunchId() {
  try {
    return crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, "");
  } catch {
    return `ld_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function loadSavedDisplayOptions() {
  try {
    return JSON.parse(localStorage.getItem("sudaon-display") || "{}");
  } catch {
    return {};
  }
}

export async function prefetchDisplayToken(roomId) {
  if (!roomId) return "";
  const cached = tokenCache.get(roomId);
  if (cached && cached.exp > Date.now()) return cached.token;
  try {
    const res = await api(`/rooms/${roomId}/display-token`, { method: "POST" });
    if (res?.token) {
      tokenCache.set(roomId, {
        token: res.token,
        exp: Date.now() + 30 * 60 * 1000,
      });
      return res.token;
    }
  } catch {}
  return "";
}

export function buildSudaonProtocolUrl({
  roomId,
  options = {},
  token = "",
  launchId = "",
}) {
  const saved = loadSavedDisplayOptions();
  const layout = options.layout || saved.layout || "split";
  const opacity = options.opacity ?? saved.opacity ?? 85;
  const font = options.font ?? saved.font ?? 20;
  const topChat =
    options.topChat !== undefined ? options.topChat : saved.topChat !== false;
  const topKeywords =
    options.topKeywords !== undefined
      ? options.topKeywords
      : saved.topKeywords !== false;

  const qs = new URLSearchParams({
    origin: location.origin,
    roomId,
    layout,
    opacity: String(opacity),
    font: String(font),
    top: String(topChat),
    topChat: String(topChat),
    topKeywords: String(topKeywords),
  });
  if (token) qs.set("dt", token);
  if (launchId) qs.set("lid", launchId);
  return `sudaon://display?${qs.toString()}`;
}

export function triggerProtocolUrl(protocolUrl) {
  const anchor = document.createElement("a");
  anchor.href = protocolUrl;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => anchor.remove(), 500);
}

export function triggerInstallerDownload(downloadUrl) {
  if (!downloadUrl || typeof document === "undefined") return;
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = downloadUrl;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), 15000);
}

export async function launchWindowsDisplayApp(roomId, customOptions = {}) {
  const saved = loadSavedDisplayOptions();
  const merged = {
    roomId,
    layout: customOptions.layout || saved.layout || "split",
    opacity: customOptions.opacity ?? saved.opacity ?? 85,
    font: customOptions.font ?? saved.font ?? 20,
    top:
      customOptions.topChat !== undefined
        ? customOptions.topChat
        : saved.topChat !== false,
    topChat:
      customOptions.topChat !== undefined
        ? customOptions.topChat
        : saved.topChat !== false,
    topKeywords:
      customOptions.topKeywords !== undefined
        ? customOptions.topKeywords
        : saved.topKeywords !== false,
  };
  localStorage.setItem("sudaon-display", JSON.stringify(merged));

  if (typeof window !== "undefined" && window.sudaon) {
    await window.sudaon.openDisplay(merged);
    return { mode: "native" };
  }

  const launchId = makeLaunchId();
  const tracker = {
    launchId,
    roomId,
    startedAt: Date.now(),
    blurred: false,
  };
  if (typeof window !== "undefined") {
    const onBlur = () => {
      tracker.blurred = true;
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") tracker.blurred = true;
    };
    window.addEventListener("blur", onBlur, { once: true });
    document.addEventListener("visibilitychange", onVis, { once: true });
    setTimeout(() => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    }, 4000);
  }
  activeLaunches.set(roomId, tracker);

  const registerPendingOnServer = () =>
    api(`/rooms/${roomId}/display-token`, {
      method: "POST",
      body: {
        launchId,
        options: { ...merged, origin: location.origin },
      },
    })
      .then((res) => {
        if (res?.token) {
          tokenCache.set(roomId, {
            token: res.token,
            exp: Date.now() + 30 * 60 * 1000,
          });
        }
        return res?.token || "";
      })
      .catch(() => "");

  // Use cached token synchronously so browser user-activation is preserved
  const cachedEntry = tokenCache.get(roomId);
  if (cachedEntry && cachedEntry.exp > Date.now()) {
    const url = buildSudaonProtocolUrl({
      roomId,
      options: merged,
      token: cachedEntry.token,
      launchId,
    });
    triggerProtocolUrl(url);
    registerPendingOnServer();
    return { mode: "protocol", url, launchId };
  }

  const freshToken = await registerPendingOnServer();
  const url = buildSudaonProtocolUrl({
    roomId,
    options: merged,
    token: freshToken,
    launchId,
  });
  triggerProtocolUrl(url);
  return { mode: "protocol", url, launchId };
}

/* =========================================================
 * 11.2 QR 코드 크게 보기 (80% 고대비 전용 확대 화면 + ESC + 전체화면)
 * ========================================================= */
export function QrZoomModal({ room, url, onClose, onError }) {
  const [highResQr, setHighResQr] = useState("");
  const [copied, setCopied] = useState(false);
  const overlayRef = useRef(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, {
      width: 1024,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (active) setHighResQr(dataUrl);
      })
      .catch(() => onError?.("고해상도 QR 생성에 실패했습니다."));

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      active = false;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [url, onClose, onError]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError?.("링크를 복사하지 못했습니다.");
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await overlayRef.current?.requestFullscreen?.();
      }
    } catch {}
  };

  return (
    <div
      className="qr-zoom-backdrop"
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${room.title} 확대 QR 코드`}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose?.();
      }}
    >
      <div className="qr-zoom-topbar">
        <div className="qr-zoom-title">
          <QrCode size={22} />
          <div>
            <b>{room.title}</b>
            <span>카메라로 스캔하면 별명 입력 후 바로 입장합니다</span>
          </div>
        </div>
        <div className="qr-zoom-actions">
          <button
            type="button"
            className="button secondary sm"
            onClick={copyLink}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "링크 복사됨" : "입장 링크 복사"}
          </button>
          {typeof document !== "undefined" && document.fullscreenEnabled && (
            <button
              type="button"
              className="button secondary sm"
              onClick={toggleFullscreen}
            >
              <Maximize2 size={15} /> 전체화면
            </button>
          )}
          <button
            type="button"
            className="button sm qr-close-btn"
            onClick={onClose}
            aria-label="확대 QR 닫기"
          >
            <X size={17} /> 닫기 (ESC)
          </button>
        </div>
      </div>

      <div className="qr-zoom-stage">
        <div className="qr-zoom-frame">
          {highResQr && (
            <img
              src={highResQr}
              alt={`${room.title} 채팅방 입장용 확대 QR 코드`}
            />
          )}
        </div>
      </div>

      <div className="qr-zoom-url">{url}</div>
    </div>
  );
}

/* =========================================================
 * 11.1 발표창 1 / 발표창 2 독립 항상 위 고정 & Windows 데스크톱 앱 실행기
 * ========================================================= */
export function DisplaySettingsContent({
  roomId,
  desktopDownloadUrl = "https://github.com/dalbitfox/sudaon/releases/latest/download/SudaOn-Setup.exe",
  autoLaunched = false,
  onClose,
}) {
  const initial = loadSavedDisplayOptions();
  const [layout, setLayout] = useState(() => initial.layout || "split");
  const [opacity, setOpacity] = useState(() => initial.opacity ?? 85);
  const [font, setFont] = useState(() => initial.font ?? 20);
  const [topChat, setTopChat] = useState(() => initial.topChat !== false);
  const [topKeywords, setTopKeywords] = useState(
    () => initial.topKeywords !== false,
  );
  const [liveStates, setLiveStates] = useState({});
  const [launchId, setLaunchId] = useState(
    () => activeLaunches.get(roomId)?.launchId || "",
  );
  // phase: "idle" | "checking" | "prompted" | "auto_installing" | "connected"
  const [launchPhase, setLaunchPhase] = useState(() =>
    autoLaunched ? "checking" : "idle",
  );
  const autoDownloadedRef = useRef(false);

  const native = typeof window !== "undefined" && Boolean(window.sudaon);
  const supportsDocPiP =
    typeof window !== "undefined" && "documentPictureInPicture" in window;

  useEffect(() => {
    if (!native) {
      prefetchDisplayToken(roomId);
      return;
    }
    if (!window.sudaon.getStates) return;
    window.sudaon.getStates().then(setLiveStates).catch(() => {});
    const off = window.sudaon.onStateChange?.((payload) => {
      if (payload && !payload.kind) setLiveStates(payload);
    });
    return () => off?.();
  }, [native, roomId]);

  useEffect(() => {
    if (native || launchPhase === "idle" || launchPhase === "connected") return;
    let cancelled = false;
    const tracker = activeLaunches.get(roomId);

    const markConnected = () => {
      if (cancelled) return;
      setLaunchPhase("connected");
      setTimeout(() => {
        if (!cancelled) onClose?.();
      }, 1400);
    };

    const onWsConnected = (ev) => {
      if (!ev?.detail?.roomId || ev.detail.roomId === roomId) {
        markConnected();
      }
    };
    window.addEventListener("sudaon:displayConnected", onWsConnected);

    const onBlur = () => {
      if (tracker) tracker.blurred = true;
      setLaunchPhase((cur) => (cur === "checking" ? "prompted" : cur));
    };
    window.addEventListener("blur", onBlur);

    // After 1.8s, if Windows did NOT recognize sudaon:// (neither blur nor ACK),
    // automatically download SudaOn-Setup.exe for this new presenter PC!
    const detectTimer = setTimeout(() => {
      if (cancelled) return;
      if (tracker?.blurred) {
        setLaunchPhase((cur) => (cur === "checking" ? "prompted" : cur));
      } else {
        setLaunchPhase((cur) => {
          if (cur === "checking") {
            if (!autoDownloadedRef.current) {
              autoDownloadedRef.current = true;
              triggerInstallerDownload(desktopDownloadUrl);
            }
            return "auto_installing";
          }
          return cur;
        });
      }
    }, 1800);

    const pollInterval = setInterval(async () => {
      if (cancelled || !launchId) return;
      try {
        const res = await api(
          `/rooms/${roomId}/display-ack?launchId=${encodeURIComponent(launchId)}`,
        );
        if (res?.connected) {
          markConnected();
        }
      } catch {}
    }, 1300);

    return () => {
      cancelled = true;
      clearTimeout(detectTimer);
      clearInterval(pollInterval);
      window.removeEventListener("sudaon:displayConnected", onWsConnected);
      window.removeEventListener("blur", onBlur);
    };
  }, [native, roomId, launchId, launchPhase, desktopDownloadUrl, onClose]);

  const currentOptions = {
    roomId,
    layout,
    opacity,
    font,
    top: topChat,
    topChat,
    topKeywords,
  };

  const toggleLiveWindowPin = async (kind, nextVal) => {
    if (kind === "chat" || kind === "combined") setTopChat(nextVal);
    if (kind === "keywords") setTopKeywords(nextVal);
    if (native) {
      try {
        await window.sudaon.control({
          action: "pin",
          kind,
          value: nextVal,
        });
      } catch {}
    }
  };

  const launchDesktop = async () => {
    const res = await launchWindowsDisplayApp(roomId, currentOptions);
    if (res.mode === "native") {
      onClose?.();
    } else {
      if (res.launchId) setLaunchId(res.launchId);
      setLaunchPhase("checking");
    }
  };

  const launchBrowserFallback = () => {
    localStorage.setItem("sudaon-display", JSON.stringify(currentOptions));
    const kinds = layout === "split" ? ["chat", "keywords"] : ["combined"];
    kinds.forEach((kind, idx) => {
      const pinVal = kind === "keywords" ? topKeywords : topChat;
      const params = new URLSearchParams({
        opacity: String(opacity),
        font: String(font),
        top: String(pinVal),
        kind,
        windowIndex: String(idx + 1),
      });
      const left = idx === 1 ? 580 : 40;
      window.open(
        `/display/${roomId}?${params}`,
        `sudaon-${roomId}-${kind}`,
        `popup,width=520,height=${kind === "keywords" ? 460 : 680},left=${left},top=60`,
      );
    });
    onClose?.();
  };

  return (
    <div className="display-settings-content">
      {!native && launchPhase !== "idle" && (
        <div
          className={`desktop-launch-banner phase-${launchPhase}`}
          role="status"
        >
          {launchPhase === "connected" ? (
            <div className="desktop-launch-head">
              <CheckCircle2 size={20} />
              <div>
                <b>수다온 Windows 투명 오버레이가 실행되었습니다!</b>
                <p>
                  발표 자료(PPT·슬라이드) 위에 투명 채팅·키워드 창이 최상위(Always
                  on Top)로 고정되었습니다.
                </p>
              </div>
            </div>
          ) : launchPhase === "checking" ? (
            <div className="desktop-launch-head">
              <Loader2 size={19} className="spin-icon" />
              <div>
                <b>이 PC의 수다온 Windows 앱을 실행하고 있습니다…</b>
                <p>
                  이미 설치된 PC라면 즉시 투명 오버레이가 열리며, 처음 사용하는
                  발표 PC라면 자동으로 원클릭 설치 파일을 내려받습니다.
                </p>
              </div>
            </div>
          ) : launchPhase === "auto_installing" ? (
            <>
              <div className="desktop-launch-head">
                <Sparkles size={19} />
                <div>
                  <b>
                    새 발표 PC 감지 · 원클릭 자동 설치 파일(SudaOn-Setup.exe)을
                    내려받았습니다!
                  </b>
                  <p>
                    브라우저 우측 상단 다운로드 목록에서{" "}
                    <b>SudaOn-Setup.exe를 한 번만 클릭</b>해 주세요. 설치 마법사나
                    관리자 권한 없이 <b>약 2초 만에 자동 설치</b>된 뒤, 다시 버튼을
                    누르지 않아도 <b>현재 발표방의 투명 오버레이 창이 자동으로 뜹니다.</b>
                  </p>
                </div>
              </div>
              <div className="desktop-install-guide">
                <span>
                  <Loader2 size={13} className="spin-icon inline-spin" /> 설치 완료
                  및 자동 실행 신호 대기 중… (Windows 보호 안내가 뜨면{" "}
                  <b>추가 정보 → 실행</b>을 눌러 주세요)
                </span>
                <div className="desktop-guide-actions">
                  <a
                    className="button secondary sm"
                    href={desktopDownloadUrl}
                  >
                    <Download size={14} /> 다운로드가 안 되었나요? SudaOn-Setup.exe 다시 받기
                  </a>
                  <button
                    type="button"
                    className="button secondary sm"
                    onClick={launchDesktop}
                  >
                    <RefreshCw size={13} /> 설치 후 바로 띄우기
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="desktop-launch-head">
                <CheckCircle2 size={18} />
                <div>
                  <b>수다온 Windows 앱 실행 신호를 보냈습니다!</b>
                  <p>
                    브라우저 상단에 <b>&ldquo;수다온(을)를 여시겠습니까?&rdquo;</b>{" "}
                    알림이 표시되면 <b>열기</b>를 클릭해 주세요. 슬라이드 위에 투명
                    최상위 오버레이 창이 즉시 나타납니다.
                  </p>
                </div>
              </div>
              <div className="desktop-install-guide">
                <span>
                  다른 PC로 옮기셨거나 앱이 열리지 않는다면 원클릭 자동 설치 파일을
                  실행해 주세요. 설치 즉시 현재 발표방 오버레이가 자동으로 연결됩니다.
                </span>
                <div className="desktop-guide-actions">
                  <a
                    className="button secondary sm"
                    href={desktopDownloadUrl}
                  >
                    <Download size={14} /> 원클릭 자동 설치 파일 (SudaOn-Setup.exe)
                  </a>
                  <button
                    type="button"
                    className="button secondary sm"
                    onClick={launchDesktop}
                  >
                    <RefreshCw size={13} /> 앱 다시 호출하기
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <p className="muted">
        발표 자료(PPT·PDF) 위에 실시간 채팅과 움직이는 워드클라우드를 투명하게
        띄우고 최상위에 고정합니다.
      </p>

      <fieldset className="display-layout">
        <legend>표시 창 구성</legend>
        <div className="choice-grid">
          <button
            type="button"
            className={layout === "combined" ? "selected" : ""}
            aria-pressed={layout === "combined"}
            onClick={() => setLayout("combined")}
          >
            <PanelsTopLeft size={22} />
            <b>통합 1개 창</b>
            <small>채팅 + 키워드 함께</small>
          </button>
          <button
            type="button"
            className={layout === "split" ? "selected" : ""}
            aria-pressed={layout === "split"}
            onClick={() => setLayout("split")}
          >
            <Monitor size={22} />
            <b>발표창 1 · 2 분리</b>
            <small>채팅창 / 키워드창 독립 배치</small>
          </button>
        </div>
      </fieldset>

      <div className="pin-control-cards">
        {layout === "combined" ? (
          <div className="pin-row-card">
            <div>
              <b>통합 발표창 항상 위 고정 (Always on Top)</b>
              <small>발표 슬라이드를 넘겨도 최상위 고정 유지</small>
            </div>
            <button
              type="button"
              className={`pin-toggle-btn ${topChat ? "pinned" : ""}`}
              aria-pressed={topChat}
              onClick={() => toggleLiveWindowPin("combined", !topChat)}
            >
              {topChat ? <Pin size={15} /> : <PinOff size={15} />}
              {topChat ? "고정 켜짐" : "고정 해제"}
            </button>
          </div>
        ) : (
          <>
            <div className="pin-row-card">
              <div>
                <b>
                  발표창 1 (실시간 채팅){" "}
                  {liveStates.chat?.open && <span className="tag">열림</span>}
                </b>
                <small>독립 Always on Top 상태 유지</small>
              </div>
              <button
                type="button"
                className={`pin-toggle-btn ${topChat ? "pinned" : ""}`}
                aria-pressed={topChat}
                onClick={() => toggleLiveWindowPin("chat", !topChat)}
              >
                {topChat ? <Pin size={15} /> : <PinOff size={15} />}
                {topChat ? "창 1 고정됨" : "창 1 해제됨"}
              </button>
            </div>
            <div className="pin-row-card">
              <div>
                <b>
                  발표창 2 (키워드·워드클라우드){" "}
                  {liveStates.keywords?.open && <span className="tag">열림</span>}
                </b>
                <small>독립 Always on Top 상태 유지</small>
              </div>
              <button
                type="button"
                className={`pin-toggle-btn ${topKeywords ? "pinned" : ""}`}
                aria-pressed={topKeywords}
                onClick={() => toggleLiveWindowPin("keywords", !topKeywords)}
              >
                {topKeywords ? <Pin size={15} /> : <PinOff size={15} />}
                {topKeywords ? "창 2 고정됨" : "창 2 해제됨"}
              </button>
            </div>
          </>
        )}
      </div>

      <label>
        표시창 배경 불투명도 <b>{opacity}%</b>
        <input
          type="range"
          min="15"
          max="100"
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
        />
      </label>
      <label>
        표시창 글자 크기 <b>{font}px</b>
        <input
          type="range"
          min="16"
          max="36"
          value={font}
          onChange={(e) => setFont(Number(e.target.value))}
        />
      </label>

      {native ? (
        <button type="button" className="button full" onClick={launchDesktop}>
          <Monitor size={18} />{" "}
          {layout === "split"
            ? "투명 발표창 2개 바로 띄우기"
            : "투명 통합 발표창 바로 띄우기"}
        </button>
      ) : (
        <div className="desktop-primary-actions">
          <button
            type="button"
            className="button dark full"
            onClick={launchDesktop}
          >
            <Laptop size={18} />{" "}
            {launchPhase !== "idle"
              ? "변경한 설정으로 Windows 앱에 다시 적용하기"
              : "수다온 Windows 앱 자동 설치 · 발표 화면 실행"}
          </button>

          <div className="desktop-secondary-row">
            <a className="button secondary sm" href={desktopDownloadUrl}>
              <Download size={14} /> 원클릭 설치 파일 받기 (SudaOn-Setup.exe)
            </a>
            <button
              type="button"
              className="button secondary sm"
              onClick={launchBrowserFallback}
              title={
                supportsDocPiP
                  ? "Chrome/Edge PiP 보조 창 또는 일반 팝업으로 열기"
                  : "앱 설치가 어려운 환경에서 일반 브라우저 팝업으로 열기"
              }
            >
              <ExternalLink size={14} /> 앱 없이 브라우저 창으로 열기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
