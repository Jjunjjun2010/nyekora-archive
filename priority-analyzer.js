/* Nyekora Archive — 검토 우선순위 분석기 (1단계)
 *
 * 목적
 *  - 현재 기록관에 불러온 데이터 중 Proposal(제안) 항목만 골라
 *    "먼저 검토하면 좋은 순서"를 참고용으로 추천한다.
 *
 * 안전 원칙
 *  - 이 파일은 데이터를 읽기만 한다. 상태를 바꾸거나 저장하지 않는다.
 *  - AI/외부 서버를 호출하지 않는다. 점수와 이유는 아래 규칙으로만 계산한다.
 *  - 승인·거부는 반드시 기록관 상세 화면에서 사용자가 직접 한다.
 *  - 기존 데이터 구조(DB, localStorage, Supabase)를 건드리지 않는다.
 *
 * 점수 구성 (총 100점)
 *  - 세계관 영향   25점: 분야의 기반성, 규칙·문자·계층 등 파급 범위
 *  - 선행성·차단   30점: 같은 분야/태그의 다른 제안을 먼저 풀어 주는 정도
 *  - 연관·충돌 위험 25점: 충돌, 결정 필요, 미해결 질문, 확정 후보
 *  - 검토 지연     20점: 결정 기록이 없거나 오래된 정도
 *
 * 브라우저와 Node 테스트 양쪽에서 쓸 수 있게 작성했다.
 */
