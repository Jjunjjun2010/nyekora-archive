(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var infoPanel = document.getElementById("info-panel");
  var infoTitle = document.getElementById("info-title");
  var infoDesc = document.getElementById("info-desc");
  var infoClose = document.getElementById("info-close");

  // NPC 관련 요소
  var ruwata = document.getElementById("ruwata");
  var npcDetails = document.getElementById("npc-details");
  var npcActions = document.getElementById("npc-actions");
  var npcMeaning = document.getElementById("npc-meaning");
  var npcJob = document.getElementById("npc-job");
  var npcPersonality = document.getElementById("npc-personality");
  var npcKnowledge = document.getElementById("npc-knowledge");
  var npcMemory = document.getElementById("npc-memory");
  var npcCurrentStatus = document.getElementById("npc-current-status");

  // 시간 HUD 관련 요소
  var villageTimeEl = document.getElementById("village-time");
  var villagePeriodEl = document.getElementById("village-period");
  var ruwataStatusEl = document.getElementById("ruwata-status");
  var timeToggle = document.getElementById("time-toggle");
  var behaviorToggle = document.getElementById("behavior-toggle");

  // 지도의 기준 해상도
  var STAGE_W = 1280;
  var STAGE_H = 800;

  /*
    이동 목적지 좌표.
    현재 시제품 배치에 맞춘 임시 좌표이며,
    광장/작업장의 공식 방향이나 세계관 설정을 확정하는 값은 아니다.
  */
  var destinations = {
    kalawa: {
      x: 611,
      y: 526,
      label: "kalawa 광장"
    },
    workshop: {
      x: 930,
      y: 510,
      label: "악기 작업장"
    }
  };

  /*
    나중에 NPC마다 일정을 바꾸기 쉽도록,
    Ruwata의 하루 일과를 데이터 객체로 분리한다.

    start/end는 게임 내부 시각의 '분' 단위다.
    예: 6 * 60 = 06:00
  */
var npcSchedules = {
  ruwata: [
    {
      id: "early_morning_warmup",
      period: "아침",
      start: 6 * 60,
      end: 9 * 60,
      destination: "workshop",
      status: "악기 제작을 준비 중",
      description: "Ruwata는 작업 도구를 정리하고 오늘 사용할 나무를 고르고 있습니다."
    },
    {
      id: "day_deep_work",
      period: "낮",
      start: 9 * 60,
      end: 15 * 60,
      destination: "workshop",
      status: "악기 제작 중",
      description: "Ruwata는 수랄라와 수타리의 음색을 세심하게 다듬고 있습니다."
    },
    {
      id: "afternoon_social",
      period: "낮",
      start: 15 * 60,
      end: 18 * 60,
      destination: "kalawa",
      status: "광장에서 주민들과 교류 중",
      description: "Ruwata는 kalawa 광장에서 악기 소리를 들려 주고 주민들과 이야기를 나눕니다."
    },
    {
      id: "evening_cleanup",
      period: "저녁",
      start: 18 * 60,
      end: 20 * 60,
      destination: "workshop",
      status: "작업장 정리 중",
      description: "Ruwata는 하루 동안 사용한 도구를 정리하고 나무를 정돈하고 있습니다."
    },
    {
      id: "night_rest",
      period: "밤",
      start: 20 * 60,
      end: 24 * 60,
      destination: "workshop",
      status: "휴식 중",
      description: "Ruwata는 작업장을 닫고 조용히 휴식하고 있습니다."
    },
    {
      id: "late_night_rest",
      period: "밤",
      start: 0,
      end: 6 * 60,
      destination: "workshop",
      status: "휴식 중",
      description: "Ruwata는 새벽이 오기 전까지 깊이 잠들어 있습니다."
    }
  ]
};

  var moveTimer = null;

  // 게임 내부 시간: 06:00부터 시작
  var gameMinutes = 6 * 60;

  /*
    시간 흐름 속도.
    1초마다 게임 시간 10분이 흐른다.
    필요하면 나중에 이 값만 바꾸면 된다.
  */
  var minutesPerTick = 10;
  var tickMs = 1000;

  var timeInterval = null;
  var isTimePaused = false;

  /*
    자동 행동이 켜져 있으면 시간대에 따라 Ruwata가 자동 이동한다.
    꺼져 있으면 수동 이동 버튼만 작동한다.
  */
  var isAutoBehaviorOn = true;

  // 같은 시간대에 반복 이동하지 않도록 마지막 적용 일정 id를 기억한다.
  var lastAppliedScheduleId = null;

  // 현재 Ruwata 상태
  var ruwataState = {
    status: "악기 제작 중",
    scheduleId: "morning_work",
    destination: "workshop",
    mode: "auto"
  };

  // 창 크기에 맞춰 지도를 비율 유지한 채 축소/확대한다.
  function fitStage() {
    var scale = Math.min(
      window.innerWidth / STAGE_W,
      window.innerHeight / STAGE_H
    );

    scale = Math.min(scale, 1.15);
    stage.style.transform = "scale(" + scale + ")";
  }

  window.addEventListener("resize", fitStage);
  fitStage();

  // 야자수 장식: 기존 배치를 유지한다.
  var treeSpots = [
    { x: 40, y: 40 },
    { x: 110, y: 90 },
    { x: 60, y: 600 },
    { x: 1180, y: 60 },
    { x: 1120, y: 120 },
    { x: 1190, y: 600 },
    { x: 420, y: 560 },
    { x: 760, y: 560 },
    { x: 180, y: 300 },
    { x: 1020, y: 300 },
    { x: 40, y: 720 },
    { x: 1180, y: 720 }
  ];

  treeSpots.forEach(function (spot) {
    var tree = document.createElement("div");

    tree.className = "tree";
    tree.style.setProperty("--x", spot.x + "px");
    tree.style.setProperty("--y", spot.y + "px");

    stage.appendChild(tree);
  });

  /*
    기존 건물·광장 클릭 기능.
    NPC 전용 정보는 숨기고, 장소 설명만 표시한다.
  */
  var clickable = document.querySelectorAll(".building, .plaza");

  clickable.forEach(function (el) {
    var label = document.createElement("span");

    label.className = "label";
    label.textContent = el.dataset.name || "";
    el.appendChild(label);

    el.addEventListener("click", function () {
      showPlaceInfo(el.dataset.name, el.dataset.desc);
    });
  });

  function showPlaceInfo(name, desc) {
    infoTitle.textContent = name || "";
    infoDesc.textContent = desc || "";

    npcDetails.classList.add("hidden");
    npcActions.classList.add("hidden");

    infoPanel.classList.remove("hidden");
  }

  function showRuwataInfo() {
    infoTitle.textContent = ruwata.dataset.name || "Ruwata";
    infoDesc.textContent = getRuwataInfoDescription();

    npcMeaning.textContent = ruwata.dataset.nameMeaning || "";
    npcJob.textContent = ruwata.dataset.job || "";
    npcPersonality.textContent = ruwata.dataset.personality || "";
    npcKnowledge.textContent = ruwata.dataset.knowledge || "";
    npcMemory.textContent = ruwata.dataset.memory || "";

    if (npcCurrentStatus) {
      npcCurrentStatus.textContent = ruwataState.status;
    }

    npcDetails.classList.remove("hidden");
    npcActions.classList.remove("hidden");
    infoPanel.classList.remove("hidden");
  }

  function getRuwataInfoDescription() {
    var modeText = isAutoBehaviorOn ? "자동 일과 진행 중" : "수동 이동 모드";

    return (
      (ruwata.dataset.job || "전통 악기 제작자") +
      " · " +
      modeText +
      " · 현재 상태: " +
      ruwataState.status
    );
  }

  ruwata.addEventListener("click", function () {
    showRuwataInfo();
  });

  /*
    지정한 장소로 Ruwata를 이동시킨다.
    source는 "auto" 또는 "manual"이다.
  */
  function moveRuwata(destinationName, source, statusText) {
    var destination = destinations[destinationName];

    if (!destination) {
      return;
    }

    if (moveTimer !== null) {
      window.clearTimeout(moveTimer);
    }

    ruwata.classList.add("is-moving");
    ruwata.style.left = destination.x + "px";
    ruwata.style.top = destination.y + "px";

    if (statusText) {
      setRuwataStatus(statusText);
    } else {
      setRuwataStatus(destination.label + "으로 이동 중");
    }

    ruwataState.destination = destinationName;
    ruwataState.mode = source || "manual";

    /*
      이동 중에도 캐릭터 버튼은 계속 클릭 가능하다.
      CSS transition으로 위치만 바뀌므로 click 이벤트는 유지된다.
    */
    moveTimer = window.setTimeout(function () {
      ruwata.classList.remove("is-moving");

      // 자동 행동 중이라면 일정 상태를 유지하고,
      // 수동 이동이라면 도착 상태를 알려 준다.
      if (source === "auto") {
        var currentSchedule = getCurrentSchedule();
        if (currentSchedule) {
          setRuwataStatus(currentSchedule.status);
        }
      } else {
        setRuwataStatus(destination.label + "에 도착함");
      }

      moveTimer = null;
    }, 1800);
  }

  function setRuwataStatus(statusText) {
    ruwataState.status = statusText;

    if (ruwataStatusEl) {
      ruwataStatusEl.textContent = statusText;
    }

    if (npcCurrentStatus) {
      npcCurrentStatus.textContent = statusText;
    }

    // Ruwata 정보 패널이 열려 있다면 설명도 현재 상태에 맞게 갱신한다.
    if (!infoPanel.classList.contains("hidden") && !npcDetails.classList.contains("hidden")) {
      infoDesc.textContent = getRuwataInfoDescription();
    }
  }

  /*
    수동 이동 버튼.
    기존 수동 이동 기능은 보존한다.
    단, 사용자가 버튼을 누르면 자동 행동을 끄고 수동 모드로 전환한다.
  */
  npcActions.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-destination]");

    if (!button) {
      return;
    }

    setAutoBehavior(false);
    moveRuwata(button.dataset.destination, "manual");
  });

  infoClose.addEventListener("click", function () {
    infoPanel.classList.add("hidden");
  });

  /*
    =========================
    마을 시간 시스템
    =========================
  */

  function startClock() {
    updateTimeDisplay();
    applyScheduleIfNeeded();

    timeInterval = window.setInterval(function () {
      if (isTimePaused) {
        return;
      }

      gameMinutes += minutesPerTick;

      if (gameMinutes >= 24 * 60) {
        gameMinutes = gameMinutes % (24 * 60);
      }

      updateTimeDisplay();

      if (isAutoBehaviorOn) {
        applyScheduleIfNeeded();
      }
    }, tickMs);
  }

  function updateTimeDisplay() {
    var hours = Math.floor(gameMinutes / 60);
    var minutes = gameMinutes % 60;

    var timeText =
      pad2(hours) +
      ":" +
      pad2(minutes);

    var schedule = getCurrentSchedule();

    if (villageTimeEl) {
      villageTimeEl.textContent = timeText;
    }

    if (villagePeriodEl && schedule) {
      villagePeriodEl.textContent = schedule.period;
    }
  }

  function pad2(number) {
    return String(number).padStart(2, "0");
  }

  function getCurrentSchedule() {
    var list = npcSchedules.ruwata;

    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];

      if (gameMinutes >= item.start && gameMinutes < item.end) {
        return item;
      }
    }

    return list[0];
  }

  function applyScheduleIfNeeded() {
    var schedule = getCurrentSchedule();

    if (!schedule) {
      return;
    }

    // 같은 일정이 계속 반복 적용되지 않도록 한다.
    if (schedule.id === lastAppliedScheduleId) {
      return;
    }

    lastAppliedScheduleId = schedule.id;

    ruwataState.scheduleId = schedule.id;
    ruwataState.destination = schedule.destination;
    ruwataState.mode = "auto";

    moveRuwata(schedule.destination, "auto", schedule.status);

    // 패널이 열려 있을 때 상태 설명을 최신화한다.
    if (!infoPanel.classList.contains("hidden") && !npcDetails.classList.contains("hidden")) {
      infoDesc.textContent = schedule.description;
    }
  }

  function setAutoBehavior(isOn) {
    isAutoBehaviorOn = isOn;

    if (behaviorToggle) {
      behaviorToggle.textContent = isAutoBehaviorOn
        ? "자동 행동: 켜짐"
        : "자동 행동: 꺼짐";
    }

    if (isAutoBehaviorOn) {
      /*
        수동 모드에서 자동 모드로 돌아올 때,
        현재 시간대의 일정을 즉시 다시 적용할 수 있도록 초기화한다.
      */
      lastAppliedScheduleId = null;
      applyScheduleIfNeeded();
    }
  }

  if (timeToggle) {
    timeToggle.addEventListener("click", function () {
      isTimePaused = !isTimePaused;

      timeToggle.textContent = isTimePaused
        ? "시간 재개"
        : "시간 일시정지";
    });
  }

  if (behaviorToggle) {
    behaviorToggle.addEventListener("click", function () {
      setAutoBehavior(!isAutoBehaviorOn);
    });
  }

  // 초기 상태 반영
  setRuwataStatus("악기 제작 중");
  updateTimeDisplay();
  startClock();

  /*
    대화 시스템(아래 별도 IIFE)에서 현재 마을 상태를 읽을 수 있도록
    읽기 전용 스냅샷을 노출한다.
  */
  window.ruwataVillageState = {
    getSnapshot: function () {
      var schedule = getCurrentSchedule();
      var hours = Math.floor(gameMinutes / 60);
      var minutes = gameMinutes % 60;

      return {
        time: pad2(hours) + ":" + pad2(minutes),
        period: schedule ? schedule.period : "",
        status: ruwataState.status,
        activity: schedule ? schedule.description : ""
      };
    }
  };
})();

