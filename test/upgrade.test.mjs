import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import ExcelJS from "exceljs";
import { createApplication } from "../server/app.mjs";

const cookie = (response) =>
  response.headers.get("set-cookie")?.split(";")[0] || "";

async function setup(options = {}) {
  const instance = await createApplication({
    filename: ":memory:",
    messageInterval: 0,
    pollInterval: 25,
    disconnectGraceMs: 80,
    autoCloseGraceMs: 90,
    ...options,
  });
  await new Promise((resolve) =>
    instance.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const request = async (
    path,
    { method = "GET", body, token = "", headers = {} } = {},
  ) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Cookie: token } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const owner = cookie(await request("/owner/local", { method: "POST" }));
  return { ...instance, base, request, owner };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("Upgrade 1: Device icons, Owner chat, Emoji, and strict own-message edit permissions", async (t) => {
  const app = await setup();
  t.after(() => app.close());

  const created = await (
    await app.request("/rooms", {
      method: "POST",
      token: app.owner,
      body: { title: "메신저 UX 고도화 테스트" },
    })
  ).json();
  const roomId = created.room.id;

  // Join from PC and Mobile User-Agents
  const pcJoin = await app.request(`/rooms/${roomId}/join`, {
    method: "POST",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0",
    },
    body: { nickname: "PC참여자" },
  });
  const pcToken = cookie(pcJoin);
  const pcData = await pcJoin.json();

  const mobJoin = await app.request(`/rooms/${roomId}/join`, {
    method: "POST",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148",
    },
    body: { nickname: "모바일참여자" },
  });
  const mobToken = cookie(mobJoin);
  const mobData = await mobJoin.json();

  assert.equal(
    mobData.participants.find((p) => p.id === pcData.me).device,
    "pc",
  );
  assert.equal(
    mobData.participants.find((p) => p.id === mobData.me).device,
    "mobile",
  );
  assert.ok(!JSON.stringify(mobData).includes("Mozilla"));

  // WebSocket listener on mobile guest
  const ws = new WebSocket(
    `${app.base.replace("http", "ws")}/api/socket?room=${roomId}&audience=1`,
    { headers: { Cookie: mobToken } },
  );
  const wsMessages = [];
  ws.on("message", (raw) => wsMessages.push(JSON.parse(raw)));
  await once(ws, "open");

  // PC guest sends emoji message
  const msgRes = await app.request(`/rooms/${roomId}/messages?audience=1`, {
    method: "POST",
    token: pcToken,
    body: { text: "반갑습니다 😊🎉🔥", requestId: "pc-emoji-msg-001" },
  });
  assert.equal(msgRes.status, 201);
  const msg = await msgRes.json();
  assert.equal(msg.text, "반갑습니다 😊🎉🔥");
  assert.equal(msg.device, "pc");

  // Owner also sends a chat message
  const ownerMsgRes = await app.request(`/rooms/${roomId}/messages`, {
    method: "POST",
    token: app.owner,
    body: { text: "환영합니다! 관리자 공지입니다 👋", requestId: "owner-msg-001" },
  });
  assert.equal(ownerMsgRes.status, 201);
  const ownerMsg = await ownerMsgRes.json();
  assert.equal(ownerMsg.role, "owner");
  assert.equal(ownerMsg.participantId, "owner");

  // Mobile guest CANNOT edit PC guest's message (403)
  assert.equal(
    (
      await app.request(`/rooms/${roomId}/messages/${msg.id}?audience=1`, {
        method: "PATCH",
        token: mobToken,
        body: { text: "타인 변조 시도" },
      })
    ).status,
    403,
  );

  // Even Owner CANNOT edit a guest's message (403 — only author can edit; owner can only delete)
  assert.equal(
    (
      await app.request(`/rooms/${roomId}/messages/${msg.id}`, {
        method: "PATCH",
        token: app.owner,
        body: { text: "관리자 변조 시도" },
      })
    ).status,
    403,
  );

  // Empty edit rejected (400)
  assert.equal(
    (
      await app.request(`/rooms/${roomId}/messages/${msg.id}?audience=1`, {
        method: "PATCH",
        token: pcToken,
        body: { text: "   " },
      })
    ).status,
    400,
  );

  // Author edits own message -> 200 + editedAt + realtime WS event
  const editRes = await app.request(
    `/rooms/${roomId}/messages/${msg.id}?audience=1`,
    {
      method: "PATCH",
      token: pcToken,
      body: { text: "반갑습니다 😊 수정된 메시지입니다!" },
    },
  );
  assert.equal(editRes.status, 200);
  const edited = await editRes.json();
  assert.equal(edited.text, "반갑습니다 😊 수정된 메시지입니다!");
  assert.ok(edited.editedAt > 0);

  await wait(60);
  assert.ok(
    wsMessages.some(
      (m) =>
        m.type === "event" &&
        m.data.type === "edited" &&
        m.data.data.id === msg.id,
    ),
  );
  ws.close();
});

