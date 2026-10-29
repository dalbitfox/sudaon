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
