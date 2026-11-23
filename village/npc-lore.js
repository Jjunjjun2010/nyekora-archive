/*
  니에코라 마을 NPC용 기록관 자료 검색기

  - nyekora-data.js의 SEED(설정 원본)를 읽는다.
  - 기록관에서 편집한 내용(localStorage["nyekora-archive:v1:db"])도 함께 읽는다.
  - 질문과 관련된 항목만 골라 Canon/Proposal/Unknown/Conflict 상태와 함께 돌려준다.
  - Rejected와 "reference-not-lore" 태그 항목은 일반 참고자료에서 제외한다.
  - 이 파일은 데이터를 수정하지 않는다. 읽기 전용이다.
*/
(function (global) {
  "use strict";

  var ARCHIVE_DB_KEY = "nyekora-archive:v1:db";

  var STATUS_LABEL = {
    Canon: "확정",
    Proposal: "제안",
    Unknown: "미확인",
    Conflict: "충돌",
    Rejected: "거부"
  };

  var STATUS_RANK = {
    Canon: 0,
    Conflict: 1,
    Proposal: 2,
    Unknown: 3,
    Rejected: 9
  };

  // 한국어 조사·어미를 간단히 떼어 낸다. (예: 하랏의 -> 하랏, 수랄라가 -> 수랄라)
  var PARTICLE_SUFFIXES = [
    "으로부터", "로부터", "에서는", "에게서", "이라고", "라고",
    "에서", "에게", "으로", "부터", "까지", "이랑", "이란", "이나",
    "이에요", "인가요", "일까요", "이야", "예요", "인가", "일까",
    "는데", "지만", "네요", "랑", "나", "보다", "처럼", "만큼",
    "이요", "야", "죠", "요",
    "의", "은", "는", "이", "가", "을", "를", "에", "로", "와", "과", "도", "만"
  ];

  // 질문의 형식만 채우는 말은 검색어에서 제외한다.
  var STOPWORDS = {
    "뭐야": true, "뭐": true, "무엇": true, "알려줘": true, "알려": true,
    "어떤": true, "대해": true, "대한": true, "관해": true, "관한": true,
    "얼마나": true, "얼마": true, "있어": true, "있나": true, "돼": true,
    "해줘": true, "좀": true, "것": true, "등": true, "그리고": true
  };

  // 한국어 질문과 영어/한국어가 섞인 기록을 이어 주기 위한 최소한의 동의어.
  var SYNONYMS = {
    "악기": ["instrument", "music", "수랄라", "수타리"],
    "음악": ["music", "악기"],
    "수랄라": ["surala"],
    "surala": ["수랄라"],
    "수타리": ["sutari"],
    "sutari": ["수타리"],
    "하랏": ["harat"],
    "harat": ["하랏"],
    "광장": ["kalawa", "카라와"],
    "카라와": ["kalawa", "광장"],
    "기록관": ["archive"],
    "인구": ["population"],
    "의복": ["clothing", "복식"],
    "복식": ["clothing", "의복"],
    "건축": ["architecture", "harat", "welora"],
    "가면": ["mask", "가면춤"],
    "가면춤": ["mask"],
    "계급": ["rank", "social-rank", "hierarchy"],
    "신분": ["rank", "hierarchy"],
    "언어": ["language"],
    "문자": ["script", "writing"],
    "역사": ["history"],
    "사회": ["society"],
    "관습": ["custom", "society"]
  };

  function safeString(value) {
    return value == null ? "" : String(value);
  }

  function normalize(text) {
    return safeString(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function unique(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (item) {
      if (!item || seen[item]) return;
      seen[item] = true;
      out.push(item);
    });
    return out;
  }

  function truncate(text, maxLength) {
    var value = safeString(text).replace(/\s+/g, " ").trim();
    if (value.length <= maxLength) return value;
    return value.slice(0, Math.max(0, maxLength - 1)).trim() + "…";
  }

  function stripParticle(word) {
    for (var i = 0; i < PARTICLE_SUFFIXES.length; i += 1) {
      var suffix = PARTICLE_SUFFIXES[i];
      if (word.length - suffix.length >= 2 && word.slice(-suffix.length) === suffix) {
        return word.slice(0, -suffix.length);
      }
    }
    return word;
  }

  function queryTerms(query) {
    var normalized = normalize(query);
    if (!normalized) return [];

    var terms = [];
    var words = normalized.split(" ");

    words.forEach(function (word) {
      if (word.length >= 2) terms.push(word);

      var first = stripParticle(word);
      if (first !== word && first.length >= 2) terms.push(first);

      var second = stripParticle(first);
      if (second !== first && second.length >= 2) terms.push(second);

      [word, first, second].forEach(function (token) {
        if (token.length >= 2 && SYNONYMS[token]) {
          SYNONYMS[token].forEach(function (synonym) {
            terms.push(normalize(synonym));
          });
        }
      });
    });

    return unique(terms.filter(function (term) {
      return term.length >= 2 && !STOPWORDS[term];
    }));
  }

  function getSeed() {
    try {
      if (typeof SEED !== "undefined" && Array.isArray(SEED)) return SEED;
    } catch (error) {
      // 아래 global.SEED를 사용한다.
    }
    return Array.isArray(global.SEED) ? global.SEED : [];
  }

  function getCategories() {
    try {
      if (typeof CATS !== "undefined" && CATS) return CATS;
    } catch (error) {
      // 아래 global.CATS를 사용한다.
    }
    return global.CATS || {};
  }

  function loadArchiveDB() {
    try {
      if (!global.localStorage) return null;
      var raw = global.localStorage.getItem(ARCHIVE_DB_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.v !== 1 || !data.ent || !data.del || !Array.isArray(data.log)) {
        return null;
      }
      return data;
    } catch (error) {
      return null;
    }
  }

  function mergeEntry(seedEntry, editedEntry) {
    if (!editedEntry) return seedEntry;
    var merged = {};
    Object.keys(seedEntry || {}).forEach(function (key) {
      merged[key] = seedEntry[key];
    });
    Object.keys(editedEntry).forEach(function (key) {
      merged[key] = editedEntry[key];
    });
    return merged;
  }

  /*
    기록관 원본 + 기록관 편집본을 합친다.
    - 삭제(DB.del)된 항목은 제외한다.
    - Rejected 상태와 reference-not-lore 태그는 일반 참고자료에서 제외한다.
    - 원본 객체는 수정하지 않는다.
  */
  function getEntries() {
    var seed = getSeed();
    var db = loadArchiveDB();
    var entries = [];
    var seen = {};

    seed.forEach(function (seedEntry) {
      if (!seedEntry || !seedEntry.id) return;
      var id = seedEntry.id;
      seen[id] = true;
      if (db && db.del && db.del[id]) return;
      entries.push(mergeEntry(seedEntry, db && db.ent ? db.ent[id] : null));
    });

    if (db && db.ent) {
      Object.keys(db.ent).forEach(function (id) {
        if (seen[id] || (db.del && db.del[id])) return;
        entries.push(db.ent[id]);
      });
    }

    return entries.filter(function (entry) {
      if (!entry || !entry.id) return false;
      if (!STATUS_LABEL[entry.s] || entry.s === "Rejected") return false;
      var tags = Array.isArray(entry.tags) ? entry.tags : [];
      return tags.indexOf("reference-not-lore") === -1;
    });
  }

  function categoryName(categoryId) {
    var categories = getCategories();
    return safeString(categories[categoryId] || categoryId);
  }

  function termLengthWeight(term) {
    if (term.length >= 4) return 3;
    if (term.length >= 3) return 2;
    return 1;
  }

  function termSpecificity(documentCount, totalCount) {
    if (!totalCount) return 1;
    var ratio = documentCount / totalCount;
    if (ratio > 0.15) return 0.5;
    if (ratio > 0.10) return 0.75;
    if (ratio > 0.05) return 0.9;
    return 1;
  }

  function selectRelevant(query, limit) {
    var maxItems = limit || 6;
    var terms = queryTerms(query);
    var normalizedQuery = normalize(query);

    if (!terms.length || !normalizedQuery) return [];

    var prepared = getEntries().map(function (entry) {
      var titleNorm = normalize(entry.t);
      var claimNorm = normalize(entry.claim);
      var tagsNorm = normalize((Array.isArray(entry.tags) ? entry.tags : []).join(" "));
      var categoryNorm = normalize(safeString(entry.c) + " " + categoryName(entry.c));

      return {
        entry: entry,
        titleNorm: titleNorm,
        claimNorm: claimNorm,
        tagsNorm: tagsNorm,
        categoryNorm: categoryNorm,
        titleTerms: titleNorm.split(" ").filter(function (titleTerm) {
          return titleTerm.length >= 2;
        }),
        haystack: [titleNorm, claimNorm, tagsNorm, categoryNorm].join(" ")
      };
    });

    var total = Math.max(1, prepared.length);
    var documentCounts = {};

    terms.forEach(function (term) {
      var count = 0;
      prepared.forEach(function (item) {
        if (item.haystack.indexOf(term) !== -1) count += 1;
      });
      documentCounts[term] = count;
    });

    // 질문에 드문 고유명사/전문어가 있으면, 그 말과 관련된 항목만 남긴다.
    // (예: '가면춤' 질문에 '의식'이라는 흔한 말만 걸린 문법 항목을 제외)
    var hasRareTerm = terms.some(function (term) {
      return documentCounts[term] / total <= 0.05;
    });

    var scored = [];

    prepared.forEach(function (item) {
      var score = 0;
      var matchedRare = false;
      var matchedCategory = false;

      terms.forEach(function (term) {
        var weight = termLengthWeight(term) * termSpecificity(documentCounts[term], total);
        var matched = false;

        if (item.titleNorm.indexOf(term) !== -1) {
          score += 6 * weight;
          matched = true;
        } else if (item.titleTerms.some(function (titleTerm) {
          if (titleTerm === term) return true;
          if (titleTerm.length >= 3 && term.indexOf(titleTerm) !== -1) return true;
          if (term.length >= 3 && titleTerm.indexOf(term) !== -1) return true;
          return false;
        })) {
          score += 4 * weight;
          matched = true;
        }

        if (item.tagsNorm.indexOf(term) !== -1) {
          score += 3 * weight;
          matched = true;
        }
        if (item.categoryNorm.indexOf(term) !== -1) {
          score += 3 * weight;
          matched = true;
          matchedCategory = true;
        }
        if (item.claimNorm.indexOf(term) !== -1) {
          score += 1 * weight;
          matched = true;
        }

        if (matched && documentCounts[term] / total <= 0.05) {
          matchedRare = true;
        }
      });

      if (normalizedQuery.length >= 3) {
        if (item.titleNorm.indexOf(normalizedQuery) !== -1) score += 8;
        if (item.claimNorm.indexOf(normalizedQuery) !== -1) score += 6;
      }

      if (score > 0) {
        scored.push({
          entry: item.entry,
          score: score,
          matchedRare: matchedRare,
          matchedCategory: matchedCategory
        });
      }
    });

    if (hasRareTerm) {
      scored = scored.filter(function (item) {
        return item.matchedRare || item.matchedCategory;
      });
    }

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      var rankA = STATUS_RANK[a.entry.s] == null ? 8 : STATUS_RANK[a.entry.s];
      var rankB = STATUS_RANK[b.entry.s] == null ? 8 : STATUS_RANK[b.entry.s];
      if (rankA !== rankB) return rankA - rankB;
      return safeString(a.entry.t).localeCompare(safeString(b.entry.t), "ko");
    });

    if (!scored.length) return [];

    /*
      가장 관련 깊은 항목의 점수에 비해 너무 낮은 항목은 보내지 않는다.
      단, '음악'처럼 분야 자체를 묻는 질문은 최소 3점을 유지한다.
    */
    var threshold = Math.max(3, Math.floor(scored[0].score * 0.3));
    var filtered = scored.filter(function (item) {
      return item.score >= threshold;
    });

    return filtered.slice(0, maxItems).map(function (item) {
      return item.entry;
    });
  }

  // Edge Function으로 보낼 압축된 참고자료. 상태(s)를 반드시 포함한다.
  function toPayload(entries) {
    return (entries || []).slice(0, 6).map(function (entry) {
      return {
        id: truncate(entry.id, 80),
        t: truncate(entry.t, 120),
        s: STATUS_LABEL[entry.s] ? entry.s : "Unknown",
        c: truncate(entry.c, 40),
        claim: truncate(entry.claim, 700)
      };
    });
  }

  // 기존 배포본 Edge Function도 읽을 수 있도록 사용자 메시지 뒤에 붙이는 짧은 블록.
  function toBrief(entries, maxItems) {
    var picked = (entries || []).slice(0, maxItems || 3);
    if (!picked.length) return "";

    var lines = [
      "[[NYEKORA_LORE_BRIEF]]",
      "[기록관 참고 자료 — 확정 여부를 구분해서 다뤄 주세요]"
    ];

    picked.forEach(function (entry) {
      lines.push(
        "- (" + (STATUS_LABEL[entry.s] || "미확인") + " " + safeString(entry.s || "Unknown") + ") " +
        truncate(entry.t, 30) + ": " + truncate(entry.claim, 100)
      );
    });

    lines.push(
      "규칙: Canon(확정)만 사실로 단정하고, Proposal(제안)·Unknown(미확인)·Conflict(충돌)는 " +
      "아직 확정되지 않았거나 자료가 충돌 중이라고 밝혀 주세요. 자료에 없는 내용은 지어내지 마세요."
    );
    lines.push("[[/NYEKORA_LORE_BRIEF]]");

    return lines.join("\n");
  }

  function toRefs(entries, maxItems) {
    return (entries || []).slice(0, maxItems || 3).map(function (entry) {
      return {
        id: truncate(entry.id, 80),
        t: truncate(entry.t, 120),
        s: STATUS_LABEL[entry.s] ? entry.s : "Unknown"
      };
    });
  }

  function getRelevant(query, options) {
    var opts = options || {};
    var items = selectRelevant(query, opts.limit || 6);
    return {
      items: items,
      payload: toPayload(items),
      brief: toBrief(items, opts.briefLimit || 3),
      refs: toRefs(items, opts.refLimit || 3)
    };
  }

  global.NyekoraLore = {
    ARCHIVE_DB_KEY: ARCHIVE_DB_KEY,
    statusLabel: STATUS_LABEL,
    getEntries: getEntries,
    selectRelevant: selectRelevant,
    toPayload: toPayload,
    toBrief: toBrief,
    toRefs: toRefs,
    getRelevant: getRelevant,
    _normalize: normalize,
    _queryTerms: queryTerms
  };
})(typeof window !== "undefined" ? window : this);