test("Upgrade 2: Join/Leave system messages, reconnect grace dedupe, and Auto Room Lifecycle", async (t) => {
  // Use a short 1s presence TTL store wrapper check via socket lifecycle
  const app = await setup({
    disconnectGraceMs: 70,
    autoCloseGraceMs: 90,
  });
  t.after(() => app.close());

  const room = (
    await (
      await app.request("/rooms", {
        method: "POST",
        token: app.owner,
        body: { title: "자동 종료 생명주기 방" },
      })
    ).json()
  ).room;

  // Owner connects WebSocket
  const ownerWs = new WebSocket(
    `${app.base.replace("http", "ws")}/api/socket?room=${room.id}`,
    { headers: { Cookie: app.owner } },
  );
  await once(ownerWs, "open");

  // Guest joins & connects WebSocket
  const joinRes = await app.request(`/rooms/${room.id}/join`, {
    method: "POST",
    body: { nickname: "홍길동", device: "mobile" },
  });
  const guestToken = cookie(joinRes);
  const guestInitial = await joinRes.json();
  assert.ok(
    guestInitial.systemMessages.some((s) =>
      s.text.includes("홍길동 님이 입장하셨습니다."),
    ),
  );

  let guestWs = new WebSocket(
    `${app.base.replace("http", "ws")}/api/socket?room=${room.id}&audience=1`,
    { headers: { Cookie: guestToken } },
  );
  await once(guestWs, "open");

  // Transient disconnect & quick reconnect within disconnectGraceMs -> NO leave message!
  guestWs.close();
  await once(guestWs, "close");
  await wait(20);
  guestWs = new WebSocket(
    `${app.base.replace("http", "ws")}/api/socket?room=${room.id}&audience=1`,
    { headers: { Cookie: guestToken } },
  );
  await once(guestWs, "open");
  await wait(100);

  let snap = await (
    await app.request(`/rooms/${room.id}`, { token: app.owner })
  ).json();
  assert.equal(
    snap.systemMessages.filter((s) => s.kind === "leave").length,
    0,
  );
  assert.equal(snap.room.status, "open");

  // Case A: Owner disconnects while Guest remains -> Room MUST stay OPEN
  ownerWs.close();
  await once(ownerWs, "close");
  await wait(160);
  snap = await (
    await app.request(`/rooms/${room.id}?audience=1`, { token: guestToken })
  ).json();
  assert.equal(snap.room.status, "open");

  // Guest sends a message so history preservation is verified after auto-close
  await app.request(`/rooms/${room.id}/messages?audience=1`, {
    method: "POST",
    token: guestToken,
    body: { text: "마지막까지 남은 메시지", requestId: "keep-history-01" },
  });

  // Case B: Owner reconnects, then Guest explicitly leaves -> Owner still in room -> Room MUST stay OPEN
  const ownerWs2 = new WebSocket(
    `${app.base.replace("http", "ws")}/api/socket?room=${room.id}`,
    { headers: { Cookie: app.owner } },
  );
  await once(ownerWs2, "open");

  guestWs.close();
  await once(guestWs, "close");
  const leaveRes = await app.request(`/rooms/${room.id}/leave`, {
    method: "POST",
    token: guestToken,
  });
  assert.equal(leaveRes.status, 200);
  await wait(160);

  snap = await (
    await app.request(`/rooms/${room.id}`, { token: app.owner })
  ).json();
  assert.equal(snap.room.status, "open");
  assert.ok(
    snap.systemMessages.some((s) =>
      s.text.includes("홍길동 님이 퇴장하셨습니다."),
    ),
  );

  // Case C: Owner now also disconnects -> after disconnectGraceMs + autoCloseGraceMs, Room MUST AUTO-CLOSE!
  ownerWs2.close();
  await once(ownerWs2, "close");
  await wait(240);

  const afterClose = await (
    await app.request(`/rooms/${room.id}`, { token: app.owner })
  ).json();
  assert.equal(afterClose.room.status, "closed");
  assert.equal(afterClose.messages.length, 1);
  assert.equal(afterClose.messages[0].text, "마지막까지 남은 메시지");

  // Re-join attempt on auto-closed room returns 410
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/join`, {
        method: "POST",
        body: { nickname: "뒤늦은손님" },
      })
    ).status,
    410,
  );
});

test("Upgrade 3: @AI chat participation, keyword exclusion, AI settings, and Room Theme separation", async (t) => {
  const app = await setup({
    aiAdapter: async ({ prompt, sender }) => ({
      provider: "mock-ai",
      model: "test-model",
      text: `${sender.nickname}님 질문(${prompt})에 대한 AI 맞춤 답변입니다.`,
    }),
  });
  t.after(() => app.close());

  const room = (
    await (
      await app.request("/rooms", {
        method: "POST",
        token: app.owner,
        body: { title: "AI 브레인스토밍 세션" },
      })
    ).json()
  ).room;

  const joinRes = await app.request(`/rooms/${room.id}/join`, {
    method: "POST",
    body: { nickname: "질문자" },
  });
  const guestToken = cookie(joinRes);

  // Room theme update (50% opacity + gradient)
  const themeRes = await app.request(`/rooms/${room.id}/theme`, {
    method: "PUT",
    token: app.owner,
    body: {
      theme: {
        mode: "gradient",
        gradientId: "ocean-calm",
        panelOpacity: 50,
      },
    },
  });
  assert.equal(themeRes.status, 200);
  const info = await (await app.request(`/rooms/${room.id}/info`)).json();
  assert.equal(info.roomTheme.mode, "gradient");
  assert.equal(info.roomTheme.gradientId, "ocean-calm");
  assert.equal(info.roomTheme.panelOpacity, 50);

  // Send normal message + @AI trigger message
  await app.request(`/rooms/${room.id}/messages?audience=1`, {
    method: "POST",
    token: guestToken,
    body: { text: "클라우드 아키텍처 확장성 논의합시다", requestId: "norm-msg-1" },
  });
  await app.request(`/rooms/${room.id}/messages?audience=1`, {
    method: "POST",
    token: guestToken,
    body: { text: "@AI 핵심 요점을 정리해줘", requestId: "ai-trigger-1" },
  });

  await wait(120);
  const snap = await (
    await app.request(`/rooms/${room.id}`, { token: app.owner })
  ).json();
  const aiMsg = snap.messages.find((m) => m.role === "ai");
  assert.ok(aiMsg, "AI reply message should be appended to room messages");
  assert.match(aiMsg.text, /질문자님 질문\(핵심 요점을 정리해줘\)/);

  // Keywords should include normal audience word ("클라우드") and exclude AI reply words ("맞춤")
  const kw = await (
    await app.request(`/rooms/${room.id}/keywords`, { token: app.owner })
  ).json();
  assert.ok(kw.all.some((k) => k.word === "클라우드"));
  assert.ok(!kw.all.some((k) => k.word === "맞춤"));

  // Owner disables AI -> direct /ai endpoint returns 403
  await app.request(`/rooms/${room.id}/ai-settings`, {
    method: "PUT",
    token: app.owner,
    body: { enabled: false },
  });
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/ai?audience=1`, {
        method: "POST",
        token: guestToken,
        body: { prompt: "다시 질문" },
      })
    ).status,
    403,
  );
});

