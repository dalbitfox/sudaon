import { createApplication } from "../server/app.mjs";
import WebSocket from "ws";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

// Own isolated local server and database; never sends load to production.
const count = 200,
  duration = Number(process.env.SUDAON_LOAD_SECONDS) || 30;
const instance = await createApplication({
  filename: ":memory:",
  messageInterval: 0,
});
await new Promise((resolve) => instance.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${instance.server.address().port}`;
const request = (route, body, cookie = "") =>
  fetch(`${base}/api${route}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const sessions = [],
  sockets = [],
  received = new Map(),
  started = Date.now();
let timer;
try {
  const owner = (await request("/owner/local", {})).headers
    .get("set-cookie")
    .split(";")[0];
  const { room } = await (
    await request("/rooms", { title: "격리된 200명 부하 검증" }, owner)
  ).json();
  for (let n = 0; n < count; n++) {
    const response = await request(`/rooms/${room.id}/join`, {
      nickname: `테스트청중${n}`,
    });
    if (response.status !== 201) throw new Error(`Admission failed at ${n}`);
    sessions.push(response.headers.get("set-cookie").split(";")[0]);
    const ws = new WebSocket(
      `${base.replace("http", "ws")}/api/socket?room=${room.id}`,
      { headers: { Cookie: sessions[n] } },
    );
    const queue = [];
    received.set(n, queue);
    ws.on("message", (body) => {
      const message = JSON.parse(body);
      if (message.type === "event" && message.data.type === "message")
        queue.push({
          id: message.data.data.id,
          delay: Date.now() - message.data.at,
        });
    });
    await once(ws, "open");
    sockets.push(ws);
  }
  const ownerSocket = new WebSocket(
    `${base.replace("http", "ws")}/api/socket?room=${room.id}`,
    { headers: { Cookie: owner } },
  );
  await once(ownerSocket, "open");
  sockets.push(ownerSocket);
  const tooMany = await request(`/rooms/${room.id}/join`, {
    nickname: "201번째청중",
  });
  if (tooMany.status !== 409)
    throw new Error("201st audience was not rejected");
  let messages = 0;
  const send = async () => {
    const response = await request(
      `/rooms/${room.id}/messages`,
      { text: `의견 데이터 실습 ${messages}`, requestId: randomUUID() },
      sessions[messages % count],
    );
    if (response.status !== 201)
      throw new Error(`Send failed: ${response.status}`);
    messages++;
  };
  const phaseStart = Date.now();
  for (let n = 0; n < duration * 2; n++) {
    await send();
    const remaining = phaseStart + (n + 1) * 500 - Date.now();
    if (remaining > 0)
      await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  const actualSteadySeconds = (Date.now() - phaseStart) / 1000;
  for (let n = 0; n < 20; n++) await send();
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const samples = [...received.values()]
    .flatMap((rows) => rows.map((r) => r.delay))
    .sort((a, b) => a - b);
  const counts = [...received.values()].map((rows) => rows.length);
  const duplicates = [...received.values()].reduce(
    (sum, rows) => sum + rows.length - new Set(rows.map((r) => r.id)).size,
    0,
  );
  const lost = counts.reduce((sum, n) => sum + Math.max(0, messages - n), 0);
  const report = {
    checkedAt: new Date().toISOString(),
    environment: "isolated local Node/SQLite server, not Vercel or Windows",
    audience: count,
    ownerConnections: 1,
    targetSteadySeconds: duration,
    actualSteadySeconds,
    steadyMessages: duration * 2,
    burstMessages: 20,
    originalMessages: messages,
    delivered: samples.length,
    expectedDeliveries: count * messages,
    lost,
    duplicates,
    p95Milliseconds: samples[Math.floor(samples.length * 0.95)],
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    passed:
      lost === 0 &&
      duplicates === 0 &&
      samples[Math.floor(samples.length * 0.95)] < 1000,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/load-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  for (const ws of sockets) ws.terminate();
  await instance.close();
}
