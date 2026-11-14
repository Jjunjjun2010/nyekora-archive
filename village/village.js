(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var infoPanel = document.getElementById("info-panel");
  var infoTitle = document.getElementById("info-title");
  var infoDesc = document.getElementById("info-desc");
  var infoClose = document.getElementById("info-close");

  // 지도의 기준 해상도 (이 값 기준으로 모든 좌표를 잡음)
  var STAGE_W = 1280;
  var STAGE_H = 800;

  // 창 크기에 맞춰 지도를 비율 유지한 채 축소/확대
  function fitStage() {
    var scale = Math.min(
      window.innerWidth / STAGE_W,
      window.innerHeight / STAGE_H
    );
    scale = Math.min(scale, 1.15); // 큰 화면에서 과도하게 커지는 것 방지
    stage.style.transform = "scale(" + scale + ")";
  }
  window.addEventListener("resize", fitStage);
  fitStage();

  // 야자수 장식 (임의 고정 배치, 추후 자유롭게 조정 가능)
  var treeSpots = [
    { x: 40, y: 40 }, { x: 110, y: 90 }, { x: 60, y: 600 },
    { x: 1180, y: 60 }, { x: 1120, y: 120 }, { x: 1190, y: 600 },
    { x: 420, y: 560 }, { x: 760, y: 560 }, { x: 180, y: 300 },
    { x: 1020, y: 300 }, { x: 40, y: 720 }, { x: 1180, y: 720 }
  ];
  treeSpots.forEach(function (spot) {
    var tree = document.createElement("div");
    tree.className = "tree";
    tree.style.setProperty("--x", spot.x + "px");
    tree.style.setProperty("--y", spot.y + "px");
    stage.appendChild(tree);
  });

  // 건물·광장에 이름표 삽입 + 클릭 시 설명 패널 표시
  var clickable = document.querySelectorAll(".building, .plaza");
  clickable.forEach(function (el) {
    var label = document.createElement("span");
    label.className = "label";
    label.textContent = el.dataset.name || "";
    el.appendChild(label);

    el.addEventListener("click", function () {
      showInfo(el.dataset.name, el.dataset.desc);
    });
  });

  function showInfo(name, desc) {
    infoTitle.textContent = name || "";
    infoDesc.textContent = desc || "";
    infoPanel.classList.remove("hidden");
  }

  infoClose.addEventListener("click", function () {
    infoPanel.classList.add("hidden");
  });
})();