test("Upgrade 4: Shared Games (Dart, Drawing Lots, Ladder, Tetris Leaderboard)", async (t) => {
  const app = await setup();
  t.after(() => app.close());

  const room = (
    await (
      await app.request("/rooms", {
        method: "POST",
        token: app.owner,
        body: { title: "점심 내기 및 경품 추첨방" },
      })
    ).json()
  ).room;

  const g1 = cookie(
    await app.request(`/rooms/${room.id}/join`, {
      method: "POST",
      body: { nickname: "참가자A" },
    }),
  );
  const g2 = cookie(
    await app.request(`/rooms/${room.id}/join`, {
      method: "POST",
      body: { nickname: "참가자B" },
    }),
  );

  // 1. Shared Dart spin
  await app.request(`/rooms/${room.id}/apps`, {
    method: "POST",
    token: app.owner,
    body: { action: "open", appId: "dart", items: ["쌀국수", "돈까스", "초밥"] },
  });
  const dartSpin = await (
    await app.request(`/rooms/${room.id}/apps`, {
      method: "POST",
      token: app.owner,
      body: { action: "run", appId: "dart" },
    })
  ).json();
  assert.ok(["쌀국수", "돈까스", "초밥"].includes(dartSpin.sharedApp.result.winner));

  // 2. Shared Drawing Lots (multi-participant join + draw)
  await app.request(`/rooms/${room.id}/apps`, {
    method: "POST",
    token: app.owner,
    body: { action: "open", appId: "lots" },
  });
  await app.request(`/rooms/${room.id}/apps?audience=1`, {
    method: "POST",
    token: g1,
    body: { action: "join", appId: "lots" },
  });
  await app.request(`/rooms/${room.id}/apps?audience=1`, {
    method: "POST",
    token: g2,
    body: { action: "join", appId: "lots" },
  });
  await app.request(`/rooms/${room.id}/apps`, {
    method: "POST",
    token: app.owner,
    body: { action: "configure", appId: "lots", labels: ["커피쿠폰"] },
  });
  const lotsDraw = await (
    await app.request(`/rooms/${room.id}/apps`, {
      method: "POST",
      token: app.owner,
      body: { action: "run", appId: "lots" },
    })
  ).json();
  // Owner (host) + g1 + g2 = 3 participants in pool, 1 winner
  assert.equal(lotsDraw.sharedApp.result.length, 3);
  assert.equal(
    lotsDraw.sharedApp.result.filter((a) => a.isWinner).length,
    1,
  );

  // 3. Shared Ladder generation
  await app.request(`/rooms/${room.id}/apps`, {
    method: "POST",
    token: app.owner,
    body: { action: "open", appId: "ladder" },
  });
  await app.request(`/rooms/${room.id}/apps`, {
    method: "POST",
    token: app.owner,
    body: {
      action: "configure",
      appId: "ladder",
      players: ["민수", "지영", "현우"],
      outcomes: ["당첨", "통과", "간식"],
    },
  });
  const ladderRes = await (
    await app.request(`/rooms/${room.id}/apps`, {
      method: "POST",
      token: app.owner,
      body: { action: "run", appId: "ladder" },
    })
  ).json();
  assert.equal(ladderRes.sharedApp.result.paths.length, 3);
  // Bijection check: every column maps to a unique destination column
  const destCols = new Set(
    ladderRes.sharedApp.result.paths.map((m) => m.endCol),
  );
  assert.equal(destCols.size, 3);

  // 4. Tetris room high score
  await app.request(`/rooms/${room.id}/apps`, {
    method: "POST",
    token: app.owner,
    body: { action: "open", appId: "tetris" },
  });
  const scoreRes = await (
    await app.request(`/rooms/${room.id}/apps?audience=1`, {
      method: "POST",
      token: g1,
      body: { action: "score", appId: "tetris", score: 4200 },
    })
  ).json();
  const scoresList = Object.values(scoreRes.sharedApp.scores);
  assert.equal(scoresList[0].score, 4200);
  assert.equal(scoresList[0].nickname, "참가자A");
});