/* =========================================================
   Ruwata 대화 시스템
   CHAT_API_URL이 설정되어 있으면 Supabase Edge Function을 통해
   Ollama Cloud AI 응답을 받고, 비어 있으면 테스트용 고정 응답으로 동작한다.
   실제 AI 키는 Edge Function 시크릿에만 보관되며 이 파일에는 없다.
   ========================================================= */
(function () {
  "use strict";

  var npcData = {
    ruwata: {
      id: "ruwata",
      name: "Ruwata",
      displayName: "Ruwata (루와타)",
      job: "전통 악기 제작자",
      personality: "신중하고 호기심이 많음",
      knowledge: ["수랄라(Surala)", "수타리(Sutari)"],
      longTermMemory: [],
      conversation: []
    }
  };

  var ruwataData = npcData.ruwata;

  // 대화 영구 저장(localStorage)과 기록관 자료 검색 모듈.
  // 스크립트를 불러오지 못해도 아래 코드는 기존처럼 메모리 대화로 동작한다.
  var CHAT_STORAGE_KEY = "nyekora-village:chat:v1:ruwata";
  var NPC_ID = "ruwata";
  var chatStore = window.NyekoraChatStore || null;
  var loreLookup = window.NyekoraLore || null;
  var isSending = false;

  /*
    대화 백엔드(Supabase Edge Function 경유 Ollama Cloud).
    빈 문자열로 두면 예전처럼 테스트용 고정 응답으로 동작한다.
  */
  var CHAT_API_URL = "https://yzytuvsjsbmyxsybixru.supabase.co/functions/v1/chat";
  var ruwataElement = document.getElementById("ruwata");
  var speechBubble = document.getElementById("ruwata-speech-bubble");
  var chat = document.getElementById("ruwata-chat");
  var chatClose = document.getElementById("ruwata-chat-close");
  var chatMessages = document.getElementById("ruwata-chat-messages");
  var chatForm = document.getElementById("ruwata-chat-form");
  var chatInput = document.getElementById("ruwata-chat-input");
  var chatNote = document.querySelector(".ruwata-chat-note");
  var CHAT_NOTE_DEFAULT = "대화는 이 브라우저에 저장됩니다. AI(Ollama Cloud)가 생성한 응답은 사실과 다를 수 있습니다.";

  if (!ruwataElement || !speechBubble || !chat || !chatClose || !chatMessages || !chatForm || !chatInput) {
    console.warn("Ruwata 대화 UI 요소를 찾을 수 없습니다.");
    return;
  }

  // 페이지를 새로 열어도 이전 대화를 복원한다.
  if (chatStore) {
    var restored = chatStore.load(CHAT_STORAGE_KEY);
    if (restored.messages.length) {
      ruwataData.conversation = restored.messages;
    }
    if (!restored.ok && chatNote) {
      chatNote.textContent = "저장된 대화를 읽지 못했습니다. 원문은 브라우저의 :corrupt 백업에 보존했습니다.";
    }
  }

  ruwataElement.addEventListener("click", openChat);
  chatClose.addEventListener("click", closeChat);
  chatForm.addEventListener("submit", function (event) {
    event.preventDefault();
    sendMessage();
  });

  // 같은 브라우저의 다른 탭에서 대화가 바뀌면 현재 화면도 맞춘다.
  if (chatStore) {
    window.addEventListener("storage", function (event) {
      if (event.key !== CHAT_STORAGE_KEY) return;
      var reloaded = chatStore.load(CHAT_STORAGE_KEY);
      ruwataData.conversation = reloaded.messages;
      renderConversation();
    });
  }

  function openChat() {
    chat.classList.remove("hidden");
    ruwataElement.classList.add("chat-open");
    speechBubble.setAttribute("aria-hidden", "false");

    if (ruwataData.conversation.length === 0) {
      addGreetingMessage();
    } else {
      renderConversation();
    }
    window.setTimeout(function () { chatInput.focus(); }, 0);
  }

  function closeChat() {
    chat.classList.add("hidden");
    ruwataElement.classList.remove("chat-open");
    speechBubble.setAttribute("aria-hidden", "true");
  }

  function renderConversation() {
    chatMessages.innerHTML = "";
    ruwataData.conversation.forEach(function (message) {
      renderMessage(message);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function getVillageStateSnapshot() {
    try {
      if (window.ruwataVillageState && window.ruwataVillageState.getSnapshot) {
        return window.ruwataVillageState.getSnapshot();
      }
    } catch (err) {
      console.warn("마을 상태를 읽지 못했습니다.", err);
    }
    return null;
  }

  // 질문과 관련된 기록관 항목만 고른다. (Rejected·reference-not-lore 제외)
  function selectLore(userText) {
    if (!loreLookup || !loreLookup.getRelevant) {
      return { items: [], payload: [], brief: "", refs: [] };
    }
    try {
      return loreLookup.getRelevant(userText, { limit: 6, briefLimit: 3, refLimit: 3 });
    } catch (error) {
      console.warn("기록관 자료를 찾지 못했습니다.", error);
      return { items: [], payload: [], brief: "", refs: [] };
    }
  }

  // "이어서", "계속", "마저" 같은 짧은 요청이 오면 직전 NPC 답변의 맥락을 덧붙여
  // 자연스럽게 이어지도록 한다. 직전 답변 전체가 아닌 마지막 120자만 인용해
  // 중복 전송을 막는다.
  function maybeRewriteContinuation(lastUserContent, history) {
    var text = lastUserContent.trim();
    if (!isContinuationRequest(text)) return text;

    var lastAssistant = "";
    for (var i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].role === "assistant") {
        lastAssistant = history[i].content;
        break;
      }
    }
    if (!lastAssistant) return text;

    var snippet = lastAssistant.slice(-120).trim();
    if (text.length <= 20) {
      return "방금 말씀하신 \"" + snippet + "\" 부분을 이어서 설명해 주세요.";
    }
    return text + "\n\n(직전 답변 맥락: ...\"" + snippet + "\")";
  }

  function isContinuationRequest(text) {
    var normalized = text.toLowerCase().replace(/[\s\.\?\!]+/g, "");
    var patterns = [
      "이어서", "계속", "마저", "뒷이야기", "나머지", "더말해",
      "이어서말해", "계속해", "마저말해", "덧붙여", "덧붙혀"
    ];
    for (var i = 0; i < patterns.length; i += 1) {
      if (normalized.indexOf(patterns[i]) !== -1) return true;
    }
    return false;
  }

  // Supabase Edge Function을 통해 Ollama Cloud에 대화를 요청한다.
  function requestRuwataReply(loreResult) {
    var history = ruwataData.conversation.slice(-16).map(function (message) {
      return {
        role: message.role === "assistant" || message.speaker === "npc" ? "assistant" : "user",
        content: String(message.text || message.content || "").slice(0, 1000)
      };
    });

    if (history.length) {
      var last = history[history.length - 1];
      if (last.role === "user") {
        last.content = maybeRewriteContinuation(last.content, history);

        if (loreResult && loreResult.brief) {
          var room = 980 - last.content.length;
          var brief = loreResult.brief;
          if (room > 40) {
            if (brief.length > room) {
              brief = brief.slice(0, room - 24) + "\n[[/NYEKORA_LORE_BRIEF]]";
            }
            last.content = last.content + "\n\n" + brief;
          }
        }
      }
    }

    var body = { messages: history, state: getVillageStateSnapshot() };
    if (loreResult && loreResult.payload && loreResult.payload.length) {
      body.lore = loreResult.payload;
    }

    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () { controller.abort(); }, 30000);

    return fetch(CHAT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    }).then(function (response) {
      window.clearTimeout(timeoutId);
      if (!response.ok) {
        return response.json().catch(function () {
          return { error: "채팅 서버 오류 (" + response.status + ")", type: "server_error" };
        }).then(function (errData) {
          var err = new Error(errData.error || "채팅 서버 오류 (" + response.status + ")");
          err.status = response.status;
          err.type = errData.type || "server_error";
          err.retryAfter = parseInt(response.headers.get("x-retry-after") || "0", 10) || 60;
          throw err;
        });
      }
      return response.json();
    }, function (networkErr) {
      window.clearTimeout(timeoutId);
      throw networkErr;
    }).then(function (data) {
      var reply = data && typeof data.reply === "string" ? data.reply.trim() : "";
      if (!reply) {
        throw new Error("빈 응답을 받았습니다.");
      }
      return reply;
    });
  }

  function sendMessage() {
    if (isSending) return;

    var text = chatInput.value.trim();
    if (!text) return;

    isSending = true;
    addUserMessage(text);
    chatInput.value = "";
    setSpeechBubble("...");
    setChatDisabled(true);

    var loreResult = selectLore(text);

    // CHAT_API_URL이 비어 있으면 예전처럼 테스트 응답으로 동작한다.
    if (!CHAT_API_URL) {
      window.setTimeout(function () {
        var testResponse = createTestResponse(text, loreResult); // TEST RESPONSE ONLY
        addNpcMessage(testResponse, loreResult.refs);
        finishSending();
      }, 650);
      return;
    }

    requestRuwataReply(loreResult).then(function (reply) {
      addNpcMessage(reply, loreResult.refs);
    }).catch(function (err) {
      console.error("Ruwata AI 응답 실패:", err);
      handleReplyError(err);
    }).finally(function () {
      finishSending();
    });
  }

  function handleReplyError(err) {
    var type = err && err.type ? err.type : "";
    var retryAfter = err && err.retryAfter ? err.retryAfter : 0;
    var status = err && err.status ? err.status : 0;

    if (type === "rate_limit" || type === "upstream_rate_limit" || status === 429) {
      var seconds = retryAfter > 0 ? retryAfter : 60;
      addErrorMessage("요청이 너무 많습니다. " + seconds + "초 뒤에 다시 말을 걸어 주세요.");
      setCooldown(seconds);
      return;
    }

    addErrorMessage("...죄송해요, 지금은 대답하기가 어렵네요. 잠시 뒤에 다시 말을 걸어 주세요.");
  }

  var cooldownTimer = null;

  function setCooldown(seconds) {
    if (cooldownTimer !== null) {
      window.clearTimeout(cooldownTimer);
    }
    setChatDisabled(true);
    var remain = seconds;
    chatForm.querySelector("button").textContent = remain + "초 뒤 전송";

    function tick() {
      remain -= 1;
      if (remain > 0) {
        chatForm.querySelector("button").textContent = remain + "초 뒤 전송";
        cooldownTimer = window.setTimeout(tick, 1000);
      } else {
        finishCooldown();
      }
    }
    cooldownTimer = window.setTimeout(tick, 1000);
  }

  function finishCooldown() {
    cooldownTimer = null;
    setChatDisabled(false);
    chatForm.querySelector("button").textContent = "전송";
    chatInput.focus();
  }

  function finishSending() {
    if (cooldownTimer !== null) return;
    isSending = false;
    setSpeechBubble("...");
    setChatDisabled(false);
    chatInput.focus();
  }

  function addErrorMessage(text) {
    var row = document.createElement("div");
    var content = document.createElement("div");
    var bubble = document.createElement("div");

    row.className = "ruwata-chat-message error";
    content.className = "ruwata-chat-content";
    bubble.className = "ruwata-chat-bubble error";
    bubble.textContent = text;

    content.appendChild(bubble);
    row.appendChild(content);
    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addGreetingMessage() {
    var greeting = {
      id: "ruwata-greeting-v1",
      speaker: "npc",
      role: "assistant",
      name: ruwataData.displayName,
      text: "안녕하세요. 저는 Ruwata입니다. 오늘도 악기를 다듬고 있어요.",
      createdAt: new Date().toISOString(),
      refs: []
    };
    appendToConversation(greeting);
  }

  function addUserMessage(text) {
    appendToConversation(makeChatMessage("user", text, []));
  }

  function addNpcMessage(text, refs) {
    appendToConversation(makeChatMessage("npc", text, refs || []));
  }

  function makeChatMessage(speaker, text, refs) {
    var name = speaker === "npc" ? ruwataData.displayName : "사용자";
    if (chatStore && chatStore.makeMessage) {
      return chatStore.makeMessage(speaker, text, refs, name);
    }
    return {
      id: "m-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      speaker: speaker,
      role: speaker === "npc" ? "assistant" : "user",
      name: name,
      text: text,
      createdAt: new Date().toISOString(),
      refs: refs || []
    };
  }

  function appendToConversation(message) {
    ruwataData.conversation.push(message);

    if (!chatStore) {
      renderMessage(message);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }

    var result = chatStore.append(CHAT_STORAGE_KEY, NPC_ID, message);

    if (result.ok) {
      // 저장소에 이미 있던 메시지와 메모리 메시지를 합쳐 중복을 막는다.
      var merged = chatStore.dedupe(ruwataData.conversation.concat(result.messages));
      ruwataData.conversation = merged;

      // 저장소가 비워졌거나 일부만 남아 있으면 메모리의 기록도 다시 저장한다.
      if (merged.length > result.messages.length) {
        chatStore.save(CHAT_STORAGE_KEY, NPC_ID, merged);
      }

      if (chatNote && chatNote.textContent !== CHAT_NOTE_DEFAULT) {
        chatNote.textContent = CHAT_NOTE_DEFAULT;
      }
      if (result.added) {
        renderMessage(result.added);
      } else {
        renderConversation();
      }
    } else {
      // 저장에 실패해도 이번 실행 중 대화는 메모리에 남긴다.
      console.warn("대화를 저장하지 못했습니다.", result.error);
      if (chatNote) {
        chatNote.textContent = "대화를 브라우저에 저장하지 못했습니다. 이번 실행 중에만 남습니다.";
      }
      renderMessage(message);
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function renderMessage(message) {
    var speaker = message.speaker === "npc" ? "npc" : (message.speaker === "error" ? "error" : "user");
    var text = String(message.text || message.content || "");
    var row = document.createElement("div");
    var content = document.createElement("div");
    var bubble = document.createElement("div");

    // 지도 캐릭터의 .npc 스타일과 충돌하지 않도록 이름을 분리한다.
    var rowClass = "ruwata-chat-message ";
    if (speaker === "error") {
      rowClass += "error";
      bubble.className = "ruwata-chat-bubble error";
    } else {
      rowClass += (speaker === "npc" ? "assistant" : "user");
      bubble.className = "ruwata-chat-bubble";
    }
    row.className = rowClass;
    content.className = "ruwata-chat-content";
    bubble.textContent = text;

    if (speaker !== "error") {
      var time = document.createElement("span");
      time.className = "ruwata-chat-time";
      time.textContent = formatMessageTime(message.createdAt);
      time.title = formatFullTime(message.createdAt);
      bubble.appendChild(time);
    }

    content.appendChild(bubble);

    if (speaker === "npc" && Array.isArray(message.refs) && message.refs.length) {
      content.appendChild(buildRefs(message.refs));
    }

    row.appendChild(content);
    chatMessages.appendChild(row);
  }

  function buildRefs(refs) {
    var box = document.createElement("div");
    box.className = "ruwata-chat-refs";
    box.appendChild(document.createTextNode("참고 기록: "));

    refs.slice(0, 3).forEach(function (ref, index) {
      if (index > 0) box.appendChild(document.createTextNode(" · "));
      box.appendChild(document.createTextNode((ref.t || ref.id || "기록") + " "));
      var status = document.createElement("span");
      status.className = "lore-status " + String(ref.s || "Unknown").toLowerCase();
      status.textContent = loreStatusLabel(ref.s);
      box.appendChild(status);
    });

    return box;
  }

  function loreStatusLabel(status) {
    if (loreLookup && loreLookup.statusLabel && loreLookup.statusLabel[status]) {
      return loreLookup.statusLabel[status];
    }
    return status || "미확인";
  }

  function formatMessageTime(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return "";
    var now = new Date();
    var sameDay = date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    var hours = String(date.getHours()).padStart(2, "0");
    var minutes = String(date.getMinutes()).padStart(2, "0");
    return sameDay ? hours + ":" + minutes : (date.getMonth() + 1) + "/" + date.getDate() + " " + hours + ":" + minutes;
  }

  function formatFullTime(value) {
    var date = new Date(value);
    return isNaN(date.getTime()) ? "" : date.toLocaleString("ko-KR");
  }


  function setSpeechBubble(text) { speechBubble.textContent = text; }

  function setChatDisabled(disabled) {
    chatInput.disabled = disabled;
    chatForm.querySelector("button").disabled = disabled;
  }

  // TEST RESPONSE ONLY: 입력별로 미리 정한 문장을 반환한다.
  function createTestResponse(userText, loreResult) {
    var items = loreResult && loreResult.items ? loreResult.items : [];
    if (items.length) {
      var top = items[0];
      var label = loreStatusLabel(top.s);
      var claim = String(top.claim || "").replace(/\s+/g, " ").slice(0, 180);
      if (top.s === "Canon") {
        return "기록관의 확정 기록에는 ‘" + top.t + "’에 대해 이렇게 남아 있어요: " + claim;
      }
      return "기록관 기록에는 ‘" + top.t + "’이(가) 아직 " + label + " 상태로 남아 있어요: " + claim +
        " 아직 확정된 내용은 아니에요.";
    }

    var normalized = userText.toLowerCase();
    if (normalized.includes("이름") || normalized.includes("누구")) {
      return "저는 Ruwata입니다. ruwa는 물, wata는 나무를 뜻해요.";
    }
    if (normalized.includes("악기") || normalized.includes("수랄라") || normalized.includes("수타리")) {
      return "저는 수랄라와 수타리의 소리를 살피며 전통 악기를 만들고 있어요.";
    }
    if (normalized.includes("광장") || normalized.includes("kalawa")) {
      return "kalawa 광장에서는 주민들의 이야기를 듣는 시간이 좋아요.";
    }
    return "흥미로운 이야기네요. 저는 아직 많은 것을 배우는 중이에요. 이 메시지는 테스트용 응답입니다.";
  }

  // 이후 장기 기억 저장을 연결할 자리. 현재는 실제 저장하지 않는다.
  function addLongTermMemory(memoryText) {
    if (!memoryText) return;
    ruwataData.longTermMemory.push({ content: memoryText, createdAt: new Date().toISOString() });
  }

  window.ruwataConversationState = {
    npc: ruwataData,
    addLongTermMemory: addLongTermMemory,
    getMessages: function () {
      return ruwataData.conversation.slice();
    },
    reload: function () {
      if (!chatStore) return;
      var result = chatStore.load(CHAT_STORAGE_KEY);
      ruwataData.conversation = result.messages;
      renderConversation();
    }
  };
})();
