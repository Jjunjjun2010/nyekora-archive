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

  // 지도의 기준 해상도
  var STAGE_W = 1280;
  var STAGE_H = 800;

  /*
    Ruwata의 임시 이동 목적지 좌표다.
    광장과 작업장의 공식 방향·위치를 확정하는 설정이 아니며,
    현재 시제품 배치에 맞춘 화면 좌표만 사용한다.
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

  var moveTimer = null;

  // 창 크기에 맞춰 지도를 비율 유지한 채 축소/확대한다.
  function fitStage() {
    var scale = Math.min(
      window.innerWidth / STAGE_W,
      window.innerHeight / STAGE_H
    );

    // 큰 화면에서 지도가 지나치게 확대되는 것을 방지한다.
    scale = Math.min(scale, 1.15);
    stage.style.transform = "scale(" + scale + ")";
  }

  window.addEventListener("resize", fitStage);
  fitStage();

  // 야자수 장식: 기존 배치를 그대로 유지한다.
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
    기존 건물·광장 기능을 그대로 유지한다.
    이름표를 삽입하고 클릭 시 기존 설명 패널을 연다.
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

  // 건물 또는 광장의 정보를 표시한다.
  function showPlaceInfo(name, desc) {
    infoTitle.textContent = name || "";
    infoDesc.textContent = desc || "";

    // 장소를 볼 때는 NPC 전용 항목을 숨긴다.
    npcDetails.classList.add("hidden");
    npcActions.classList.add("hidden");

    infoPanel.classList.remove("hidden");
  }

  // Ruwata의 상세 정보를 표시한다.
  function showRuwataInfo() {
    infoTitle.textContent = ruwata.dataset.name || "Ruwata";
    infoDesc.textContent = ruwata.dataset.job || "";

    npcMeaning.textContent = ruwata.dataset.nameMeaning || "";
    npcJob.textContent = ruwata.dataset.job || "";
    npcPersonality.textContent = ruwata.dataset.personality || "";
    npcKnowledge.textContent = ruwata.dataset.knowledge || "";
    npcMemory.textContent = ruwata.dataset.memory || "";

    npcDetails.classList.remove("hidden");
    npcActions.classList.remove("hidden");
    infoPanel.classList.remove("hidden");
  }

  /*
    Ruwata가 움직이는 중에도 버튼 요소 자체는 계속 클릭 가능하다.
    click 이벤트는 CSS의 left/top 이동과 독립적으로 유지된다.
  */
  ruwata.addEventListener("click", function () {
    showRuwataInfo();
  });

  // 지정한 장소로 Ruwata를 이동시킨다.
  function moveRuwata(destinationName) {
    var destination = destinations[destinationName];

    if (!destination) {
      return;
    }

    // 이전 이동 종료 타이머가 있으면 정리한다.
    if (moveTimer !== null) {
      window.clearTimeout(moveTimer);
    }

    ruwata.classList.add("is-moving");
    ruwata.style.left = destination.x + "px";
    ruwata.style.top = destination.y + "px";

    // 이동 버튼을 눌렀을 때 현재 목적지를 화면에 알려 준다.
    infoDesc.textContent =
      "Ruwata가 " + destination.label + "으로 이동하고 있습니다.";

    /*
      CSS 이동 시간이 1.8초이므로 같은 시간이 지난 뒤
      걷기 애니메이션을 멈추고 도착 메시지를 표시한다.
    */
    moveTimer = window.setTimeout(function () {
      ruwata.classList.remove("is-moving");
      infoDesc.textContent =
        "Ruwata가 " + destination.label + "에 도착했습니다.";
      moveTimer = null;
    }, 1800);
  }

  // NPC 정보 패널 안의 이동 버튼을 처리한다.
  npcActions.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-destination]");

    if (!button) {
      return;
    }

    moveRuwata(button.dataset.destination);
  });

  // 정보 패널 닫기
  infoClose.addEventListener("click", function () {
    infoPanel.classList.add("hidden");
  });
})();