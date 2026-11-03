import React, { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

const PALETTE = [
  "#146c4e",
  "#2563eb",
  "#7c3aed",
  "#d97706",
  "#0d9488",
  "#db2777",
  "#4f46e5",
  "#2f6f3e",
];

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function WordCloudView({ words = [], compact = false }) {
  const containerRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const simRef = useRef(new Map());
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  );
  const [paused, setPaused] = useState(false);
  const [renderItems, setRenderItems] = useState([]);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = (e) => setReducedMotion(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const topMax = words[0]?.count || 1;
  const maxItems = compact ? 16 : 22;

  useEffect(() => {
    const currentSlice = words.slice(0, maxItems);
    const activeSet = new Set(currentSlice.map((w) => w.word));

    setRenderItems((prev) => {
      const next = [];
      const existingMap = new Map(prev.map((item) => [item.word, item]));

      currentSlice.forEach((w, idx) => {
        const h = hashString(w.word);
        const ratio = w.count / topMax;
        const minFont = compact ? 14 : 15;
        const maxFont = compact ? 30 : 38;
        const fontSize = Math.round(minFont + (maxFont - minFont) * ratio);
        const color = PALETTE[h % PALETTE.length];
        const prevItem = existingMap.get(w.word);
        next.push({
          word: w.word,
          count: w.count,
          sessions: w.sessions,
          fontSize,
          color,
          rank: idx,
          exiting: false,
          seed: prevItem?.seed ?? (h % 1000) / 1000,
        });
      });

      // Smooth fade-out for words that just dropped out
      for (const old of prev) {
        if (!activeSet.has(old.word) && !old.exiting) {
          next.push({ ...old, exiting: true });
        }
      }
      return next;
    });

    const cleanupTimer = setTimeout(() => {
      setRenderItems((prev) => prev.filter((item) => !item.exiting));
    }, 650);
    return () => clearTimeout(cleanupTimer);
  }, [words, topMax, compact, maxItems]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId = 0;
    let lastTime = performance.now();

    const step = (now) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const rect = container.getBoundingClientRect();
      const W = Math.max(220, rect.width);
      const H = Math.max(150, rect.height);
      const sim = simRef.current;

      const activeEntries = renderItems.filter((i) => !i.exiting);

      // Initialize positions in an elliptical golden-angle spiral so initial placement never stacks
      activeEntries.forEach((item, idx) => {
        const approxW = Math.min(W * 0.75, [...item.word].length * item.fontSize * 0.92 + 18);
        const approxH = item.fontSize * 1.35 + 8;
        let state = sim.get(item.word);
        if (!state) {
          const angle = idx * 2.39996 + item.seed * Math.PI;
          const radius = idx === 0 ? 0 : Math.min(0.38, 0.11 * Math.sqrt(idx));
          const x = W / 2 + Math.cos(angle) * W * radius;
          const y = H / 2 + Math.sin(angle) * H * radius;
          const speed = 10 + (item.seed * 8);
          const dir = item.seed * Math.PI * 2;
          state = {
            x,
            y,
            vx: Math.cos(dir) * speed,
            vy: Math.sin(dir) * speed * 0.75,
            phase: item.seed * Math.PI * 2,
            w: approxW,
            h: approxH,
          };
          sim.set(item.word, state);
        } else {
          state.w = approxW;
          state.h = approxH;
        }
      });

      // Prune removed words from simulation
      const keepWords = new Set(renderItems.map((i) => i.word));
      for (const key of sim.keys()) {
        if (!keepWords.has(key)) sim.delete(key);
      }

      const animateMotion = !reducedMotion && !paused;

      if (animateMotion) {
        const keys = activeEntries.map((i) => i.word);
        // Gentle harmonic drift + soft pairwise collision repulsion
        for (let i = 0; i < keys.length; i++) {
          const a = sim.get(keys[i]);
          if (!a) continue;
          a.phase += dt * 0.85;
          a.x += (a.vx + Math.sin(a.phase) * 5) * dt;
          a.y += (a.vy + Math.cos(a.phase * 0.9) * 4) * dt;

          for (let j = i + 1; j < keys.length; j++) {
            const b = sim.get(keys[j]);
            if (!b) continue;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const minX = (a.w + b.w) * 0.52;
            const minY = (a.h + b.h) * 0.56;
            if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
              const overlapX = minX - Math.abs(dx);
              const overlapY = minY - Math.abs(dy);
              if (overlapX < overlapY) {
                const sign = dx >= 0 ? 1 : -1;
                const push = overlapX * 0.35;
                a.x += sign * push;
                b.x -= sign * push;
                a.vx = Math.abs(a.vx) * sign * 0.9;
                b.vx = -Math.abs(b.vx) * sign * 0.9;
              } else {
                const sign = dy >= 0 ? 1 : -1;
                const push = overlapY * 0.35;
                a.y += sign * push;
                b.y -= sign * push;
                a.vy = Math.abs(a.vy) * sign * 0.9;
                b.vy = -Math.abs(b.vy) * sign * 0.9;
              }
            }
          }

          // Strict boundary containment so no word ever escapes the box
          const padX = Math.min(W * 0.44, a.w / 2 + 8);
          const padY = Math.min(H * 0.42, a.h / 2 + 6);
          if (a.x < padX) {
            a.x = padX;
            a.vx = Math.abs(a.vx);
          } else if (a.x > W - padX) {
            a.x = W - padX;
            a.vx = -Math.abs(a.vx);
          }
          if (a.y < padY) {
            a.y = padY;
            a.vy = Math.abs(a.vy);
          } else if (a.y > H - padY) {
            a.y = H - padY;
            a.vy = -Math.abs(a.vy);
          }

          // Clamp max velocity so words stay calm & easy to read
          const maxV = 16;
          a.vx = Math.max(-maxV, Math.min(maxV, a.vx));
          a.vy = Math.max(-maxV, Math.min(maxV, a.vy));
        }
      } else {
        // Static collision relaxation pass so static mode also avoids overlap
        const keys = activeEntries.map((i) => i.word);
        for (let i = 0; i < keys.length; i++) {
          const a = sim.get(keys[i]);
          if (!a) continue;
          const padX = Math.min(W * 0.44, a.w / 2 + 8);
          const padY = Math.min(H * 0.42, a.h / 2 + 6);
          a.x = Math.max(padX, Math.min(W - padX, a.x));
          a.y = Math.max(padY, Math.min(H - padY, a.y));
        }
      }

      for (const item of renderItems) {
        const el = nodeRefs.current.get(item.word);
        const st = sim.get(item.word);
        if (el && st) {
          el.style.transform = `translate3d(${Math.round(st.x * 10) / 10}px, ${Math.round(st.y * 10) / 10}px, 0) translate(-50%, -50%)`;
        }
      }

      if (animateMotion) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [renderItems, reducedMotion, paused]);

  return (
    <div className={`interactive-cloud-wrap ${compact ? "compact" : ""}`}>
      <div
        ref={containerRef}
        className="interactive-word-cloud"
        role="region"
        aria-label="실시간 인터랙티브 워드클라우드"
      >
        {renderItems.map((w) => (
          <span
            key={w.word}
            ref={(el) => {
              if (el) nodeRefs.current.set(w.word, el);
              else nodeRefs.current.delete(w.word);
            }}
            className={`floating-word ${w.exiting ? "exiting" : "entering"} ${w.rank === 0 ? "top-word" : ""}`}
            title={`${w.word} · ${w.count}개 메시지 · ${w.sessions}개 세션`}
            style={{
              fontSize: `${w.fontSize}px`,
              color: w.color,
            }}
          >
            {w.word}
            {w.rank < 3 && <sup className="word-badge">{w.count}</sup>}
          </span>
        ))}
      </div>
      {!reducedMotion && (
        <button
          type="button"
          className="cloud-motion-toggle"
          onClick={() => setPaused((v) => !v)}
          aria-label={paused ? "워드클라우드 움직임 재생" : "워드클라우드 움직임 일시정지"}
          title={paused ? "애니메이션 켜기" : "애니메이션 멈추기"}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          <span>{paused ? "움직임 켜기" : "움직임 멈춤"}</span>
        </button>
      )}
    </div>
  );
}
