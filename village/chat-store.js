/*
  니에코라 마을 대화 영구 저장소

  - 기존 기록관과 같은 local-first 방식(localStorage)을 사용한다.
  - 저장 형식: { version: 1, npcId, messages: [...], updatedAt }
  - 각 메시지는 발화자(speaker), 발화자 이름(name), 대사(text), 시간(createdAt)을 가진다.
  - 같은 id 또는 같은 (발화자, 대사, 시간) 조합은 중복 저장하지 않는다.
  - 예전 형식(배열, {conversation: [...]}, {role, content})도 읽을 수 있다.
  - 저장 데이터를 읽지 못하면 원문을 :corrupt 키에 보존한 뒤 빈 목록을 돌려준다.
  - 이 파일은 기존 기록관 데이터(localStorage["nyekora-archive:v1:db"])를 건드리지 않는다.
*/
(function (global) {
  "use strict";

  var DEFAULT_KEY = "nyekora-village:chat:v1:ruwata";

  function nowIso() {
    return new Date().toISOString();
  }

  function safeText(value) {
    return value == null ? "" : String(value);
  }

  function makeId() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === "function") {
        return "m-" + global.crypto.randomUUID();
      }
    } catch (error) {
      // 아래 대체 id를 사용한다.
    }
    return "m-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function getStorage() {
    try {
      return global.localStorage || null;
    } catch (error) {
      return null;
    }
  }

  function speakerFrom(raw) {
    var speaker = safeText(raw.speaker).toLowerCase();
    var role = safeText(raw.role).toLowerCase();
    if (speaker === "npc" || speaker === "assistant" || speaker === "ruwata") return "npc";
    if (speaker === "user" || speaker === "human") return "user";
    if (role === "assistant") return "npc";
    return "user";
  }

  function roleFor(speaker) {
    return speaker === "npc" ? "assistant" : "user";
  }

  function normalizeRefs(rawRefs) {
    if (!Array.isArray(rawRefs)) return [];
    return rawRefs.slice(0, 6).map(function (ref) {
      if (!ref || typeof ref !== "object") return null;
      return {
        id: safeText(ref.id).slice(0, 80),
        t: safeText(ref.t || ref.title).slice(0, 120),
        s: safeText(ref.s || ref.status).slice(0, 20)
      };
    }).filter(function (ref) {
      return ref && (ref.id || ref.t);
    });
  }

  function isValidDate(value) {
    return !!value && !isNaN(Date.parse(value));
  }

  function normalizeMessage(raw) {
    if (!raw || typeof raw !== "object") return null;

    var text = safeText(raw.text != null ? raw.text : raw.content);
    if (!text) return null;

    var speaker = speakerFrom(raw);
    var createdAt = safeText(raw.createdAt || raw.t || raw.time);
    if (!isValidDate(createdAt)) createdAt = nowIso();

    return {
      id: safeText(raw.id) || makeId(),
      speaker: speaker,
      role: roleFor(speaker),
      name: safeText(raw.name).slice(0, 60) || (speaker === "npc" ? "Ruwata" : "사용자"),
      text: text,
      createdAt: createdAt,
      refs: normalizeRefs(raw.refs)
    };
  }

  function fingerprint(message) {
    return message.speaker + "\u0000" + message.text + "\u0000" + message.createdAt;
  }

  function dedupe(list) {
    var seenId = {};
    var seenFingerprint = {};
    var out = [];

    (list || []).forEach(function (raw) {
      var message = normalizeMessage(raw);
      if (!message) return;

      var fp = fingerprint(message);
      if (seenId[message.id] || seenFingerprint[fp]) return;

      seenId[message.id] = true;
      seenFingerprint[fp] = true;
      out.push(message);
    });

    return out;
  }

  function fromData(data) {
    if (!data) return [];
    if (Array.isArray(data)) return dedupe(data);
    if (Array.isArray(data.messages)) return dedupe(data.messages);
    if (Array.isArray(data.conversation)) return dedupe(data.conversation);
    return [];
  }

  function preserveCorrupt(storage, key, raw) {
    if (!storage || !raw) return;
    try {
      var backupKey = key + ":corrupt";
      if (!storage.getItem(backupKey)) {
        storage.setItem(backupKey, raw);
      }
    } catch (error) {
      // 보존에 실패해도 읽기 자체는 계속한다.
    }
  }

  function load(key) {
    key = key || DEFAULT_KEY;
    var storage = getStorage();
    if (!storage) {
      return { ok: false, messages: [], error: "브라우저 저장소를 사용할 수 없습니다." };
    }

    var raw;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      return { ok: false, messages: [], error: "저장된 대화를 읽지 못했습니다." };
    }

    if (!raw) return { ok: true, messages: [], error: "" };

    var data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      preserveCorrupt(storage, key, raw);
      return { ok: false, messages: [], error: "저장된 대화 형식이 올바르지 않아 원문을 보존했습니다." };
    }

    return { ok: true, messages: fromData(data), error: "" };
  }

  function save(key, npcId, messages) {
    key = key || DEFAULT_KEY;
    var storage = getStorage();
    if (!storage) {
      return { ok: false, messages: dedupe(messages), error: "브라우저 저장소를 사용할 수 없습니다." };
    }

    var clean = dedupe(messages);
    var payload = {
      version: 1,
      npcId: npcId || "ruwata",
      messages: clean,
      updatedAt: nowIso()
    };

    try {
      storage.setItem(key, JSON.stringify(payload));
      return { ok: true, messages: clean, error: "" };
    } catch (error) {
      return { ok: false, messages: clean, error: "대화 저장 공간이 부족합니다." };
    }
  }

  function makeMessage(speaker, text, refs, name) {
    return normalizeMessage({
      id: makeId(),
      speaker: speaker,
      text: text,
      name: name,
      createdAt: nowIso(),
      refs: refs || []
    });
  }

  function append(key, npcId, message) {
    key = key || DEFAULT_KEY;

    var current = load(key);
    var list = current.messages.slice();
    var normalized = normalizeMessage(message);

    if (!normalized) {
      return {
        ok: false,
        messages: list,
        added: null,
        error: "빈 메시지는 저장하지 않습니다."
      };
    }

    var duplicate = list.some(function (existing) {
      return existing.id === normalized.id || fingerprint(existing) === fingerprint(normalized);
    });

    if (!duplicate) list.push(normalized);

    var result = save(key, npcId, list);
    return {
      ok: result.ok,
      messages: result.messages,
      added: duplicate ? null : normalized,
      error: result.error
    };
  }

  global.NyekoraChatStore = {
    DEFAULT_KEY: DEFAULT_KEY,
    load: load,
    save: save,
    append: append,
    makeMessage: makeMessage,
    normalizeMessage: normalizeMessage,
    dedupe: dedupe
  };
})(typeof window !== "undefined" ? window : this);
