import React, { useState, useEffect, useRef, useMemo } from "react";
import { Search, X } from "lucide-react";

const EMOJI_DATA = [
  // 표정·감정
  { e: "😀", c: "face", k: "웃음 스마일 기쁨 happy smile" },
  { e: "😄", c: "face", k: "활짝 웃음 하하 smile laugh" },
  { e: "😂", c: "face", k: "눈물 웃음 빵터짐 lol joy" },
  { e: "🤣", c: "face", k: "데굴데굴 폭소 rofl" },
  { e: "😊", c: "face", k: "미소 수줍 따뜻 blush" },
  { e: "🥰", c: "face", k: "사랑 하트 감동 love" },
  { e: "😍", c: "face", k: "하트눈 반함 최고 heart eyes" },
  { e: "🤩", c: "face", k: "별눈 기대 신남 star" },
  { e: "😎", c: "face", k: "선글라스 멋짐 쿨 cool" },
  { e: "🤔", c: "face", k: "생각 고민 흠 thinking" },
  { e: "😮", c: "face", k: "놀람 오오 wow surprised" },
  { e: "🥳", c: "face", k: "파티 축하 생일 party celebrate" },
  { e: "🥹", c: "face", k: "울컥 감동 고마워 touching" },
  { e: "😢", c: "face", k: "슬픔 눈물 ㅠㅠ sad cry" },
  { e: "😭", c: "face", k: "오열 통곡 엉엉 sob" },
  { e: "😅", c: "face", k: "식은땀 머쓱 민망 sweat" },
  { e: "😴", c: "face", k: "졸림 잠 피곤 sleep" },
  { e: "🤯", c: "face", k: "충격 대박 멘붕 mindblown" },
  // 제스처·사람
  { e: "👍", c: "hand", k: "따봉 최고 굿 좋아요 thumb good" },
  { e: "👏", c: "hand", k: "박수 짝짝 칭찬 clap" },
  { e: "🙌", c: "hand", k: "만세 환호 예스 hooray" },
  { e: "🙏", c: "hand", k: "감사 부탁 제발 하이파이브 thanks pray" },
  { e: "👋", c: "hand", k: "안녕 인사 반가워 wave hello bye" },
  { e: "🤝", c: "hand", k: "악수 협력 동의 handshake" },
  { e: "✌️", c: "hand", k: "브이 평화 승리 peace" },
  { e: "💪", c: "hand", k: "화이팅 힘 근육 strong fighting" },
  { e: "🫡", c: "hand", k: "충성 확인 알겠습니다 salute" },
  { e: "🙋", c: "hand", k: "저요 질문 손들기 raise hand" },
  { e: "🙆", c: "hand", k: "오케이 찬성 동그라미 ok" },
  { e: "🙅", c: "hand", k: "노 반대 엑스 no" },
  // 축하·하트
  { e: "❤️", c: "heart", k: "빨간하트 사랑 좋아요 heart love" },
  { e: "🧡", c: "heart", k: "주황하트 따뜻 orange heart" },
  { e: "💛", c: "heart", k: "노란하트 응원 yellow heart" },
  { e: "💚", c: "heart", k: "초록하트 수다온 green heart" },
  { e: "💙", c: "heart", k: "파란하트 신뢰 blue heart" },
  { e: "💜", c: "heart", k: "보라하트 purple heart" },
  { e: "🔥", c: "heart", k: "불 열정 핫 불꽃 fire hot" },
  { e: "✨", c: "heart", k: "반짝 스파클 깔끔 sparkles" },
  { e: "🎉", c: "heart", k: "축하 폭죽 이벤트 tada party" },
  { e: "🎊", c: "heart", k: "박터트리기 축하 confetti" },
  { e: "💯", c: "heart", k: "백점 완벽 만점 100" },
  { e: "🌟", c: "heart", k: "별 스타 빛남 star" },
  // 음식·커피
  { e: "☕", c: "food", k: "커피 아메리카노 카페 coffee" },
  { e: "🍵", c: "food", k: "녹차 차 티타임 tea" },
  { e: "🍕", c: "food", k: "피자 간식 점심 pizza" },
  { e: "🍔", c: "food", k: "햄버거 점심 버거 burger" },
  { e: "🍜", c: "food", k: "라면 국수 쌀국수 점심 noodle" },
  { e: "🍱", c: "food", k: "도시락 밥 정식 lunchbox" },
  { e: "🍗", c: "food", k: "치킨 닭다리 야식 chicken" },
  { e: "🍰", c: "food", k: "케이크 디저트 달콤 cake" },
  { e: "🍩", c: "food", k: "도넛 간식 donut" },
  { e: "🍺", c: "food", k: "맥주 건배 회식 beer" },
  { e: "🍓", c: "food", k: "딸기 과일 strawberry" },
  { e: "🥗", c: "food", k: "샐러드 포케 건강 salad" },
  // 활동·게임·사물
  { e: "🎮", c: "activity", k: "게임 컨트롤러 오락 game" },
  { e: "🎯", c: "activity", k: "다트 과녁 목표 정답 dart target" },
  { e: "🎲", c: "activity", k: "주사위 뽑기 랜덤 dice" },
  { e: "🏆", c: "activity", k: "트로피 우승 1등 상 trophy win" },
  { e: "💡", c: "activity", k: "아이디어 전구 팁 유레카 idea bulb" },
  { e: "📊", c: "activity", k: "설문 통계 차트 결과 chart poll" },
  { e: "📢", c: "activity", k: "공지 확성기 안내 발표 announce" },
  { e: "✅", c: "activity", k: "체크 완료 확인 check done" },
  { e: "❓", c: "activity", k: "질문 물음표 궁금 question" },
  { e: "❗", c: "activity", k: "느낌표 중요 강조 bang" },
  { e: "🚀", c: "activity", k: "로켓 출발 업그레이드 성장 rocket" },
  { e: "🍀", c: "activity", k: "네잎클로버 행운 당첨 luck" },
];