test("Upgrade 5: Real-time Surveys (Single/Multiple/Text), Excel Export, and Confirmed Email Summary", async (t) => {
  let sentEmails = [];
  const app = await setup({
    mailAdapter: async (payload) => {
      sentEmails.push(payload);
      return { id: "mock-mail-001" };
    },
  });
  t.after(() => app.close());

  const room = (
    await (
      await app.request("/rooms", {
        method: "POST",
        token: app.owner,
        body: { title: "제품 피드백 설문 세션" },
      })
    ).json()
  ).room;

  const g1 = cookie(
    await app.request(`/rooms/${room.id}/join`, {
      method: "POST",
      body: { nickname: "설문참여자1" },
    }),
  );
  const g2 = cookie(
    await app.request(`/rooms/${room.id}/join`, {
      method: "POST",
      body: { nickname: "설문참여자2" },
    }),
  );

  // Non-owner cannot create poll
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/polls`, {
        method: "POST",
        token: g1,
        body: {
          title: "불법 설문",
          questions: [{ type: "single", prompt: "질문", options: ["A", "B"] }],
        },
      })
    ).status,
    401,
  );

  // Owner creates multi-type poll
  const createPollRes = await app.request(`/rooms/${room.id}/polls`, {
    method: "POST",
    token: app.owner,
    body: {
      title: "수다온 만족도 조사",
      anonymous: false,
      questions: [
        {
          id: "q1",
          type: "single",
          prompt: "전반적인 만족도는?",
          options: ["매우 만족", "만족", "보통"],
        },
        {
          id: "q2",
          type: "multiple",
          prompt: "가장 좋았던 기능은? (복수 선택)",
          options: ["실시간 채팅", "AI 참여", "미니 게임"],
        },
        {
          id: "q3",
          type: "text",
          prompt: "추가 의견을 남겨주세요",
        },
      ],
    },
  });
  assert.equal(createPollRes.status, 201);
  const poll = await createPollRes.json();

  // Guest 1 votes (and then updates their vote -> totalResponses stays 1!)
  await app.request(`/rooms/${room.id}/polls/${poll.id}/vote?audience=1`, {
    method: "POST",
    token: g1,
    body: { answers: { q1: 1, q2: [0], q3: "초기 의견" } },
  });
  const vote1Updated = await (
    await app.request(`/rooms/${room.id}/polls/${poll.id}/vote?audience=1`, {
      method: "POST",
      token: g1,
      body: { answers: { q1: 0, q2: [0, 1], q3: "매우 빠르고 편리해요!" } },
    })
  ).json();
  assert.equal(vote1Updated.totalResponses, 1);

  // Guest 2 votes
  const vote2 = await (
    await app.request(`/rooms/${room.id}/polls/${poll.id}/vote?audience=1`, {
      method: "POST",
      token: g2,
      body: { answers: { q1: 0, q2: [1, 2], q3: "사다리타기가 재밌어요" } },
    })
  ).json();
  assert.equal(vote2.totalResponses, 2);
  assert.deepEqual(vote2.questions[0].counts, [2, 0, 0]);
  assert.deepEqual(vote2.questions[1].counts, [1, 2, 1]);
  assert.equal(vote2.questions[2].textAnswers.length, 2);

  // Close poll -> subsequent votes rejected (410)
  await app.request(`/rooms/${room.id}/polls/${poll.id}/close`, {
    method: "POST",
    token: app.owner,
  });
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/polls/${poll.id}/vote?audience=1`, {
        method: "POST",
        token: g1,
        body: { answers: { q1: 2 } },
      })
    ).status,
    410,
  );

  // Export poll .xlsx & room .xlsx (verify 5th sheet exists when polls > 0)
  const pollXlsx = await app.request(
    `/rooms/${room.id}/polls/${poll.id}/export`,
    { token: app.owner },
  );
  assert.equal(pollXlsx.status, 200);
  const pollBook = new ExcelJS.Workbook();
  await pollBook.xlsx.load(Buffer.from(await pollXlsx.arrayBuffer()));
  assert.equal(pollBook.worksheets[0].name, "설문 집계");

  const roomXlsx = await app.request(`/rooms/${room.id}/export`, {
    token: app.owner,
  });
  const roomBook = new ExcelJS.Workbook();
  await roomBook.xlsx.load(Buffer.from(await roomXlsx.arrayBuffer()));
  assert.equal(roomBook.worksheets.length, 5);
  assert.equal(roomBook.worksheets[4].name, "설문 결과");

  // Email preview & explicit confirmation enforcement
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/email/preview`, {
        method: "POST",
        token: g1,
        body: { to: "admin@example.com", pollId: poll.id },
      })
    ).status,
    401,
  );

  const previewRes = await app.request(`/rooms/${room.id}/email/preview`, {
    method: "POST",
    token: app.owner,
    body: { to: "presenter@example.com", pollId: poll.id, includeChat: true },
  });
  assert.equal(previewRes.status, 200);
  const preview = await previewRes.json();
  assert.match(preview.subject, /제품 피드백 설문 세션/);
  assert.match(preview.text, /수다온 만족도 조사/);

  // Unconfirmed send MUST fail with 400
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/email/send`, {
        method: "POST",
        token: app.owner,
        body: {
          to: "presenter@example.com",
          pollId: poll.id,
          confirmed: false,
        },
      })
    ).status,
    400,
  );
  assert.equal(sentEmails.length, 0);

  // Confirmed send succeeds!
  const sendRes = await app.request(`/rooms/${room.id}/email/send`, {
    method: "POST",
    token: app.owner,
    body: {
      to: "presenter@example.com",
      pollId: poll.id,
      includeChat: true,
      confirmed: true,
    },
  });
  assert.equal(sendRes.status, 200);
  const sendBody = await sendRes.json();
  assert.equal(sendBody.sent, true);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "presenter@example.com");
});

