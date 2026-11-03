import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  RotateCcw,
  Trophy,
  Share2,
  Users,
  Plus,
  X,
  Volume2,
  VolumeX,
  Sparkles,
  Check,
} from "lucide-react";
import { api } from "./api";

/* =========================================================
 * 1. 테트리스 (Tetris) — 개인 플레이 + 채팅방 실시간 랭킹 공유
 * ========================================================= */
const COLS = 10;
const ROWS = 18;
const SHAPES = [
  { color: "#06b6d4", m: [[1, 1, 1, 1]] }, // I
  { color: "#eab308", m: [[1, 1], [1, 1]] }, // O
  { color: "#8b5cf6", m: [[0, 1, 0], [1, 1, 1]] }, // T
  { color: "#22c55e", m: [[0, 1, 1], [1, 1, 0]] }, // S
  { color: "#ef4444", m: [[1, 1, 0], [0, 1, 1]] }, // Z
  { color: "#3b82f6", m: [[1, 0, 0], [1, 1, 1]] }, // J
  { color: "#f97316", m: [[0, 0, 1], [1, 1, 1]] }, // L
];

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}
function randomPiece() {
  const s = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  return {
    color: s.color,
    m: s.m.map((r) => [...r]),
    x: Math.floor((COLS - s.m[0].length) / 2),
    y: 0,
  };
}
function rotateMatrix(m) {
  return m[0].map((_, c) => m.map((row) => row[c]).reverse());
}
function collides(board, piece, dx = 0, dy = 0, nextM = piece.m) {
  for (let r = 0; r < nextM.length; r++) {
    for (let c = 0; c < nextM[r].length; c++) {
      if (!nextM[r][c]) continue;
      const nx = piece.x + c + dx;
      const ny = piece.y + r + dy;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

export function TetrisGame({ roomId, sharedApp, onShareChat, audience, onError }) {
  const [board, setBoard] = useState(emptyBoard);
  const [piece, setPiece] = useState(randomPiece);
  const [nextPiece, setNextPiece] = useState(randomPiece);
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  const stateRef = useRef({ board, piece, nextPiece, score, lines, running, gameOver });
  stateRef.current = { board, piece, nextPiece, score, lines, running, gameOver };

  const submitScore = useCallback(
    async (finalScore) => {
      if (!roomId || finalScore <= 0) return;
      try {
        if (sharedApp?.appId === "tetris") {
          await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
            method: "POST",
            body: { action: "score", appId: "tetris", score: finalScore },
          });
        }
      } catch {}
    },
    [roomId, sharedApp?.appId, audience],
  );

  const lockPiece = useCallback(
    (curBoard, curPiece) => {
      const merged = curBoard.map((r) => [...r]);
      for (let r = 0; r < curPiece.m.length; r++) {
        for (let c = 0; c < curPiece.m[r].length; c++) {
          if (curPiece.m[r][c] && curPiece.y + r >= 0) {
            merged[curPiece.y + r][curPiece.x + c] = curPiece.color;
          }
        }
      }
      let cleared = 0;
      const remaining = merged.filter((row) => {
        if (row.every(Boolean)) {
          cleared++;
          return false;
        }
        return true;
      });
      while (remaining.length < ROWS) remaining.unshift(Array(COLS).fill(null));
      const gained = [0, 100, 300, 500, 800][cleared] || 0;
      const nextScore = stateRef.current.score + gained + 10;
      const nextLines = stateRef.current.lines + cleared;
      setBoard(remaining);
      setScore(nextScore);
      setLines(nextLines);

      const incoming = stateRef.current.nextPiece;
      const freshNext = randomPiece();
      setNextPiece(freshNext);
      if (collides(remaining, incoming, 0, 0)) {
        setRunning(false);
        setGameOver(true);
        submitScore(nextScore);
      } else {
        setPiece(incoming);
      }
    },
    [submitScore],
  );

  const move = useCallback(
    (dx, dy) => {
      const { board: b, piece: p, running: run } = stateRef.current;
      if (!run) return false;
      if (!collides(b, p, dx, dy)) {
        setPiece({ ...p, x: p.x + dx, y: p.y + dy });
        return true;
      }
      if (dy > 0) lockPiece(b, p);
      return false;
    },
    [lockPiece],
  );

  const rotate = useCallback(() => {
    const { board: b, piece: p, running: run } = stateRef.current;
    if (!run) return;
    const rotated = rotateMatrix(p.m);
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(b, p, kick, 0, rotated)) {
        setPiece({ ...p, x: p.x + kick, m: rotated });
        return;
      }
    }
  }, []);

  const hardDrop = useCallback(() => {
    const { board: b, piece: p, running: run } = stateRef.current;
    if (!run) return;
    let dy = 0;
    while (!collides(b, p, 0, dy + 1)) dy++;
    const dropped = { ...p, y: p.y + dy };
    lockPiece(b, dropped);
  }, [lockPiece]);

  useEffect(() => {
    if (!running) return;
    const speed = Math.max(160, 620 - Math.floor(lines / 5) * 45);
    const id = setInterval(() => move(0, 1), speed);
    return () => clearInterval(id);
  }, [running, lines, move]);

  useEffect(() => {
    if (!running) return;
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(-1, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        move(1, 0);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        move(0, 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        rotate();
      } else if (e.key === " ") {
        e.preventDefault();
        hardDrop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, move, rotate, hardDrop]);

  const startFresh = () => {
    setBoard(emptyBoard());
    setPiece(randomPiece());
    setNextPiece(randomPiece());
    setScore(0);
    setLines(0);
    setGameOver(false);
    setRunning(true);
  };

  // Compute ghost Y
  let ghostY = piece.y;
  while (!collides(board, piece, 0, ghostY - piece.y + 1)) ghostY++;

  const leaderboard = Object.values(sharedApp?.appId === "tetris" ? sharedApp.scores || {} : {})
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return (
    <div className="game-module tetris-module">
      <div className="game-top-stats">
        <div className="mini-stat">
          <span>점수</span>
          <strong>{score.toLocaleString()}</strong>
        </div>
        <div className="mini-stat">
          <span>줄 제거</span>
          <strong>{lines}</strong>
        </div>
        <div className="game-top-actions">
          {!running ? (
            <button type="button" className="button" onClick={startFresh}>
              <Play size={15} /> {gameOver ? "다시 시작" : score > 0 ? "새 게임" : "시작"}
            </button>
          ) : (
            <button
              type="button"
              className="button secondary"
              onClick={() => setRunning(false)}
            >
              일시정지
            </button>
          )}
          {!running && score > 0 && !gameOver && (
            <button
              type="button"
              className="button"
              onClick={() => setRunning(true)}
            >
              계속
            </button>
          )}
        </div>
      </div>

      <div className="tetris-stage">
        <div className="tetris-grid" role="img" aria-label="테트리스 보드">
          {board.map((row, r) =>
            row.map((cell, c) => {
              let color = cell;
              let ghost = false;
              const pr = r - piece.y;
              const pc = c - piece.x;
              if (
                running &&
                pr >= 0 &&
                pr < piece.m.length &&
                pc >= 0 &&
                pc < piece.m[0].length &&
                piece.m[pr][pc]
              ) {
                color = piece.color;
              } else if (running && !color) {
                const gr = r - ghostY;
                if (
                  gr >= 0 &&
                  gr < piece.m.length &&
                  pc >= 0 &&
                  pc < piece.m[0].length &&
                  piece.m[gr][pc]
                ) {
                  ghost = true;
                }
              }
              return (
                <i
                  key={`${r}-${c}`}
                  className={`t-cell ${ghost ? "ghost" : ""}`}
                  style={color ? { backgroundColor: color } : undefined}
                />
              );
            }),
          )}
          {gameOver && (
            <div className="tetris-overlay">
              <b>GAME OVER!</b>
              <span>최종 {score.toLocaleString()}점</span>
              <div className="overlay-btns">
                <button type="button" className="button" onClick={startFresh}>
                  <RotateCcw size={14} /> 재도전
                </button>
                {onShareChat && score > 0 && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      onShareChat(`🧱 테트리스 ${score.toLocaleString()}점(${lines}줄) 달성!`)
                    }
                  >
                    <Share2 size={14} /> 채팅 공유
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="tetris-side">
          <div className="next-box">
            <span>NEXT</span>
            <div
              className="next-preview"
              style={{
                gridTemplateColumns: `repeat(${nextPiece.m[0].length}, 14px)`,
              }}
            >
              {nextPiece.m.map((row, r) =>
                row.map((v, c) => (
                  <i
                    key={`${r}-${c}`}
                    style={v ? { backgroundColor: nextPiece.color } : undefined}
                  />
                )),
              )}
            </div>
          </div>
          {score > 0 && onShareChat && (
            <button
              type="button"
              className="button secondary mini-share"
              onClick={() => {
                submitScore(score);
                onShareChat(`🧱 테트리스 현재 ${score.toLocaleString()}점 기록 중!`);
              }}
            >
              <Share2 size={13} /> 점수 자랑
            </button>
          )}
          {leaderboard.length > 0 && (
            <div className="mini-leaderboard">
              <span>
                <Trophy size={12} /> 방 랭킹
              </span>
              {leaderboard.map((row, i) => (
                <div key={i}>
                  <b>
                    {i + 1}. {row.nickname}
                  </b>
                  <small>{row.score.toLocaleString()}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="tetris-controls" aria-label="테트리스 조작 버튼">
        <button type="button" onClick={() => move(-1, 0)} aria-label="왼쪽 이동">
          ◀
        </button>
        <button type="button" onClick={rotate} aria-label="블록 회전">
          ⟳ 회전
        </button>
        <button type="button" onClick={() => move(0, 1)} aria-label="아래로 내리기">
          ▼
        </button>
        <button type="button" onClick={hardDrop} aria-label="한 번에 내리기">
          ⏬ 드롭
        </button>
        <button type="button" onClick={() => move(1, 0)} aria-label="오른쪽 이동">
          ▶
        </button>
      </div>
    </div>
  );
}

/* =========================================================
 * 2. 스트레스 해소 게임 (Stress Buster Pop!)
 * ========================================================= */
const STRESS_TARGETS = [
  { label: "월요병", emoji: "😵", pts: 15, bg: "#fee2e2" },
  { label: "버그폭발", emoji: "🐛", pts: 20, bg: "#fef3c7" },
  { label: "무한회의", emoji: "⏰", pts: 15, bg: "#e0e7ff" },
  { label: "급한마감", emoji: "🔥", pts: 25, bg: "#ffedd5" },
  { label: "칼퇴행운", emoji: "🍀", pts: 40, bg: "#dcfce7" },
  { label: "보너스별", emoji: "⭐", pts: 50, bg: "#fef9c3" },
];

function playPopTone(combo) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = playPopTone._ctx || (playPopTone._ctx = new AudioCtx());
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(340 + Math.min(combo, 15) * 28, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.095);
  } catch {}
}

export function StressGame({ onShareChat }) {
  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [sound, setSound] = useState(true);
  const [bubbles, setBubbles] = useState([]);
  const [bursts, setBursts] = useState([]);
  const idSeq = useRef(1);

  useEffect(() => {
    if (!running) return;
    const spawn = setInterval(() => {
      setBubbles((prev) => {
        if (prev.length >= 8) return prev.slice(1);
        const t =
          STRESS_TARGETS[Math.floor(Math.random() * STRESS_TARGETS.length)];
        return [
          ...prev,
          {
            id: idSeq.current++,
            ...t,
            x: 14 + Math.random() * 72,
            y: 16 + Math.random() * 68,
          },
        ];
      });
    }, 520);
    const clock = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          setRunning(false);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => {
      clearInterval(spawn);
      clearInterval(clock);
    };
  }, [running]);

  const start = () => {
    setScore(0);
    setCombo(0);
    setTimeLeft(30);
    setBubbles([]);
    setRunning(true);
  };

  const smash = (b) => {
    const nextCombo = combo + 1;
    const bonus = Math.min(30, nextCombo * 2);
    setCombo(nextCombo);
    setScore((s) => s + b.pts + bonus);
    setBubbles((prev) => prev.filter((item) => item.id !== b.id));
    if (sound) playPopTone(nextCombo);
    const bid = idSeq.current++;
    setBursts((prev) => [
      ...prev.slice(-8),
      { id: bid, x: b.x, y: b.y, text: `+${b.pts + bonus}` },
    ]);
    setTimeout(() => {
      setBursts((prev) => prev.filter((item) => item.id !== bid));
    }, 550);
  };

  return (
    <div className="game-module stress-module">
      <div className="game-top-stats">
        <div className="mini-stat">
          <span>해소 점수</span>
          <strong>{score.toLocaleString()}</strong>
        </div>
        <div className="mini-stat">
          <span>콤보</span>
          <strong>{combo}x 🔥</strong>
        </div>
        <div className="mini-stat">
          <span>남은 시간</span>
          <strong>{timeLeft}초</strong>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => setSound((v) => !v)}
          aria-label={sound ? "효과음 끄기" : "효과음 켜기"}
        >
          {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
      </div>

      <div className="stress-arena">
        {!running && (
          <div className="stress-intro">
            <h4>💥 스트레스 버블 팡팡!</h4>
            <p>
              {timeLeft === 0
                ? `시원하게 ${score.toLocaleString()}점 돌파! 최고 ${combo}콤보!`
                : "30초 동안 떠오르는 스트레스 풍선을 터뜨려 날려버리세요!"}
            </p>
            <div className="overlay-btns">
              <button type="button" className="button" onClick={start}>
                <Play size={15} /> {timeLeft === 0 ? "한 판 더!" : "시작하기"}
              </button>
              {timeLeft === 0 && score > 0 && onShareChat && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    onShareChat(
                      `💥 스트레스 해소 팡팡 ${score.toLocaleString()}점(${combo}콤보) 달성!`,
                    )
                  }
                >
                  <Share2 size={14} /> 결과 공유
                </button>
              )}
            </div>
          </div>
        )}
        {running &&
          bubbles.map((b) => (
            <button
              key={b.id}
              type="button"
              className="stress-bubble"
              style={{
                left: `${b.x}%`,
                top: `${b.y}%`,
                backgroundColor: b.bg,
              }}
              onClick={() => smash(b)}
            >
              <span>{b.emoji}</span>
              <small>{b.label}</small>
            </button>
          ))}
        {bursts.map((fx) => (
          <span
            key={fx.id}
            className="stress-burst"
            style={{ left: `${fx.x}%`, top: `${fx.y}%` }}
          >
            {fx.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
 * 3. 점심 메뉴 다트 (Lunch Menu Dart — 개인 & 공용 동기화 지원)
 * ========================================================= */
const WHEEL_COLORS = [
  "#1a5945",
  "#2f7a5e",
  "#4c956c",
  "#d97706",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#0d9488",
];

export function DartGame({
  roomId,
  sharedApp,
  isOwner,
  me,
  audience,
  onShareChat,
  onError,
}) {
  const isShared = sharedApp?.appId === "dart";
  const [localItems, setLocalItems] = useState([
    "김치찌개",
    "수제 돈까스",
    "베트남 쌀국수",
    "마라탕",
    "파스타·피자",
    "연어 포케",
  ]);
  const [newItem, setNewItem] = useState("");
  const [localResult, setLocalResult] = useState(null);
  const [spinning, setSpinning] = useState(false);

  const items = isShared ? sharedApp.config?.items || localItems : localItems;
  const activeResult = isShared ? sharedApp.result : localResult;
  const canControlShared =
    !isShared || isOwner || sharedApp.hostId === me;

  useEffect(() => {
    if (isShared && sharedApp.result?.spunAt) {
      setSpinning(true);
      const t = setTimeout(() => setSpinning(false), 2600);
      return () => clearTimeout(t);
    }
  }, [isShared, sharedApp?.result?.spunAt]);

  const openShared = async () => {
    try {
      await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
        method: "POST",
        body: { action: "open", appId: "dart", items: localItems },
      });
    } catch (e) {
      onError?.(e.message);
    }
  };

  const syncItems = async (nextList) => {
    setLocalItems(nextList);
    if (isShared && canControlShared) {
      try {
        await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
          method: "POST",
          body: { action: "configure", appId: "dart", items: nextList },
        });
      } catch (e) {
        onError?.(e.message);
      }
    }
  };

  const addMenu = (e) => {
    e.preventDefault();
    const trimmed = newItem.trim();
    if (!trimmed || items.length >= 12) return;
    syncItems([...items, trimmed]);
    setNewItem("");
  };

  const spin = async () => {
    if (items.length < 2 || spinning) return;
    if (isShared) {
      try {
        await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
          method: "POST",
          body: { action: "run", appId: "dart" },
        });
      } catch (e) {
        onError?.(e.message);
      }
      return;
    }
    const idx = Math.floor(Math.random() * items.length);
    const slice = 360 / items.length;
    const rot =
      (localResult?.rotation || 0) +
      360 * 6 +
      (360 - ((localResult?.rotation || 0) % 360)) +
      (360 - (idx * slice + slice / 2));
    setSpinning(true);
    setLocalResult({ winner: items[idx], rotation: rot, spunAt: Date.now() });
    setTimeout(() => setSpinning(false), 2600);
  };

  const sliceAngle = 360 / Math.max(2, items.length);

  return (
    <div className="game-module dart-module">
      <div className="shared-mode-bar">
        <span className={`mode-pill ${isShared ? "shared" : ""}`}>
          {isShared ? "🌐 방 전체 실시간 동기화 중" : "👤 내 화면 연습 모드"}
        </span>
        {!isShared && roomId && (
          <button type="button" className="button secondary sm" onClick={openShared}>
            <Users size={13} /> 다 같이 돌리기
          </button>
        )}
      </div>

      <div className="dart-wheel-box">
        <div className="dart-pointer" aria-hidden="true">
          ▼
        </div>
        <svg
          viewBox="-110 -110 220 220"
          className="dart-svg"
          style={{
            transform: `rotate(${activeResult?.rotation || 0}deg)`,
            transition: spinning
              ? "transform 2.5s cubic-bezier(0.16, 1, 0.3, 1)"
              : "none",
          }}
        >
          {items.map((label, i) => {
            const startDeg = i * sliceAngle - 90;
            const endDeg = (i + 1) * sliceAngle - 90;
            const rad1 = (startDeg * Math.PI) / 180;
            const rad2 = (endDeg * Math.PI) / 180;
            const x1 = Math.cos(rad1) * 102;
            const y1 = Math.sin(rad1) * 102;
            const x2 = Math.cos(rad2) * 102;
            const y2 = Math.sin(rad2) * 102;
            const largeArc = sliceAngle > 180 ? 1 : 0;
            const midDeg = startDeg + sliceAngle / 2;
            const midRad = (midDeg * Math.PI) / 180;
            const tx = Math.cos(midRad) * 62;
            const ty = Math.sin(midRad) * 62;
            return (
              <g key={i}>
                <path
                  d={`M 0 0 L ${x1} ${y1} A 102 102 0 ${largeArc} 1 ${x2} ${y2} Z`}
                  fill={WHEEL_COLORS[i % WHEEL_COLORS.length]}
                  stroke="#fff"
                  strokeWidth="1.5"
                />
                <text
                  x={tx}
                  y={ty}
                  fill="#fff"
                  fontSize="10"
                  fontWeight="700"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${midDeg + 90}, ${tx}, ${ty})`}
                >
                  {label.slice(0, 7)}
                </text>
              </g>
            );
          })}
          <circle cx="0" cy="0" r="16" fill="#fff" />
          <circle cx="0" cy="0" r="8" fill="#163e35" />
        </svg>
      </div>

      {activeResult && !spinning && (
        <div className="game-winner-banner">
          <span>🎯 선택된 메뉴:</span>
          <strong>{activeResult.winner}</strong>
          {onShareChat && (
            <button
              type="button"
              className="button secondary sm"
              onClick={() =>
                onShareChat(`🎯 점심 메뉴 다트 결과: [${activeResult.winner}] 당첨!`)
              }
            >
              <Share2 size={13} /> 채팅 공유
            </button>
          )}
        </div>
      )}

      {canControlShared && (
        <>
          <button
            type="button"
            className="button full"
            disabled={spinning || items.length < 2}
            onClick={spin}
          >
            🎯 {spinning ? "다트 회전 중…" : "다트 힘껏 던지기!"}
          </button>

          <form className="chip-editor-form" onSubmit={addMenu}>
            <input
              type="text"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="메뉴 추가 (최대 12개)"
              maxLength={25}
            />
            <button type="submit" className="button secondary">
              <Plus size={15} /> 추가
            </button>
          </form>
        </>
      )}

      <div className="item-chips">
        {items.map((m, idx) => (
          <span className="item-chip" key={`${m}-${idx}`}>
            {m}
            {canControlShared && items.length > 2 && (
              <button
                type="button"
                aria-label={`${m} 삭제`}
                onClick={() => syncItems(items.filter((_, i) => i !== idx))}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
 * 4. 제비뽑기 (Drawing Lots — 다중 참여 공용 추첨)
 * ========================================================= */
export function LotsGame({
  roomId,
  sharedApp,
  onlineParticipants = [],
  isOwner,
  me,
  audience,
  onShareChat,
  onError,
}) {
  const isShared = sharedApp?.appId === "lots";
  const [winnerCount, setWinnerCount] = useState(1);
  const [prizeLabel, setPrizeLabel] = useState("당첨 🎉");
  const [revealed, setRevealed] = useState({});

  useEffect(() => {
    setRevealed({});
  }, [sharedApp?.runAt]);

  const openShared = async () => {
    try {
      await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
        method: "POST",
        body: { action: "open", appId: "lots" },
      });
    } catch (e) {
      onError?.(e.message);
    }
  };

  const joinPool = async () => {
    try {
      await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
        method: "POST",
        body: { action: "join", appId: "lots" },
      });
    } catch (e) {
      onError?.(e.message);
    }
  };

  const importOnline = async () => {
    const names = onlineParticipants.map((p) => p.nickname).slice(0, 50);
    if (!names.length) return;
    try {
      await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
        method: "POST",
        body: {
          action: "configure",
          appId: "lots",
          customNames: names,
          labels: Array.from({ length: Math.max(1, winnerCount) }, () =>
            prizeLabel.trim() || "당첨 🎉",
          ),
        },
      });
    } catch (e) {
      onError?.(e.message);
    }
  };

  const runDraw = async () => {
    try {
      const labels = Array.from({ length: Math.max(1, winnerCount) }, () =>
        prizeLabel.trim() || "당첨 🎉",
      );
      await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
        method: "POST",
        body: { action: "configure", appId: "lots", labels },
      });
      await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
        method: "POST",
        body: { action: "run", appId: "lots" },
      });
    } catch (e) {
      onError?.(e.message);
    }
  };

  if (!isShared) {
    return (
      <div className="game-module lots-module">
        <div className="shared-start-card">
          <Sparkles size={28} />
          <h4>함께하는 공정 제비뽑기</h4>
          <p>
            참여자들이 직접 참가 버튼을 누르거나 현재 접속자를 불러와 서버 기준 공정 추첨으로 결과를 실시간 공유합니다.
          </p>
          <button type="button" className="button full" onClick={openShared}>
            🎲 공용 제비뽑기 방 열기
          </button>
        </div>
      </div>
    );
  }

  const canControl = isOwner || sharedApp.hostId === me;
  const participants =
    sharedApp.config?.customNames?.length > 0
      ? sharedApp.config.customNames.map((n, i) => ({ id: `c-${i}`, nickname: n }))
      : sharedApp.participants || [];
  const joinedMe = (sharedApp.participants || []).some((p) => p.id === me);
  const results = sharedApp.result || [];

  return (
    <div className="game-module lots-module">
      <div className="shared-mode-bar">
        <span className="mode-pill shared">
          🌐 참가자 {participants.length}명 대기 중
        </span>
        {!joinedMe && sharedApp.status === "lobby" && (
          <button type="button" className="button sm" onClick={joinPool}>
            🙋 나도 참가하기
          </button>
        )}
      </div>

      {canControl && (
        <div className="lots-admin-box">
          <div className="lots-config-row">
            <label>
              당첨 인원
              <input
                type="number"
                min="1"
                max={Math.max(1, participants.length)}
                value={winnerCount}
                onChange={(e) => setWinnerCount(Math.max(1, Number(e.target.value)))}
              />
            </label>
            <label>
              당첨 문구
              <input
                type="text"
                value={prizeLabel}
                maxLength={20}
                onChange={(e) => setPrizeLabel(e.target.value)}
              />
            </label>
          </div>
          <div className="lots-btn-row">
            <button
              type="button"
              className="button secondary sm"
              onClick={importOnline}
            >
              <Users size={14} /> 현재 접속자 전원 불러오기
            </button>
            <button
              type="button"
              className="button sm"
              disabled={!participants.length}
              onClick={runDraw}
            >
              🎲 공정 추첨 시작
            </button>
          </div>
        </div>
      )}

      {results.length > 0 ? (
        <>
          <div className="lots-cards-grid">
            {results.map((item, idx) => {
              const isOpen = revealed[idx] || revealed._all;
              return (
                <button
                  key={idx}
                  type="button"
                  className={`lot-card ${isOpen ? (item.isWinner ? "winner" : "normal") : "folded"}`}
                  onClick={() => setRevealed((r) => ({ ...r, [idx]: true }))}
                >
                  <b>{item.name}</b>
                  <span>{isOpen ? item.result : "터치하여 개봉 ✉️"}</span>
                </button>
              );
            })}
          </div>
          <div className="lots-btn-row">
            <button
              type="button"
              className="button secondary sm"
              onClick={() => setRevealed({ _all: true })}
            >
              <Check size={14} /> 전체 결과 펼치기
            </button>
            {onShareChat && (
              <button
                type="button"
                className="button secondary sm"
                onClick={() => {
                  const winners = results
                    .filter((r) => r.isWinner)
                    .map((r) => `${r.name}(${r.result})`)
                    .join(", ");
                  onShareChat(
                    `🎲 제비뽑기 결과 발표: ${winners || "당첨자 없음"}`,
                  );
                }}
              >
                <Share2 size={14} /> 채팅에 결과 공유
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="item-chips">
          {participants.map((p) => (
            <span className="item-chip" key={p.id}>
              {p.nickname}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================
 * 5. 사다리타기 (Ladder Game — 공용 경로 동기화)
 * ========================================================= */
const LADDER_COLORS = [
  "#16a34a",
  "#2563eb",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#db2777",
  "#4f46e5",
];

export function LadderGame({
  roomId,
  sharedApp,
  onlineParticipants = [],
  isOwner,
  me,
  audience,
  onShareChat,
  onError,
}) {
  const isShared = sharedApp?.appId === "ladder";
  const [playersInput, setPlayersInput] = useState("민수, 지영, 현우, 수빈");
  const [outcomesInput, setOutcomesInput] = useState("커피 쏘기 ☕, 통과, 간식 당번 🍩, 통과");
  const [selectedCol, setSelectedCol] = useState(null); // null | number | "all"

  useEffect(() => {
    setSelectedCol("all");
  }, [sharedApp?.runAt]);

  const openAndStart = async () => {
    try {
      const players = playersInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);
      const outcomes = outcomesInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);
      if (players.length < 2) {
        onError?.("참가자를 쉼표로 구분해 2명 이상 입력해 주세요.");
        return;
      }
      if (!isShared) {
        await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
          method: "POST",
          body: { action: "open", appId: "ladder" },
        });
      }
      await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
        method: "POST",
        body: { action: "configure", appId: "ladder", players, outcomes },
      });
      await api(`/rooms/${roomId}/apps${audience ? "?audience=1" : ""}`, {
        method: "POST",
        body: { action: "run", appId: "ladder" },
      });
    } catch (e) {
      onError?.(e.message);
    }
  };

  const fillOnline = () => {
    const names = onlineParticipants.map((p) => p.nickname).slice(0, 8);
    if (names.length >= 2) {
      setPlayersInput(names.join(", "));
      setOutcomesInput(
        names.map((_, i) => (i === 0 ? "당첨 🎉" : "통과")).join(", "),
      );
    }
  };

  const canControl = !isShared || isOwner || sharedApp?.hostId === me;
  const ladder = isShared ? sharedApp.result : null;

  return (
    <div className="game-module ladder-module">
      {canControl && (
        <div className="ladder-setup">
          <div className="ladder-setup-head">
            <span>참가자 & 결과 (쉼표 구분, 2~10명)</span>
            {onlineParticipants.length >= 2 && (
              <button
                type="button"
                className="text-btn"
                onClick={fillOnline}
              >
                접속자 자동 입력
              </button>
            )}
          </div>
          <input
            type="text"
            value={playersInput}
            onChange={(e) => setPlayersInput(e.target.value)}
            placeholder="참가자 이름 (예: 민수, 지영, 현우)"
            aria-label="사다리 참가자 목록"
          />
          <input
            type="text"
            value={outcomesInput}
            onChange={(e) => setOutcomesInput(e.target.value)}
            placeholder="결과 항목 (예: 당첨, 통과, 커피 쏘기)"
            aria-label="사다리 결과 목록"
          />
          <button type="button" className="button full" onClick={openAndStart}>
            🪜 공용 사다리 생성 및 출발!
          </button>
        </div>
      )}

      {ladder && (
        <div className="ladder-stage">
          <div className="ladder-filter">
            <button
              type="button"
              className={selectedCol === "all" ? "active" : ""}
              onClick={() => setSelectedCol("all")}
            >
              전체 경로
            </button>
            {ladder.players.map((p, idx) => (
              <button
                key={idx}
                type="button"
                className={selectedCol === idx ? "active" : ""}
                onClick={() => setSelectedCol(idx)}
              >
                {p}
              </button>
            ))}
          </div>

          <svg
            viewBox={`0 0 ${ladder.players.length * 80} ${(ladder.rows + 2) * 32}`}
            className="ladder-svg"
          >
            {/* Vertical rails */}
            {ladder.players.map((p, c) => {
              const x = c * 80 + 40;
              const yTop = 28;
              const yBot = (ladder.rows + 1) * 32;
              return (
                <g key={c}>
                  <text
                    x={x}
                    y={16}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#1f372d"
                  >
                    {p.slice(0, 6)}
                  </text>
                  <line
                    x1={x}
                    y1={yTop}
                    x2={x}
                    y2={yBot}
                    stroke="#cbd5cb"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <text
                    x={x}
                    y={yBot + 18}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#14532d"
                  >
                    {ladder.outcomes[c]?.slice(0, 6)}
                  </text>
                </g>
              );
            })}
            {/* Horizontal rungs */}
            {ladder.rungs.map((row, r) =>
              row.map((hasBridge, c) =>
                hasBridge ? (
                  <line
                    key={`${r}-${c}`}
                    x1={c * 80 + 40}
                    y1={(r + 1) * 32 + 12}
                    x2={(c + 1) * 80 + 40}
                    y2={(r + 1) * 32 + 12}
                    stroke="#cbd5cb"
                    strokeWidth="3"
                  />
                ) : null,
              ),
            )}
            {/* Active traced paths */}
            {ladder.paths.map((pathObj, idx) => {
              if (selectedCol !== "all" && selectedCol !== idx) return null;
              const pts = pathObj.steps
                .map((pt) => {
                  const x = pt.c * 80 + 40;
                  const y =
                    pt.r === 0
                      ? 28
                      : pt.r === ladder.rows
                        ? (ladder.rows + 1) * 32
                        : (pt.r + 0.5) * 32 + 12;
                  return `${x},${y}`;
                })
                .join(" ");
              return (
                <polyline
                  key={idx}
                  points={pts}
                  fill="none"
                  stroke={LADDER_COLORS[idx % LADDER_COLORS.length]}
                  strokeWidth={selectedCol === idx ? "4.5" : "3"}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
          </svg>

          <div className="ladder-summary">
            {ladder.paths.map((p, idx) => (
              <div key={idx} className="ladder-pair">
                <b>{p.player}</b>
                <span>→</span>
                <strong>{p.outcome}</strong>
              </div>
            ))}
          </div>

          {onShareChat && (
            <button
              type="button"
              className="button secondary full"
              onClick={() => {
                const txt = ladder.paths
                  .map((p) => `${p.player}→${p.outcome}`)
                  .join(" / ");
                onShareChat(`🪜 사다리타기 결과: ${txt}`);
              }}
            >
              <Share2 size={14} /> 채팅에 사다리 결과 공유
            </button>
          )}
        </div>
      )}
    </div>
  );
}