const CATEGORIES = [
  { id: "recent", label: "최근" },
  { id: "all", label: "전체" },
  { id: "face", label: "표정" },
  { id: "hand", label: "제스처" },
  { id: "heart", label: "하트·축하" },
  { id: "food", label: "음식" },
  { id: "activity", label: "활동·기호" },
];

function loadRecentEmojis() {
  try {
    const saved = JSON.parse(localStorage.getItem("sudaon-recent-emojis") || "[]");
    if (Array.isArray(saved) && saved.length) return saved.slice(0, 16);
  } catch {}
  return ["👍", "👏", "😊", "😂", "❤️", "🔥", "🎉", "🙌"];
}

export function EmojiPicker({ onSelect, onClose }) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState(loadRecentEmojis);
  const rootRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return EMOJI_DATA.filter((item) => item.k.includes(q) || item.e === q);
    }
    if (category === "recent") {
      return recent.map((e) => ({ e, c: "recent", k: e }));
    }
    if (category === "all") return EMOJI_DATA;
    return EMOJI_DATA.filter((item) => item.c === category);
  }, [category, query, recent]);

  const pick = (emoji) => {
    const updated = [emoji, ...recent.filter((x) => x !== emoji)].slice(0, 16);
    setRecent(updated);
    try {
      localStorage.setItem("sudaon-recent-emojis", JSON.stringify(updated));
    } catch {}
    onSelect?.(emoji);
  };

  return (
    <div
      className="emoji-popover"
      ref={rootRef}
      role="dialog"
      aria-label="이모지 선택"
    >
      <div className="emoji-header">
        <div className="emoji-search">
          <Search size={14} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이모지 검색 (예: 박수, 하트, 커피)"
            aria-label="이모지 검색"
          />
          {query && (
            <button
              type="button"
              className="emoji-clear"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="이모지 창 닫기"
        >
          <X size={16} />
        </button>
      </div>
      {!query && (
        <div className="emoji-tabs" role="tablist">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={category === cat.id}
              className={category === cat.id ? "active" : ""}
              onClick={() => setCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-grid">
        {!filtered.length ? (
          <p className="emoji-empty">일치하는 이모지가 없어요.</p>
        ) : (
          filtered.map((item) => (
            <button
              key={item.e}
              type="button"
              className="emoji-cell"
              onClick={() => pick(item.e)}
              aria-label={`이모지 ${item.e}`}
            >
              {item.e}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
