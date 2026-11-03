import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError, hash } from "./model.mjs";

export function auth(secret, secure) {
  const sign = (data) => {
    const body = Buffer.from(
      JSON.stringify({ ...data, exp: Date.now() + 86400000 }),
    ).toString("base64url");
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  };
  const verify = (token) => {
    try {
      const [body, sig] = token.split(".");
      const expected = createHmac("sha256", secret)
        .update(body)
        .digest("base64url");
      if (
        !sig ||
        sig.length !== expected.length ||
        !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      )
        return null;
      const data = JSON.parse(Buffer.from(body, "base64url").toString());
      return data.exp > Date.now() ? data : null;
    } catch {
      return null;
    }
  };
  const cookies = (req) =>
    Object.fromEntries(
      (req.headers.cookie || "")
        .split(";")
        .map((c) => c.trim().split(/=(.*)/s))
        .filter((c) => c.length >= 2)
        .map(([k, v]) => [k, v]),
    );
  const owner = (req) => verify(cookies(req).sudaon_owner)?.role === "owner";
  const display = (req, roomId, explicitToken = "") => {
    const candidate =
      explicitToken ||
      req.query?.dt ||
      cookies(req)[`sudaon_display_${roomId}`] ||
      "";
    if (!candidate) return false;
    const data = verify(String(candidate));
    return data?.role === "display" && data?.roomId === roomId;
  };
  const guest = (req, roomId) => {
    const data = verify(cookies(req)[`sudaon_guest_${roomId}`]);
    return data?.roomId === roomId ? data : null;
  };
  const set = (res, name, data) =>
    res.cookie(name, sign(data), {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/api",
      maxAge: 86400000,
    });
  return {
    sign,
    verify,
    owner,
    display,
    guest,
    set,
    requireOwner: (req, res, next) =>
      owner(req)
        ? next()
        : next(new AppError(401, "발표자 로그인이 필요합니다.")),
    participant: (req, state) => {
      const data = guest(req, state.room.id);
      const p = state.participants[data?.id];
      if (!p || p.tokenHash !== hash(data.nonce) || p.kicked)
        throw new AppError(403, "입장이 필요하거나 참여가 제한된 세션입니다.");
      return p;
    },
  };
}