(function (global) {
  "use strict";

  var VERSION = "1.0.0";

  var CAT_NAME = {
    language: "언어", music: "음악", history: "역사",
    clothing: "의복", society: "사회·관습", architecture: "건축"
  };
  var CAT_W = { language: 10, history: 9, society: 8, architecture: 7, music: 6, clothing: 5 };
  var STATUS_LABEL = { Canon: "확정", Proposal: "제안", Unknown: "미확인", Conflict: "충돌", Rejected: "거부" };

  // 분야 이름 자체는 '구체 태그'로 세지 않는다.
  var GENERIC = new Set(["language", "music", "history", "clothing", "society", "architecture"]);

  // 태그별 기반성(선행성) 점수. 값이 클수록 그 분야의 앞단계다.
  var FOUND = {
    script: 10, orthography: 9, phonology: 8, grammar: 7, numerals: 6, pronoun: 6, derivation: 5,
    loanword: 4, vocabulary: 3, phrases: 2, style: 1, influence: 1,
    origin: 10, era: 8, "story-plot": 2,
    hierarchy: 10, rule: 8, roles: 6, work: 5, festival: 3,
    identity: 10, harat: 7, welora: 7, carving: 3, compare: 2, "reference-not-lore": 0,
    genre: 8, instrument: 6, cosmology: 4, ritual: 3,
    male: 8, female: 8, genderless: 7, formal: 5, color: 4, pattern: 4,
    accessory: 3, regalia: 5, beauty: 2
  };
  var FOUND_MAX = 10;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function specific(e) { return (e.tags || []).filter(function (t) { return !GENERIC.has(t); }); }
  function hasTag(e, t) { return (e.tags || []).indexOf(t) !== -1; }
  function sharedCount(a, b) {
    var n = 0;
    a.forEach(function (x) { if (b.indexOf(x) !== -1) n += 1; });
    return n;
  }

  // 제목/ID에 들어 있는 '분야 기반' 낱말을 보조 신호로 쓴다.
  // (예: arch-identity, soc-hierarchy, 음악 장르, 건국 주체)
  function keywordFoundation(e) {
    var s = String(e.id || "") + " " + String(e.t || "");
    var rules = [
      [/identity|정체성/, 10], [/hierarchy|계층\s*구조/, 10], [/(^|[-\s])script|문자\s*체계|writing_system/, 10],
      [/origin|건국\s*주체|기원/, 9], [/structure|기본\s*구조/, 8], [/genre|장르/, 8],
      [/pronoun|대명사/, 6], [/instrument|악기/, 6], [/numeral|숫자/, 6], [/roles|역할/, 6],
      [/name|이름/, 6], [/male|남성\s*복식/, 8], [/female|여성\s*복식/, 8], [/genderless|성별\s*구분/, 7],
      [/rule|규칙/, 7], [/description|성격/, 7], [/grammar|문법/, 7], [/phonology|발음/, 8],
      [/formal|의례·행사\s*복식/, 5], [/crown|왕관|regalia/, 5], [/work|생업/, 5],
      [/color|색의\s*상징/, 4], [/pattern|문양/, 4], [/fabric|직물/, 4], [/accessor|장신구/, 3],
      [/beauty|아름다움/, 2], [/festival|축제/, 3], [/\bstory|이야기/, 3]
    ];
    var m = 0;
    rules.forEach(function (r) { if (r[0].test(s)) m = Math.max(m, r[1]); });
    return m;
  }

  function foundationScore(e) {
    var m = 0;
    specific(e).forEach(function (t) { if (FOUND[t] != null) m = Math.max(m, FOUND[t]); });
    return Math.max(m, keywordFoundation(e));
  }

  // 분야 전체의 출발점으로 볼 만한 항목인지. (태그가 분야 이름뿐인 것과 구분)
  function categoryWide(e) {
    var s = String(e.id || "") + " " + String(e.t || "");
    return /identity|정체성|hierarchy|계층\s*구조|(^|[-\s])script|sulora|origin|건국\s*주체|structure|기본\s*구조|genre|장르/i.test(s);
  }

  // 같은 분야 안에서의 단계. 숫자가 작을수록 먼저 확정할 기반 항목이다.
  function phase(e) {
    var id = String(e.id || "");
    var idt = id + " " + String(e.t || "");
    var tags = specific(e);
    function has(t) { return tags.indexOf(t) !== -1; }
    if (e.c === "language") {
      if (has("script") || /(^|[-\s])script|sulora|문자\s*체계/.test(idt)) return 1;
      if (has("orthography") || /orth-|hyphen|spelling/.test(idt)) return 2;
      if (has("phonology") || /vowel|sound|r-flap|h-sound|assimilation|prosody|final-consonant|발음/.test(idt)) return 3;
      if (has("grammar") || has("pronoun") || /grammar|word-order|conjugation|tense|plural|prefix|connective|relation|derivation|ni-usage|문법|대명사/.test(idt)) return 4;
      if (has("numerals") || /numeral|숫자/.test(idt)) return 5;
      if (has("loanword")) return 5;
      if (has("vocabulary") || /어휘/.test(idt)) return 6;
      return 7;
    }
    if (e.c === "history") {
      if (has("origin") || /origin|건국\s*주체|기원/.test(idt)) return 1;
      if ((has("era") || /시대/.test(idt)) && /1~2|era-1/.test(idt)) return 2;
      if (has("era") || /시대/.test(idt)) return 2.5;
      if (has("story-plot") || /이야기|본편/.test(idt)) return 4;
      return 5;
    }
    if (e.c === "society") {
      if (has("hierarchy") || /hierarchy|계층\s*구조/.test(idt)) return 1;
      if (has("roles") || /roles|역할/.test(idt)) return 2;
      if (has("work") || /work|생업/.test(idt)) return 3;
      if (has("rule") || /rule|규칙/.test(idt)) return 4;
      if (has("festival") || /festival|축제|의례/.test(idt)) return 5;
      return 6;
    }
    if (e.c === "architecture") {
      if (/identity|정체성/.test(idt)) return 1;
      if (/harat-name/.test(id)) return 2;
      if (/structure|tower|welora-form|welora-exterior|구조|탑/.test(idt)) return 3;
      if (has("carving") || /lotus|naga|연꽃|조각/.test(idt)) return 4;
      if (has("compare") || /차이|비교/.test(idt)) return 5;
      if (has("reference-not-lore")) return 6;
      return 3;
    }
    if (e.c === "music") {
      if (has("genre") || /genre|장르/.test(idt)) return 1;
      if (/master-instruments|주요\s*악기/.test(idt)) return 2;
      if (has("instrument") || /instrument|악기/.test(idt)) return 3;
      if (has("cosmology") || /cosmology|Patala|Swarga/.test(idt)) return 4;
      if (has("ritual") || /ritual|의례/.test(idt)) return 5;
      return 6;
    }
    if (e.c === "clothing") {
      if (has("male") || has("female") || has("genderless") || /male|female|genderless|남성\s*복식|여성\s*복식|성별\s*구분/.test(idt)) return 2;
      if (has("formal") || has("color") || has("pattern") || has("accessory") || has("regalia") || /formal|color|pattern|accessor|regalia|직물|문양|색의|왕관|장신구|의례·행사/.test(idt)) return 3;
      if (has("beauty") || /beauty|아름다움/.test(idt)) return 4;
      return 5;
    }
    return 5;
  }

  function parseDate(value) {
    var m = String(value || "").match(/(\d{4}-\d{2}-\d{2})/);
    return m ? new Date(m[1] + "T00:00:00Z") : null;
  }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function hasRealDecision(e) {
    return !!parseDate(e.dec) && !/작성자 확인 전|확인 전|미확인/.test(String(e.dec || ""));
  }

  function relatedOf(e, all) {
    var tags = specific(e);
    if (!tags.length) return [];
    return all.filter(function (o) {
      return o.id !== e.id && o.s !== "Rejected" && specific(o).some(function (t) { return tags.indexOf(t) !== -1; });
    });
  }

  // '먼저 확정해야 할 관련 설정': 같은 분야에서 더 앞단계이고 아직 확정되지 않은 항목.
  function prerequisitesOf(e, all) {
    var ph = phase(e);
    var itemTags = specific(e);
    var candidates = all.filter(function (o) {
      return o.c === e.c && o.id !== e.id &&
        (o.s === "Proposal" || o.s === "Unknown") &&
        phase(o) < ph - 0.01;
    });
    candidates.sort(function (a, b) {
      var aShared = sharedCount(itemTags, specific(a)) > 0 ? 1 : 0;
      var bShared = sharedCount(itemTags, specific(b)) > 0 ? 1 : 0;
      return (bShared - aShared) || (phase(a) - phase(b)) || (foundationScore(b) - foundationScore(a));
    });
    return candidates.slice(0, 3);
  }

  function analyzeOne(e, all, now) {
    var tags = specific(e);
    var catW = CAT_W[e.c] || 5;
    var fs = foundationScore(e);
    var ph = phase(e);
    var related = relatedOf(e, all);
    var relatedProposals = related.filter(function (o) { return o.s === "Proposal" || o.s === "Unknown"; });
    // 분야 전체의 출발점으로 볼 항목: 제목/ID가 분야 기반을 가리키거나,
    // script·identity·hierarchy·origin처럼 최상위 기반 태그 하나만 가진 경우.
    var categoryLevel = categoryWide(e) || (fs >= 9 && tags.length <= 1);
    var sameCatProposals = all.filter(function (o) {
      return o.c === e.c && o.id !== e.id && o.s !== "Rejected" && (o.s === "Proposal" || o.s === "Unknown");
    });

    // 1) 세계관 영향 (25)
    var impact = catW;
    tags.forEach(function (t) {
      if (["rule", "script", "origin", "hierarchy", "identity"].indexOf(t) !== -1) impact += 4;
      else if (["orthography", "phonology", "era", "grammar", "cosmology", "genre", "regalia"].indexOf(t) !== -1) impact += 2;
    });
    if (categoryLevel) impact += 3;
    impact += Math.min(3, Math.max(0, tags.length - 1));
    if (e.v === 1) impact += 3;
    if (ph === 1) impact += 2;
    if (tags.indexOf("story-plot") !== -1) impact -= 4;
    impact = clamp(impact, 0, 25);

    // 2) 선행성·차단 (30)
    var blocking = (fs / FOUND_MAX) * 15;
    blocking += Math.min(7, Math.sqrt(relatedProposals.length) * 1.3);
    if (categoryLevel) blocking += Math.min(6, sameCatProposals.length * 0.5);
    if (tags.indexOf("canon-candidate") !== -1) blocking += 4;
    var crossCats = {};
    related.forEach(function (o) { if (o.c !== e.c) crossCats[o.c] = true; });
    blocking += Math.min(3, Object.keys(crossCats).length * 1.2);
    if (ph === 1) blocking += 5;
    if (e.conf) blocking += 10;
    if (tags.indexOf("needs-decision") !== -1) blocking += 4;
    if (tags.indexOf("open-question") !== -1) blocking += 2;
    blocking = clamp(blocking, 0, 30);

    // 3) 연관·충돌 위험 (25)
    var risk = 0;
    if (e.conf) risk += 12;
    if (e.conf && !e.res) risk += 4;
    if (e.rq) risk += 7;
    if (tags.indexOf("open-question") !== -1) risk += 6;
    if (tags.indexOf("needs-decision") !== -1) risk += 8;
    if (tags.indexOf("canon-candidate") !== -1) risk += 3;
    if ((e.src || []).length >= 2) risk += 2;
    risk = clamp(risk, 0, 25);

    // 4) 검토 지연 (20)
    var decDate = parseDate(e.dec);
    var hintDate = parseDate(e.hint);
    var stale, staleBasis;
    if (hasRealDecision(e)) {
      var dd = daysBetween(decDate, now);
      stale = dd > 90 ? 20 : dd > 30 ? 16 : dd > 7 ? 10 : 4;
      staleBasis = "마지막 결정 기록 " + e.dec.match(/\d{4}-\d{2}-\d{2}/)[0] + " (" + dd + "일 전)";
    } else if (hintDate) {
      var hd = daysBetween(hintDate, now);
      stale = hd > 90 ? 18 : hd > 30 ? 15 : hd > 7 ? 10 : 5;
      staleBasis = "원자료 시점 " + e.hint.match(/\d{4}-\d{2}-\d{2}/)[0] + " (" + hd + "일 전)";
    } else {
      stale = 15;
      staleBasis = "결정 기록 날짜가 없음 (명시적 검토 이력 없음)";
    }

    var total = Math.round((impact + blocking + risk + stale) * 10) / 10;
    return {
      e: e,
      total: total,
      impact: Math.round(impact * 10) / 10,
      blocking: Math.round(blocking * 10) / 10,
      risk: Math.round(risk * 10) / 10,
      stale: stale,
      staleBasis: staleBasis,
      phase: ph,
      foundation: fs,
      categoryLevel: categoryLevel,
      tags: tags,
      relatedCount: related.length,
      relatedProposals: relatedProposals.length,
      sameCatProposals: sameCatProposals.length,
      prerequisites: prerequisitesOf(e, all)
    };
  }

  function buildReasons(r) {
    var out = [];
    var tags = r.tags;
    var cat = CAT_NAME[r.e.c] || r.e.c;

    if (r.phase === 1) {
      out.push("‘" + cat + "’ 분야의 출발점이 되는 항목입니다. 여기서 정한 내용이 같은 분야의 뒤 항목에 전제가 됩니다.");
    } else if (r.impact >= 14) {
      out.push("세계관 전체에 미치는 영향이 큰 항목으로 보았습니다. (‘" + cat + "’ 분야의 기반)");
    } else if (r.impact >= 10) {
      out.push("같은 분야의 여러 항목에 영향을 줄 수 있는 내용입니다.");
    }

    if (r.categoryLevel && r.sameCatProposals > 0) {
      out.push("같은 분야의 미확정 항목 " + r.sameCatProposals + "개가 이 결정을 전제로 삼을 수 있어, 먼저 정리하는 편이 좋습니다.");
    } else if (r.relatedProposals >= 10) {
      out.push("태그가 겹치는 다른 제안이 " + r.relatedProposals + "개 있습니다. 이 항목을 정하면 후속 검토가 쉬워집니다.");
    } else if (r.relatedProposals >= 3) {
      out.push("관련 제안 " + r.relatedProposals + "개와 연결되어 있습니다.");
    }

    if (tags.indexOf("canon-candidate") !== -1) {
      out.push("확정 후보(canon-candidate)로 표시되어 있어, 내용을 확인하면 Canon으로 올릴 수 있습니다.");
    }
    if (r.e.conf && !r.e.res) {
      out.push("아직 해소되지 않은 충돌 기록이 있어 먼저 판단이 필요합니다.");
    } else if (r.e.conf) {
      out.push("충돌 이력이 있는 항목입니다. 해소 결과가 현재 제안에 반영되어 있는지 확인이 필요합니다.");
    }
    if (tags.indexOf("needs-decision") !== -1) {
      out.push("‘결정 필요(needs-decision)’로 표시되어 있습니다.");
    }
    if (tags.indexOf("open-question") !== -1) {
      out.push("미해결 질문(open-question)으로 남아 있어 다른 항목의 확정을 막을 수 있습니다.");
    }

    out.push(r.staleBasis + ".");
    return out.slice(0, 5);
  }

  function buildLimitations(r) {
    var out = [];
    if (!r.e.conf) {
      out.push("데이터에 항목 간 명시적 의존 관계가 없어, 태그와 분야 단계로 선행 관계를 추정했습니다. 실제 의존 관계와 다를 수 있습니다.");
    }
    if (!hasRealDecision(r.e)) {
      out.push("검토 날짜나 결정 기록이 충분하지 않아 ‘오래 방치된 정도’를 정확히 계산하기 어렵습니다.");
    }
    var src = r.e.src || [];
    var secondaryOnly = src.length > 0 && src.every(function (s) {
      return s[0] === "source-docx-culture" || s[0] === "source-docx-architecture";
    });
    if (secondaryOnly) {
      out.push("근거가 2차 자료뿐이라, 실제 Canon으로 확정할 수 있는지는 1차 자료 확인이 필요합니다.");
    }
    if (r.e.conf) {
      out.push("충돌한 자료 중 어느 쪽을 우선할지는 기록만으로 판단할 수 없습니다. 창작자의 의도 확인이 필요합니다.");
    }
    if (hasTag(r.e, "story-plot")) {
      out.push("이야기 구상 항목은 본편 진행 상황에 따라 우선순위가 달라질 수 있습니다.");
    }
    if (!out.length) {
      out.push("세계관에서 각 분야의 비중은 창작자 판단에 달려 있어, 이 점수는 참고용입니다.");
    }
    return out.slice(0, 3);
  }

  function analyze(entries, options) {
    var opts = options || {};
    var now = opts.now ? new Date(opts.now) : new Date();
    var all = (entries || []).slice();
    var proposals = all.filter(function (e) { return e && e.s === "Proposal"; });

    var items = proposals.map(function (e) { return analyzeOne(e, all, now); });
    items.sort(function (a, b) {
      return (b.total - a.total) || String(a.e.id).localeCompare(String(b.e.id));
    });
    items.forEach(function (r, i) {
      r.rank = i + 1;
      r.reasons = buildReasons(r);
      r.limitations = buildLimitations(r);
    });

    var statusCounts = { Canon: 0, Proposal: 0, Unknown: 0, Conflict: 0, Rejected: 0 };
    all.forEach(function (e) { if (e && statusCounts[e.s] != null) statusCounts[e.s] += 1; });

    var notes = {};
    if (proposals.length <= 1) {
      notes.single = "Proposal 항목이 " + proposals.length + "개뿐입니다. 가능한 이유: " +
        "(1) 이미 대부분 Canon/Unknown으로 정리됨, " +
        "(2) 클라우드 동기화가 아직 끝나지 않아 이 브라우저에 일부 데이터만 있음, " +
        "(3) 백업 파일을 복구하지 않아 기본 데이터(SEED)만 불러온 상태임. " +
        "☁ 클라우드 로그인 상태와 관리 화면의 복구 여부를 확인해 주세요.";
    }
    if (proposals.length > 0 && items[0].total === items[items.length - 1].total) {
      notes.tie = "일부 항목의 점수가 같아 ID 순서로 정렬했습니다. 동점 항목은 함께 검토해도 좋습니다.";
    }

    return {
      version: VERSION,
      generatedAt: now.toISOString(),
      sourceLabel: opts.sourceLabel || "현재 기록관 데이터",
      totalEntries: all.length,
      proposalCount: proposals.length,
      statusCounts: statusCounts,
      averageScore: items.length ? Math.round(items.reduce(function (s, r) { return s + r.total; }, 0) / items.length * 10) / 10 : 0,
      items: items,
      notes: notes
    };
  }

  function badge(status) {
    return '<span class="badge ' + esc(status) + '">' + esc(status) + " · " + esc(STATUS_LABEL[status] || status) + "</span>";
  }

  function renderItem(r) {
    var e = r.e;
    var reasons = r.reasons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");
    var prereq = r.prerequisites.length
      ? '<ul class="pr-links">' + r.prerequisites.map(function (o) {
          return '<li><a href="#' + esc(o.id) + '">' + esc(o.t) + "</a> " + badge(o.s) +
            ' <span class="pr-cat">' + esc(CAT_NAME[o.c] || o.c) + "</span></li>";
        }).join("") + "</ul>"
      : '<p class="pr-empty">현재 같은 분야에 미확정 선행 항목이 없습니다. 이 항목이 분야의 출발점에 가깝습니다.</p>';
    var limits = r.limitations.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("");

    return '<article class="pr-item' + (r.rank <= 3 ? " pr-top3" : "") + '">' +
      '<header class="pr-item-head">' +
        '<span class="pr-rank" aria-hidden="true">' + r.rank + "</span>" +
        '<div class="pr-title">' +
          '<h3><a href="#' + esc(e.id) + '">' + esc(e.t) + "</a></h3>" +
          '<div class="pr-meta">' + badge(e.s) +
            '<span class="pr-cat">' + esc(CAT_NAME[e.c] || e.c) + "</span>" +
            '<span class="pr-score">' + r.total + "점</span>" +
          "</div>" +
        "</div>" +
      "</header>" +
      '<div class="pr-bar" aria-hidden="true"><span style="width:' + Math.max(0, Math.min(100, r.total)) + '%"></span></div>' +
      '<div class="pr-breakdown">' +
        "<span>세계관 영향 <b>" + r.impact + "</b>/25</span>" +
        "<span>선행성·차단 <b>" + r.blocking + "</b>/30</span>" +
        "<span>연관·충돌 위험 <b>" + r.risk + "</b>/25</span>" +
        "<span>검토 지연 <b>" + r.stale + "</b>/20</span>" +
      "</div>" +
      '<div class="pr-cols">' +
        '<section class="pr-sec"><h4>추천 이유</h4><ul>' + reasons + "</ul></section>" +
        '<section class="pr-sec"><h4>먼저 확정해야 할 관련 설정</h4>' + prereq + "</section>" +
        '<section class="pr-sec pr-dim"><h4>AI가 판단하기 어려운 부분</h4><ul>' + limits + "</ul></section>" +
      "</div>" +
    "</article>";
  }

  // 분석 결과 본문만 그린다. (renderView와 파일 미리보기에서 함께 사용)
  function renderResults(result, opts) {
    if (!result.proposalCount) {
      return '<p class="note">이 데이터에 <b>Proposal(제안)</b> 항목이 없습니다. ' +
        "모두 확정되었거나, 클라우드 동기화·백업 복구가 아직 끝나지 않았을 수 있습니다.</p>";
    }

    var topN = (opts && opts.topN) || 10;
    var top = result.items.slice(0, topN);
    var rest = result.items.slice(topN);
    var counts = result.statusCounts;
    var singleNote = result.notes.single
      ? '<p class="note err" role="alert">' + esc(result.notes.single) + "</p>"
      : "";
    var tieNote = result.notes.tie ? '<p class="note">' + esc(result.notes.tie) + "</p>" : "";

    var restHtml = rest.length
      ? '<details class="pr-rest"><summary>나머지 ' + rest.length + "개 항목 보기 (" + (topN + 1) + "위 이하)</summary>" +
        rest.map(renderItem).join("") + "</details>"
      : "";

    return singleNote + tieNote +
      '<div class="pr-summary">' +
        "<div><strong>" + result.proposalCount + "</strong>분석한 제안</div>" +
        "<div><strong>" + result.totalEntries + "</strong>전체 기록</div>" +
        "<div><strong>" + result.averageScore + "</strong>평균 점수</div>" +
        '<div><strong>' + top[0].total + "</strong>1위 점수</div>" +
      "</div>" +
      '<p class="pr-statusline">상태 분포: ' +
        ["Canon", "Proposal", "Unknown", "Conflict", "Rejected"].map(function (s) {
          return '<span class="pr-chip ' + s + '">' + s + " " + (counts[s] || 0) + "</span>";
        }).join(" ") +
        ' <span class="pr-generated">분석 시각: ' + esc(new Date(result.generatedAt).toLocaleString("ko-KR")) + "</span></p>" +
      '<div class="pr-readonly" role="note">🔒 이 화면은 <b>추천만</b> 표시합니다. 승인·거부·수정은 각 항목을 열어 기록관에서 직접 결정해 주세요. ' +
        "분석기는 데이터를 읽기만 하며 저장소를 변경하지 않습니다.</div>" +
      '<div class="pr-top">' + top.map(renderItem).join("") + "</div>" +
      restHtml +
      '<div class="pr-foot">' +
        "<h3>이 추천을 읽는 법</h3>" +
        "<ul>" +
        "<li><b>세계관 영향</b>: 분야의 기반성과 파급 범위를 본 점수입니다.</li>" +
        "<li><b>선행성·차단</b>: 이 항목을 정하면 같은 분야·태그의 다른 제안을 얼마나 풀어 주는지 봅니다.</li>" +
        "<li><b>연관·충돌 위험</b>: 충돌 기록, 결정 필요, 미해결 질문, 확정 후보 표시를 반영합니다.</li>" +
        "<li><b>검토 지연</b>: 결정 기록이 없거나 오래된 정도를 봅니다.</li>" +
        "<li>점수는 정답이 아닙니다. 창작자가 중요하게 여기는 순서와 다를 수 있으니 참고용으로만 써 주세요.</li>" +
        "</ul>" +
      "</div>";
  }

  function renderView(entries, options) {
    var result = analyze(entries, options);
    return '<main class="pr">' +
      '<div class="crumb"><a href="#">처음</a> / 검토 우선순위</div>' +
      "<h2>검토 우선순위 추천</h2>" +
      '<p class="note">현재 기록관에 불러온 <b>' + esc(result.sourceLabel) + "</b>에서 " +
        "<b>Proposal(제안) " + result.proposalCount + "개</b>를 분석했습니다. " +
        "점수와 이유는 아래 규칙으로 계산한 <b>참고용 추천</b>이며, 항목의 상태를 자동으로 바꾸지 않습니다.</p>" +
      '<div class="bar"><button class="btn2" type="button" onclick="window.priorityRefresh&&window.priorityRefresh()">현재 데이터로 다시 분석</button></div>' +
      '<details class="pr-import">' +
        "<summary>다른 데이터 파일로 미리 분석하기 (선택)</summary>" +
        '<p class="lc">현재 기록관 데이터를 바꾸지 않고, 선택한 JSON/TXT 파일만 읽어 분석합니다. ' +
          "Supabase 동기화 전 파일이나 백업 파일을 확인할 때 쓸 수 있습니다. " +
          "파일 형식은 항목 배열(<code>[{...}, {...}]</code>) 또는 백업의 <code>db.ent</code>입니다.</p>" +
        '<input type="file" id="pr-file" accept=".json,.txt,application/json,text/plain" onchange="NyekoraPriority.analyzeFile(this)">' +
      "</details>" +
      '<div id="pr-file-panel" class="hidden"></div>' +
      '<div id="pr-default-result">' + renderResults(result, { topN: 10 }) + "</div>" +
    "</main>";
  }

  function normalizeEntries(data) {
    if (Array.isArray(data)) return { entries: data, partial: false };
    if (data && Array.isArray(data.entries)) return { entries: data.entries, partial: false };
    if (data && data.db && data.db.ent) {
      return { entries: Object.keys(data.db.ent).map(function (k) { return data.db.ent[k]; }), partial: true };
    }
    if (data && data.ent) {
      return { entries: Object.keys(data.ent).map(function (k) { return data.ent[k]; }), partial: true };
    }
    return null;
  }

  // 파일 선택 시: 읽기만 하고, 기본 데이터는 그대로 둔다.
  function analyzeFile(input) {
    var file = input && input.files && input.files[0];
    var panel = document.getElementById("pr-file-panel");
    var def = document.getElementById("pr-default-result");
    if (!file || !panel) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var normalized = normalizeEntries(data);
        if (!normalized || !normalized.entries.length) {
          throw new Error("항목 배열을 찾지 못했습니다. 기록관 항목 배열 또는 백업 JSON을 선택해 주세요.");
        }
        var result = analyze(normalized.entries, { sourceLabel: file.name });
        panel.innerHTML = "<h2>파일 미리 분석 결과</h2>" +
          '<p class="note">선택한 파일 <b>' + esc(file.name) + "</b>만 읽어 분석했습니다. 기록관 데이터와 저장소는 바뀌지 않았습니다." +
          (normalized.partial ? " 이 파일은 편집본만 담긴 백업일 수 있어 전체 제안 수가 실제와 다를 수 있습니다." : "") +
          "</p>" +
          '<div class="bar"><button class="btn2" type="button" onclick="NyekoraPriority.closeFile()">현재 기록관 데이터 결과로 돌아가기</button></div>' +
          renderResults(result, { topN: 10 });
        panel.classList.remove("hidden");
        if (def) def.classList.add("hidden");
      } catch (e) {
        panel.innerHTML = '<p class="note err">파일을 읽지 못했습니다: ' + esc(e && e.message ? e.message : e) + "</p>";
        panel.classList.remove("hidden");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function closeFile() {
    var panel = document.getElementById("pr-file-panel");
    var def = document.getElementById("pr-default-result");
    if (panel) { panel.innerHTML = ""; panel.classList.add("hidden"); }
    if (def) def.classList.remove("hidden");
  }

  var API = {
    version: VERSION,
    analyze: analyze,
    renderView: renderView,
    renderResults: renderResults,
    analyzeFile: analyzeFile,
    closeFile: closeFile,
    normalizeEntries: normalizeEntries,
    // 테스트/다른 화면에서 재사용할 수 있는 보조 함수
    foundationScore: foundationScore,
    phase: phase
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  global.NyekoraPriority = API;
})(typeof window !== "undefined" ? window : globalThis);
