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
})();

/* =========================================================
   Ruwata 대화 시스템
   현재는 외부 API를 사용하지 않는 테스트용 구현이다.
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
  var ruwataElement = document.getElementById("ruwata");
  var speechBubble = document.getElementById("ruwata-speech-bubble");
  var chat = document.getElementById("ruwata-chat");
  var chatClose = document.getElementById("ruwata-chat-close");
  var chatMessages = document.getElementById("ruwata-chat-messages");
  var chatForm = document.getElementById("ruwata-chat-form");
  var chatInput = document.getElementById("ruwata-chat-input");

  if (!ruwataElement || !speechBubble || !chat || !chatClose || !chatMessages || !chatForm || !chatInput) {
    console.warn("Ruwata 대화 UI 요소를 찾을 수 없습니다.");
    return;
  }

  ruwataElement.addEventListener("click", openChat);
  chatClose.addEventListener("click", closeChat);
  chatForm.addEventListener("submit", function (event) {
    event.preventDefault();
    sendMessage();
  });

  function openChat() {
    chat.classList.remove("hidden");
    ruwataElement.classList.add("chat-open");
    speechBubble.setAttribute("aria-hidden", "false");

    if (ruwataData.conversation.length === 0) {
      addNpcMessage("안녕하세요. 저는 Ruwata입니다. 오늘도 악기를 다듬고 있어요.");
    }
    window.setTimeout(function () { chatInput.focus(); }, 0);
  }

  function closeChat() {
    chat.classList.add("hidden");
    ruwataElement.classList.remove("chat-open");
    speechBubble.setAttribute("aria-hidden", "true");

  }

  function sendMessage() {
    var text = chatInput.value.trim();
    if (!text) return;

    addUserMessage(text);
    chatInput.value = "";
    setSpeechBubble("...");
    setChatDisabled(true);

    window.setTimeout(function () {
      // TEST RESPONSE ONLY: 고정 테스트 응답이며 실제 AI/Ollama 응답이 아니다.
      var testResponse = createTestResponse(text);
      addNpcMessage(testResponse);
      setSpeechBubble("...");
      setChatDisabled(false);
      chatInput.focus();
    }, 650);
  }

  function addUserMessage(text) {
    addMessage("user", text);
    ruwataData.conversation.push({ role: "user", content: text, createdAt: new Date().toISOString() });
  }

  function addNpcMessage(text) {
    addMessage("npc", text);
    ruwataData.conversation.push({ role: "assistant", content: text, createdAt: new Date().toISOString() });
  }

  function addMessage(role, text) {
    var row = document.createElement("div");
    var bubble = document.createElement("div");
    row.className = "ruwata-chat-message " + role;
    bubble.className = "ruwata-chat-bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function setSpeechBubble(text) { speechBubble.textContent = text; }

  function setChatDisabled(disabled) {
    chatInput.disabled = disabled;
    chatForm.querySelector("button").disabled = disabled;
  }

  // TEST RESPONSE ONLY: 입력별로 미리 정한 문장을 반환한다.
  function createTestResponse(userText) {
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
    addLongTermMemory: addLongTermMemory
  };
})();