test("Upgrade 6: Display Launch Token (sudaon:// Windows App bridge) & read-only overlay security", async (t) => {
  const app = await setup();
  t.after(() => app.close());

  const room = (
    await (
      await app.request("/rooms", {
        method: "POST",
        token: app.owner,
        body: { title: "Windows 오버레이 앱 브리지 발표" },
      })
    ).json()
  ).room;

  // Health includes desktop protocol & direct SudaOn-Setup.exe download URL
  const health = await (await app.request("/health")).json();
  assert.equal(health.features.desktopProtocol, "sudaon");
  assert.ok(health.features.desktopDownloadUrl.endsWith("/SudaOn-Setup.exe"));

  // Non-owner cannot mint display token
  assert.equal(
    (await app.request(`/rooms/${room.id}/display-token`, { method: "POST" }))
      .status,
    401,
  );

  // Owner clicks [발표 화면 띄우기] on a brand-new PC -> registers pending-launch & launchId
  const tokenRes = await app.request(`/rooms/${room.id}/display-token`, {
    method: "POST",
    token: app.owner,
    body: {
      launchId: "launch_new_pc_01",
      options: {
        origin: app.base,
        layout: "split",
        opacity: 80,
        font: 22,
        topChat: true,
        topKeywords: true,
      },
    },
  });
  assert.equal(tokenRes.status, 200);
  const { ok, token: dt } = await tokenRes.json();
  assert.equal(ok, true);
  assert.ok(dt.length > 20);

  // Before SudaOn-Setup.exe finishes installing, display-ack is false
  const ackBefore = await (
    await app.request(
      `/rooms/${room.id}/display-ack?launchId=launch_new_pc_01`,
      { token: app.owner },
    )
  ).json();
  assert.equal(ackBefore.connected, false);

  // Freshly installed SudaOn-Setup.exe boots up and retrieves pending-launch automatically (one-time consume)
  const pendingRes = await app.request("/desktop/pending-launch", {
    headers: { "X-Sudaon-Desktop": "1" },
  });
  assert.equal(pendingRes.status, 200);
  const pendingBody = await pendingRes.json();
  assert.equal(pendingBody.launch.roomId, room.id);
  assert.equal(pendingBody.launch.opacity, 80);
  assert.equal(pendingBody.launch.launchId, "launch_new_pc_01");
  assert.equal(pendingBody.launch.dt, dt);

  // Second call is already consumed -> null
  const pendingAgain = await (
    await app.request("/desktop/pending-launch", {
      headers: { "X-Sudaon-Desktop": "1" },
    })
  ).json();
  assert.equal(pendingAgain.launch, null);

  // Separate unauthenticated client (freshly launched Electron overlay) exchanges dt + launchId
  const sessionRes = await app.request(`/rooms/${room.id}/display-session`, {
    method: "POST",
    body: { token: dt, launchId: "launch_new_pc_01" },
  });
  assert.equal(sessionRes.status, 200);
  const displayCookie = cookie(sessionRes);
  assert.ok(displayCookie.startsWith(`sudaon_display_${room.id}=`));

  // Browser tab now sees display-ack connected === true!
  const ackAfter = await (
    await app.request(
      `/rooms/${room.id}/display-ack?launchId=launch_new_pc_01`,
      { token: app.owner },
    )
  ).json();
  assert.equal(ackAfter.connected, true);

  // Read-only room snapshot & keywords succeed via dt query or display cookie without owner cookie
  const snapByQuery = await app.request(
    `/rooms/${room.id}?dt=${encodeURIComponent(dt)}`,
  );
  assert.equal(snapByQuery.status, 200);
  const snapData = await snapByQuery.json();
  assert.equal(snapData.owner, false);
  assert.equal(snapData.room.id, room.id);

  const kwRes = await app.request(`/rooms/${room.id}/keywords`, {
    token: displayCookie,
  });
  assert.equal(kwRes.status, 200);

  // Display WebSocket receives live chat without counting as audience or blocking auto-close
  const displayWs = new WebSocket(
    `${app.base.replace("http", "ws")}/api/socket?room=${room.id}&display=1&dt=${encodeURIComponent(dt)}`,
  );
  await once(displayWs, "open");

  const joinRes = await app.request(`/rooms/${room.id}/join`, {
    method: "POST",
    body: { nickname: "현장청중", device: "mobile" },
  });
  const guestCookie = cookie(joinRes);

  const receivedMessages = [];
  displayWs.on("message", (raw) => {
    const parsed = JSON.parse(String(raw));
    if (parsed.type === "event" && parsed.data?.type === "message") {
      receivedMessages.push(parsed.data.data);
    }
  });

  const msgRes = await app.request(`/rooms/${room.id}/messages?audience=1`, {
    method: "POST",
    token: guestCookie,
    body: { text: "슬라이드 위에 바로 뜨나요?", requestId: "overlay-live-01" },
  });
  assert.equal(msgRes.status, 201);
  const savedMsg = await msgRes.json();
  await wait(80);
  assert.ok(receivedMessages.some((m) => m.id === savedMsg.id));

  // Display token is strictly read-only: CANNOT post messages, delete messages, or close room
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/messages`, {
        method: "POST",
        token: displayCookie,
        body: { text: "표시창에서 쓰기 시도", requestId: "forbid-write-01" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/messages/${savedMsg.id}`, {
        method: "DELETE",
        token: displayCookie,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await app.request(`/rooms/${room.id}/close`, {
        method: "POST",
        token: displayCookie,
      })
    ).status,
    401,
  );

  // Leaving audience while ONLY displayWs stays open -> displayWs must NOT block auto-room-close!
  await app.request(`/rooms/${room.id}/leave`, {
    method: "POST",
    token: guestCookie,
  });
  await wait(240);
  const afterLeave = await (
    await app.request(`/rooms/${room.id}`, { token: app.owner })
  ).json();
  assert.equal(afterLeave.room.status, "closed");

  displayWs.close();
});

