import React, { useState, useRef } from "react";
import { Palette, Upload, RotateCcw, Check, Share2, Image as ImageIcon } from "lucide-react";
import { api } from "./api";

const STORAGE_KEY = "sudaon-theme-v2";
const PHOTO_STORAGE_KEY = "sudaon-theme-photo-v2";

export const SOLID_PRESETS = [
  { id: "sage", label: "세이지 민트", color: "#eaf1e6", dark: false },
  { id: "cream", label: "웜 크림", color: "#f6efe2", dark: false },
  { id: "sky", label: "클리어 스카이", color: "#e6f0f8", dark: false },
  { id: "lavender", label: "소프트 라벤더", color: "#eeeaf7", dark: false },
  { id: "forest", label: "딥 포레스트", color: "#153229", dark: true },
  { id: "midnight", label: "미드나잇 네이비", color: "#141e30", dark: true },
  { id: "charcoal", label: "모던 차콜", color: "#1f2428", dark: true },
];

export const GRADIENT_PRESETS = [
  {
    id: "dawn",
    label: "숲속 새벽",
    css: "linear-gradient(135deg, #d8ebd6 0%, #f3f7ec 52%, #dcecf2 100%)",
    dark: false,
  },
  {
    id: "peach",
    label: "피치 블라썸",
    css: "linear-gradient(135deg, #fde2d9 0%, #fff4e8 50%, #e7f0fd 100%)",
    dark: false,
  },
  {
    id: "aurora",
    label: "오로라 나이트",
    css: "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)",
    dark: true,
  },
  {
    id: "twilight",
    label: "트와일라잇 퍼플",
    css: "linear-gradient(135deg, #1e1b4b 0%, #312e81 55%, #1e3a5f 100%)",
    dark: true,
  },
];

