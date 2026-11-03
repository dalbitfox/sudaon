export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    ...(options.body && typeof options.body !== "string"
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "요청을 처리하지 못했습니다.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export function navigate(path) {
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export const localTime = (value) =>
  new Date(value).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export const localDate = (value) =>
  new Date(value).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });

export function clientDeviceType() {
  if (typeof navigator === "undefined") return "pc";
  const ua = navigator.userAgent || "";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua))
    return "tablet";
  if (/mobi|iphone|ipod|android|iemobile|opera mini/i.test(ua))
    return "mobile";
  if (
    navigator.maxTouchPoints > 1 &&
    typeof window !== "undefined" &&
    Math.min(window.screen.width, window.screen.height) >= 600 &&
    Math.max(window.screen.width, window.screen.height) <= 1366
  ) {
    return "tablet";
  }
  return "pc";
}

export function deviceBadge(device) {
  if (device === "mobile") return { icon: "📱", label: "모바일 접속" };
  if (device === "tablet") return { icon: "📟", label: "태블릿 접속" };
  if (device === "ai") return { icon: "✨", label: "AI 어시스턴트" };
  return { icon: "🖥️", label: "PC 접속" };
}