test("Upgrade 7: KakaoTalk unread count (10 -> 9 -> 6 -> 0), Online/Away presence badges, and explicit-only Leave messages", async (t) => {
  const app = await setup({
    disconnectGraceMs: 60,
    autoCloseGraceMs: 90,
  });
  t.after(() => app.close());

  const room = (
    await (
      await app.request("/rooms", {
        method: "POST",
        token: app.owner,
        body: { title: "카카오톡 읽음 수 & 자리비움 검증방" },
      })
    ).json()
  ).room;

  // Join 10 participants
  const guests = [];
  for (let i = 1; i <= 10; i++) {
    const res = await app.request(`/rooms/${room.id}/join`, {
      method: "POST",
      body: { nickname: `참여자${i}`, device: i <= 5 ? "mobile" : "pc" },
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    guests.push({ index: i, id: data.me, token: cookie(res) });
  }

  const computeUnread = (snap, msg) =>
    snap.onlineParticipants.filter(
      (u) =>
        u.id !== msg.participantId &&
        (snap.readCursors[u.id] ?? u.readSeq ?? 0) < msg.seq,
    ).length;

  // 1) Guest 1 sends a message -> 10 members total, 1 read (sender) -> unread MUST be 9!
  const msgRes = await app.request(`/rooms/${room.id}/messages?audience=1`, {
    method: "POST",
    token: guests[0].token,
    body: { text: "안녕하세요 10명 카톡 읽음 테스트!", requestId: "kakao-read-01" },
  });
  assert.equal(msgRes.status, 201);
  const msg = await msgRes.json();

  let snap = await (
    await app.request(`/rooms/${room.id}?audience=1`, {
      token: guests[0].token,
    })
  ).json();
  assert.equal(snap.onlineTotal, 10);
  assert.equal(snap.activeOnlineCount, 10);
  assert.equal(snap.awayCount, 0);
  assert.equal(computeUnread(snap, msg), 9);

  // 2) 3 more guests (g2, g3, g4) read the message -> 4 total read -> unread MUST be 6!
  for (const g of [guests[1], guests[2], guests[3]]) {
    const pRes = await app.request(`/rooms/${room.id}/presence?audience=1`, {
      method: "POST",
      token: g.token,
      body: { status: "online", readSeq: msg.seq },
    });
    assert.equal(pRes.status, 200);
  }
  snap = await (
    await app.request(`/rooms/${room.id}?audience=1`, {
      token: guests[0].token,
    })
  ).json();
  assert.equal(computeUnread(snap, msg), 6);

  // 3) Remaining 6 guests read -> all 10 read -> unread MUST be 0!
  for (const g of guests.slice(4)) {
    await app.request(`/rooms/${room.id}/presence?audience=1`, {
      method: "POST",
      token: g.token,
      body: { status: "online", readSeq: msg.seq },
    });
  }
  snap = await (
    await app.request(`/rooms/${room.id}?audience=1`, {
      token: guests[0].token,
    })
  ).json();
  assert.equal(computeUnread(snap, msg), 0);

  // 4) Mobile Guest 2 connects WS, then turns screen off (away + WS closes WITHOUT /leave)
  let g2Ws = new WebSocket(
    `${app.base.replace("http", "ws")}/api/socket?room=${room.id}&audience=1`,
    { headers: { Cookie: guests[1].token } },
  );
  await once(g2Ws, "open");

  await app.request(`/rooms/${room.id}/presence?audience=1`, {
    method: "POST",
    token: guests[1].token,
    body: { status: "away" },
  });
  g2Ws.close();
  await once(g2Ws, "close");
  await wait(140); // Wait past disconnectGraceMs

  snap = await (
    await app.request(`/rooms/${room.id}?audience=1`, {
      token: guests[0].token,
    })
  ).json();
  // MUST NOT emit "퇴장하셨습니다." and room stays open with Guest 2 marked "away" ("자리비움")
  assert.equal(
    snap.systemMessages.filter((s) => s.kind === "leave").length,
    0,
  );
  assert.equal(snap.room.status, "open");
  assert.equal(snap.onlineTotal, 10);
  const g2InfoAway = snap.onlineParticipants.find((u) => u.id === guests[1].id);
  assert.equal(g2InfoAway?.status, "away");
  assert.equal(snap.awayCount, 1);
  assert.equal(snap.activeOnlineCount, 9);

  // 5) Mobile Guest 2 turns screen back ON (reconnects WS + join check + online presence) -> NO duplicate "입장하셨습니다."!
  const joinCountBefore = snap.systemMessages.filter(
    (s) => s.kind === "join",
  ).length;
  assert.equal(joinCountBefore, 10);

  g2Ws = new WebSocket(
    `${app.base.replace("http", "ws")}/api/socket?room=${room.id}&audience=1`,
    { headers: { Cookie: guests[1].token } },
  );
  await once(g2Ws, "open");
  await app.request(`/rooms/${room.id}/join`, {
    method: "POST",
    token: guests[1].token,
    body: { nickname: "참여자2", device: "mobile" },
  });
  await wait(60);

  snap = await (
    await app.request(`/rooms/${room.id}?audience=1`, {
      token: guests[0].token,
    })
  ).json();
  assert.equal(
    snap.systemMessages.filter((s) => s.kind === "join").length,
    10,
  );
  const g2InfoBack = snap.onlineParticipants.find((u) => u.id === guests[1].id);
  assert.equal(g2InfoBack?.status, "online");
  assert.equal(snap.awayCount, 0);

  // 6) Explicit 나가기 button (/leave) -> emits "퇴장하셨습니다." and reduces room member count to 9
  g2Ws.close();
  await once(g2Ws, "close");
  const leaveRes = await app.request(`/rooms/${room.id}/leave`, {
    method: "POST",
    token: guests[1].token,
  });
  assert.equal(leaveRes.status, 200);

  snap = await (
    await app.request(`/rooms/${room.id}?audience=1`, {
      token: guests[0].token,
    })
  ).json();
  assert.equal(snap.onlineTotal, 9);
  assert.equal(
    snap.systemMessages.filter((s) => s.kind === "leave").length,
    1,
  );
  assert.ok(
    snap.systemMessages.some((s) =>
      s.text.includes("참여자2 님이 퇴장하셨습니다."),
    ),
  );
});

test("Upgrade 8: Chat room activity ranking from most active (#1) down to least active (0 messages)", async (t) => {
  const app = await setup({
    messageInterval: 0,
    aiAdapter: async () => ({
      provider: "mock-ai",
      model: "test-model",
      text: "AI 자동 응답입니다.",
    }),
  });
  t.after(() => app.close());

  const room = (
    await (
      await app.request("/rooms", {
        method: "POST",
        token: app.owner,
        body: { title: "채팅방 활성화 순위 검증" },
      })
    ).json()
  ).room;

  const joinGuest = async (nickname, device = "mobile") => {
    const res = await app.request(`/rooms/${room.id}/join`, {
      method: "POST",
      body: { nickname, device },
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    return { id: body.me, nickname, token: cookie(res) };
  };

  const gTop = await joinGuest("다변가", "pc");
  const gMid = await joinGuest("중간러", "mobile");
  const gLow = await joinGuest("한마디", "mobile");
  const gZero = await joinGuest("경청러", "tablet");

  const sendMsg = async (guest, text, idx) => {
    const res = await app.request(`/rooms/${room.id}/messages?audience=1`, {
      method: "POST",
      token: guest.token,
      body: { text, requestId: `act-${guest.id}-${idx}` },
    });
    assert.equal(res.status, 201);
    return res.json();
  };

  // gTop sends 3 valid messages + 1 message that gets deleted (should count as 3)
  await sendMsg(gTop, "첫 번째 의견입니다!", 1);
  await sendMsg(gTop, "두 번째 의견입니다!", 2);
  await sendMsg(gTop, "@AI 요약 부탁해", 3);
  const toDelete = await sendMsg(gTop, "삭제될 메시지", 4);
  await app.request(`/rooms/${room.id}/messages/${toDelete.id}`, {
    method: "DELETE",
    token: app.owner,
  });

  // gMid sends 2 messages
  await sendMsg(gMid, "공감합니다!", 1);
  await sendMsg(gMid, "추가 질문 있습니다.", 2);

  // gLow sends 1 message; gZero sends 0 messages
  await sendMsg(gLow, "안녕하세요!", 1);

  await wait(80);

  const kwRes = await app.request(`/rooms/${room.id}/keywords`, {
    token: app.owner,
  });
  assert.equal(kwRes.status, 200);
  const kw = await kwRes.json();

  assert.equal(kw.activityAll.length, 4);
  assert.deepEqual(
    kw.activityAll.map((u) => ({
      nickname: u.nickname,
      rank: u.rank,
      count: u.count,
      ratio: u.ratio,
    })),
    [
      { nickname: "다변가", rank: 1, count: 3, ratio: 100 },
      { nickname: "중간러", rank: 2, count: 2, ratio: 67 },
      { nickname: "한마디", rank: 3, count: 1, ratio: 33 },
      { nickname: "경청러", rank: 4, count: 0, ratio: 0 },
    ],
  );
  // AI bot must never appear in human chat activity ranking
  assert.ok(!kw.activityAll.some((u) => u.id === "ai" || u.role === "ai"));
  assert.equal(kw.activityAll[3].id, gZero.id);
});
