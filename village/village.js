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
        id: "morning_work",
        period: "아침",
        start: 6 * 60,
        end: 12 * 60,
        destination: "workshop",
        status: "악기 제작 중",
        description: "Ruwata는 작업장에서 수랄라와 수타리의 울림을 다듬고 있습니다."
      },
      {
        id: "day_social",
        period: "낮",
        start: 12 * 60,
        end: 18 * 60,
        destination: "kalawa",
        status: "광장에서 휴식 중",
        description: "Ruwata는 kalawa 광장에서 주민들과 이야기를 나누고 있습니다."
      },
      {
        id: "evening_return",
        period: "저녁",
        start: 18 * 60,
        end: 21 * 60,
        destination: "workshop",
        status: "작업장으로 이동 중",
        description: "Ruwata는 해가 저물 무렵 작업장으로 돌아가고 있습니다."
      },
      {
        id: "night_rest",
        period: "밤",
        start: 21 * 60,
        end: 24 * 60,
        destination: "workshop",
        status: "휴식 중",
        description: "Ruwata는 작업장 근처에서 조용히 쉬고 있습니다."
      },
      {
        id: "late_night_rest",
        period: "밤",
        start: 0,
        end: 6 * 60,
        destination: "workshop",
        status: "휴식 중",
        description: "Ruwata는 새벽이 오기 전까지 쉬고 있습니다."
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