// Built-in offline-safe SVG scenic wallpapers
export const SCENIC_PRESETS = [
  {
    id: "hills",
    label: "초록 구릉",
    dark: false,
    url: `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d7eed8"/><stop offset="100%" stop-color="#f7faf2"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="950" cy="180" r="95" fill="#fff7d1" opacity="0.85"/><path d="M0 560 Q320 420 680 540 T1200 490 L1200 800 L0 800 Z" fill="#a8d5ae" opacity="0.55"/><path d="M0 640 Q420 510 820 630 T1200 590 L1200 800 L0 800 Z" fill="#6fb07f" opacity="0.5"/></svg>`,
    )}`,
  },
  {
    id: "starlight",
    label: "별빛 호수",
    dark: true,
    url: `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="n" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0d1b2a"/><stop offset="55%" stop-color="#1b263b"/><stop offset="100%" stop-color="#274060"/></linearGradient></defs><rect width="1200" height="800" fill="url(#n)"/><circle cx="220" cy="160" r="3" fill="#fff" opacity="0.8"/><circle cx="480" cy="110" r="2.5" fill="#fff" opacity="0.7"/><circle cx="820" cy="190" r="3.5" fill="#fff" opacity="0.85"/><circle cx="1020" cy="140" r="55" fill="#fefae0" opacity="0.9"/><path d="M0 590 Q360 470 720 580 T1200 520 L1200 800 L0 800 Z" fill="#13293d" opacity="0.85"/></svg>`,
    )}`,
  },
  {
    id: "sunset",
    label: "노을 해변",
    dark: false,
    url: `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffd6ba"/><stop offset="55%" stop-color="#ffe8d6"/><stop offset="100%" stop-color="#cdeac0"/></linearGradient></defs><rect width="1200" height="800" fill="url(#s)"/><circle cx="600" cy="360" r="120" fill="#ff9f68" opacity="0.55"/><path d="M0 580 Q350 530 650 580 T1200 560 L1200 800 L0 800 Z" fill="#76b4bd" opacity="0.45"/></svg>`,
    )}`,
  },
];

export const DEFAULT_THEME = {
  mode: "default", // default | solid | gradient | preset | image
  color: "#eaf1e6",
  gradientId: "dawn",
  presetId: "hills",
  panelOpacity: 50, // Spec Section 6.2 & 6.3: 50% default starting opacity!
  overlayOpacity: 25,
  overlayTone: "dark", // dark | light
  bgFit: "cover", // cover | contain
  bgPosX: 50,
  bgPosY: 50,
};

function isHexDark(hex) {
  const m = String(hex || "").replace("#", "");
  if (m.length !== 6) return false;
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.42;
}

export function loadUserTheme() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const photo = localStorage.getItem(PHOTO_STORAGE_KEY) || "";
    if (parsed && typeof parsed === "object") {
      return { ...DEFAULT_THEME, ...parsed, customPhoto: photo };
    }
  } catch {}
  return { ...DEFAULT_THEME, customPhoto: "" };
}

export function saveUserTheme(theme) {
  try {
    const { customPhoto, ...rest } = theme;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    if (customPhoto !== undefined) {
      if (customPhoto) localStorage.setItem(PHOTO_STORAGE_KEY, customPhoto);
      else localStorage.removeItem(PHOTO_STORAGE_KEY);
    }
  } catch {}
}

export function computeThemeStyles(theme, roomTheme = null) {
  const active =
    theme?.mode && theme.mode !== "default"
      ? theme
      : roomTheme && roomTheme.mode !== "default"
        ? { ...DEFAULT_THEME, ...roomTheme, customPhoto: "" }
        : theme || DEFAULT_THEME;

  if (!active) {
    return {
      isCustom: false,
      isDarkSurface: false,
      containerStyle: {},
      overlayStyle: null,
    };
  }

  let bgImage = "radial-gradient(circle at 20% 20%, #e4f0dc 0%, #f3f6ef 60%, #e9efe4 100%)";
  let bgColor = "#f1f5ed";
  let darkBg = false;

  if (active.mode === "solid") {
    bgColor = active.color || "#eaf1e6";
    darkBg = isHexDark(bgColor);
  } else if (active.mode === "gradient") {
    const g =
      GRADIENT_PRESETS.find((x) => x.id === active.gradientId) ||
      GRADIENT_PRESETS[0];
    bgImage = g.css;
    darkBg = g.dark;
  } else if (active.mode === "preset") {
    const p =
      SCENIC_PRESETS.find((x) => x.id === active.presetId) || SCENIC_PRESETS[0];
    bgImage = `url("${p.url}")`;
    darkBg = p.dark;
  } else if (active.mode === "image" && active.customPhoto) {
    bgImage = `url("${active.customPhoto}")`;
    darkBg = active.overlayTone !== "light";
  }

  const alpha = Math.max(0, Math.min(1, Number(active.panelOpacity ?? 50) / 100));
  const overlayAlpha = Math.max(
    0,
    Math.min(0.85, Number(active.overlayOpacity ?? 25) / 100),
  );
  // Automatic contrast compensation when panel is very transparent over dark/bright background
  const effectiveDark =
    active.mode === "image"
      ? active.overlayTone === "dark" && (overlayAlpha >= 0.3 || alpha < 0.45)
      : darkBg && alpha < 0.72;

  const surfaceRgb = effectiveDark ? "20, 32, 28" : "255, 255, 255";
  const feedRgb = effectiveDark ? "16, 26, 23" : "250, 252, 247";
  // Guarantee readable contrast even at low panelOpacity by keeping bubble solid enough while panel breathes
  const bubbleAlpha = Math.max(0.82, alpha);

  return {
    isCustom: true,
    isDarkSurface: effectiveDark,
    containerStyle: {
      "--theme-bg-color": bgColor,
      "--theme-bg-image": bgImage,
      "--theme-bg-fit": active.bgFit || "cover",
      "--theme-bg-pos": `${active.bgPosX ?? 50}% ${active.bgPosY ?? 50}%`,
      "--chat-panel-bg": `rgba(${surfaceRgb}, ${alpha})`,
      "--chat-feed-bg": `rgba(${feedRgb}, ${alpha})`,
      "--chat-bubble-other": effectiveDark
        ? `rgba(38, 56, 49, ${bubbleAlpha})`
        : `rgba(241, 246, 236, ${bubbleAlpha})`,
      "--chat-bubble-other-ink": effectiveDark ? "#eef6f0" : "#22382c",
      "--chat-fg": effectiveDark ? "#f2f7f3" : "#1f372d",
      "--chat-muted": effectiveDark ? "#b8c9be" : "#5d6e61",
    },
    overlayStyle:
      active.mode === "image" || active.mode === "preset"
        ? {
            backgroundColor:
              active.overlayTone === "light"
                ? `rgba(255, 255, 255, ${overlayAlpha})`
                : `rgba(12, 20, 17, ${overlayAlpha})`,
          }
        : null,
  };
}

async function resizeImageFile(file) {
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
    throw new Error("JPG, PNG, WEBP, GIF 형식의 이미지만 업로드할 수 있습니다.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("이미지 크기는 8MB 이하만 지원합니다.");
  }
  const bitmapUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("손상되었거나 지원하지 않는 이미지입니다."));
    el.src = bitmapUrl;
  });
  const maxDim = 1440;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function ThemeSettingsModal({
  theme,
  onChange,
  onClose,
  isOwner = false,
  roomId = "",
  onError,
}) {
  const [uploadError, setUploadError] = useState("");
  const [sharing, setSharing] = useState(false);
  const fileRef = useRef(null);

  const update = (patch) => {
    const next = { ...theme, ...patch };
    onChange(next);
    saveUserTheme(next);
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    try {
      const dataUrl = await resizeImageFile(file);
      update({
        mode: "image",
        customPhoto: dataUrl,
        panelOpacity: theme.mode === "default" ? 50 : theme.panelOpacity,
      });
    } catch (err) {
      setUploadError(err.message);
    } finally {
      e.target.value = "";
    }
  };

  const resetTheme = () => {
    const fresh = { ...DEFAULT_THEME, customPhoto: "" };
    onChange(fresh);
    saveUserTheme(fresh);
  };

  const applyToRoom = async () => {
    if (!roomId || theme.mode === "image") return;
    setSharing(true);
    try {
      const { customPhoto, ...shareable } = theme;
      await api(`/rooms/${roomId}/theme`, {
        method: "PUT",
        body: { theme: shareable },
      });
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="theme-settings-body">
      <p className="muted">
        배경과 채팅창 투명도를 각각 설정할 수 있습니다. 글자와 입력창은 항상 선명하게 유지됩니다.
      </p>
      {uploadError && <div className="notice">{uploadError}</div>}

      <div className="theme-section">
        <h3>
          <Palette size={15} /> 1. 배경 선택
        </h3>
        <div className="theme-mode-tabs">
          {[
            ["default", "기본"],
            ["solid", "단색"],
            ["gradient", "그라데이션"],
            ["preset", "기본 풍경"],
            ["image", "내 사진"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={theme.mode === id ? "active" : ""}
              onClick={() => update({ mode: id })}
            >
              {label}
            </button>
          ))}
        </div>

        {theme.mode === "solid" && (
          <div className="swatch-row">
            {SOLID_PRESETS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`swatch ${theme.color === s.color ? "selected" : ""}`}
                style={{ backgroundColor: s.color }}
                title={s.label}
                aria-label={s.label}
                onClick={() => update({ mode: "solid", color: s.color })}
              >
                {theme.color === s.color && <Check size={14} />}
              </button>
            ))}
            <label className="color-picker-chip" title="직접 색상 선택">
              <input
                type="color"
                value={theme.color || "#eaf1e6"}
                onChange={(e) =>
                  update({ mode: "solid", color: e.target.value })
                }
              />
              <span>직접 선택</span>
            </label>
          </div>
        )}

        {theme.mode === "gradient" && (
          <div className="preset-grid">
            {GRADIENT_PRESETS.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`preset-card ${theme.gradientId === g.id ? "selected" : ""}`}
                style={{ backgroundImage: g.css }}
                onClick={() => update({ mode: "gradient", gradientId: g.id })}
              >
                <span>{g.label}</span>
              </button>
            ))}
          </div>
        )}

        {theme.mode === "preset" && (
          <div className="preset-grid">
            {SCENIC_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`preset-card scenic ${theme.presetId === p.id ? "selected" : ""}`}
                style={{ backgroundImage: `url("${p.url}")` }}
                onClick={() => update({ mode: "preset", presetId: p.id })}
              >
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        )}

        {theme.mode === "image" && (
          <div className="photo-upload-box">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              onChange={handleUpload}
            />
            <button
              type="button"
              className="button secondary full"
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={16} /> 배경 사진 업로드 (JPG/PNG/WEBP, 8MB 이하)
            </button>
            {theme.customPhoto && (
              <div className="photo-adjust-controls">
                <div className="segmented">
                  <button
                    type="button"
                    className={theme.bgFit === "cover" ? "selected" : ""}
                    onClick={() => update({ bgFit: "cover" })}
                  >
                    화면 꽉 채우기
                  </button>
                  <button
                    type="button"
                    className={theme.bgFit === "contain" ? "selected" : ""}
                    onClick={() => update({ bgFit: "contain" })}
                  >
                    원본 비율 맞춤
                  </button>
                </div>
                <label>
                  가로/세로 위치 조정{" "}
                  <b>
                    {theme.bgPosX}% · {theme.bgPosY}%
                  </b>
                  <div className="dual-sliders">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      aria-label="가로 위치"
                      value={theme.bgPosX}
                      onChange={(e) =>
                        update({ bgPosX: Number(e.target.value) })
                      }
                    />
                    <input
                      type="range"
                      min="0"
                      max="100"
                      aria-label="세로 위치"
                      value={theme.bgPosY}
                      onChange={(e) =>
                        update({ bgPosY: Number(e.target.value) })
                      }
                    />
                  </div>
                </label>
              </div>
            )}
          </div>
        )}

        {(theme.mode === "image" || theme.mode === "preset") && (
          <div className="overlay-controls">
            <div className="segmented">
              <button
                type="button"
                className={theme.overlayTone === "dark" ? "selected" : ""}
                onClick={() => update({ overlayTone: "dark" })}
              >
                어두운 오버레이 (흰 글씨 강조)
              </button>
              <button
                type="button"
                className={theme.overlayTone === "light" ? "selected" : ""}
                onClick={() => update({ overlayTone: "light" })}
              >
                밝은 오버레이 (진한 글씨 강조)
              </button>
            </div>
            <label>
              배경 오버레이 강도 <b>{theme.overlayOpacity}%</b>
              <input
                type="range"
                min="0"
                max="85"
                value={theme.overlayOpacity}
                onChange={(e) =>
                  update({ overlayOpacity: Number(e.target.value) })
                }
              />
            </label>
          </div>
        )}
      </div>

      <div className="theme-section">
        <h3>
          <ImageIcon size={15} /> 2. 채팅창 패널 불투명도
        </h3>
        <label>
          채팅창 불투명도 (기본 50%) <b>{theme.panelOpacity}%</b>
          <input
            type="range"
            min="0"
            max="100"
            value={theme.panelOpacity}
            onChange={(e) => update({ panelOpacity: Number(e.target.value) })}
          />
        </label>
        <p className="theme-caption">
          불투명도를 낮추면 선택한 배경이 채팅창 뒤로 은은하게 비치며, 텍스트에는 투명도가 적용되지 않습니다.
        </p>
      </div>

      <div className="theme-actions">
        <button
          type="button"
          className="button secondary"
          onClick={resetTheme}
        >
          <RotateCcw size={15} /> 배경 초기화
        </button>
        {isOwner && roomId && theme.mode !== "image" && (
          <button
            type="button"
            className="button secondary"
            disabled={sharing}
            onClick={applyToRoom}
          >
            <Share2 size={15} /> {sharing ? "적용 중…" : "방 기본 테마로 지정"}
          </button>
        )}
        <button type="button" className="button" onClick={onClose}>
          완료
        </button>
      </div>
    </div>
  );
}
