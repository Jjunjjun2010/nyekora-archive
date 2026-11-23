(function (global) {
  "use strict";

  var CFG = global.NYEKORA_CLOUD || {};
  var TABLE = "village_chats";
  var MEMORY_PREFIX = "nyekora-village:memory:v1:";
  var PUSH_DELAY = 700;
  var RETRY_MS = 15000;

  var LABEL = {
    off: "로컬 전용",
    signedout: "로그인하면 동기화",
    syncing: "동기화 중…",
    synced: "클라우드 동기화됨",
    dirty: "동기화 대기",
    error: "동기화 오류"
  };

  var opts = {};
  var listeners = [];
  var S = {
    on: false,
    sb: null,
    uid: null,
    npcId: "ruwata",
    ver: 0,
    dirty: false,
    status: "off",
    msg: "",
    at: "",
    timer: null,
    retry: null,
    seq: 0,
    lastPull: 0
  };

  function safeText(value) {
    return value == null ? "" : String(value);
  }

  function chatStore() {
    return global.NyekoraChatStore || null;
  }

  function hasMemory(memory) {
    return !!(memory && (memory.summary || (Array.isArray(memory.facts) && memory.facts.length)));
  }

  function normalizeMemory(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var facts = [];
    var seen = {};

    if (Array.isArray(source.facts)) {
      source.facts.forEach(function (fact) {
        var text = safeText(fact).trim().slice(0, 200);
        if (!text || seen[text] || facts.length >= 12) return;
        seen[text] = true;
        facts.push(text);
      });
    }

    var count = typeof source.summarizedCount === "number" && isFinite(source.summarizedCount)
      ? Math.max(0, Math.floor(source.summarizedCount))
      : 0;

    return {
      summary: safeText(source.summary).trim().slice(0, 1200),
      facts: facts,
      lastSummarizedAt: safeText(source.lastSummarizedAt),
      summarizedCount: count
    };
  }

  function memoryKey() {
    return MEMORY_PREFIX + (S.npcId || "ruwata");
  }

  function readMemory() {
    try {
      var raw = global.localStorage.getItem(memoryKey());
      return normalizeMemory(raw ? JSON.parse(raw) : null);
    } catch (error) {
      return normalizeMemory(null);
    }
  }

  function writeMemory(memory) {
    try {
      global.localStorage.setItem(memoryKey(), JSON.stringify(normalizeMemory(memory)));
    } catch (error) {
      // 저장 공간이 부족해도 대화 자체는 계속 진행한다.
    }
  }

  function timeValue(message) {
    var time = Date.parse(message && message.createdAt);
    return isNaN(time) ? 0 : time;
  }

  function sortMessages(list) {
    return (list || []).slice().sort(function (a, b) {
      var diff = timeValue(a) - timeValue(b);
      if (diff !== 0) return diff;
      return safeText(a && a.id).localeCompare(safeText(b && b.id));
    });
  }

  function normalizeMessages(list) {
    var store = chatStore();
    var normalized = store ? store.dedupe(list || []) : (list || []).slice();
    return sortMessages(normalized);
  }

  function mergeMessages(local, remote) {
    return normalizeMessages((local || []).concat(remote || []));
  }

  function mergeMemory(local, remote) {
    var left = normalizeMemory(local);
    var right = normalizeMemory(remote);
    var useRight = (Date.parse(right.lastSummarizedAt) || 0) >= (Date.parse(left.lastSummarizedAt) || 0);
    var primary = useRight ? right : left;
    var summary = primary.summary || right.summary || left.summary;
    var facts = [];
    var seen = {};

    (useRight ? left.facts.concat(right.facts) : right.facts.concat(left.facts)).forEach(function (fact) {
      if (seen[fact] || facts.length >= 12) return;
      seen[fact] = true;
      facts.push(fact);
    });

    return {
      summary: summary,
      facts: facts,
      lastSummarizedAt: primary.lastSummarizedAt,
      summarizedCount: Math.max(left.summarizedCount, right.summarizedCount)
    };
  }

  function messageSignature(message) {
    return [
      safeText(message && message.id),
      safeText(message && message.speaker),
      safeText(message && message.role),
      safeText(message && message.name),
      safeText(message && message.text),
      safeText(message && message.createdAt),
      JSON.stringify((message && message.refs) || [])
    ].join("\u0000");
  }

  function messagesSignature(list) {
    return (list || []).map(messageSignature).join("\u0001");
  }

  function memorySignature(memory) {
    var normalized = normalizeMemory(memory);
    return JSON.stringify(normalized);
  }

  function readLocalMessages() {
    var store = chatStore();
    if (store && opts.storageKey) {
      try {
        return normalizeMessages(store.load(opts.storageKey).messages);
      } catch (error) {
        return [];
      }
    }
    if (typeof opts.getMessages === "function") {
      try {
        return normalizeMessages(opts.getMessages());
      } catch (error) {
        return [];
      }
    }
    return [];
  }

  function writeLocalMessages(messages) {
    var store = chatStore();
    if (!store || !opts.storageKey) return;
    try {
      store.save(opts.storageKey, S.npcId, messages);
    } catch (error) {
      // 로컬 저장에 실패해도 메모리 상태는 유지한다.
    }
  }

  function applyLocal(messages, memory) {
    writeLocalMessages(messages);
    writeMemory(memory);
    if (typeof opts.onMessages === "function") {
      try {
        opts.onMessages(messages.slice());
      } catch (error) {
        // 화면 갱신 실패는 동기화를 막지 않는다.
      }
    }
    if (typeof opts.onMemory === "function") {
      try {
        opts.onMemory(normalizeMemory(memory));
      } catch (error) {
        // 위와 같다.
      }
    }
  }

  function snapshot() {
    return {
      status: S.status,
      msg: S.msg,
      uid: S.uid,
      at: S.at,
      ver: S.ver,
      on: S.on,
      dirty: S.dirty
    };
  }

  function emit() {
    var state = snapshot();
    listeners.forEach(function (listener) {
      try {
        listener(state);
      } catch (error) {
        // 개별 리스너 오류는 무시한다.
      }
    });
    if (typeof opts.onStatus === "function") {
      try {
        opts.onStatus(state);
      } catch (error) {
        // 위와 같다.
      }
    }
  }

  function setStatus(status, msg) {
    S.status = status;
    S.msg = msg || "";
    emit();
  }

  function label() {
    return LABEL[S.status] || "";
  }

  function markSynced(version, at) {
    S.ver = version;
    S.dirty = false;
    S.at = at || "";
    setStatus("synced");
  }

  function fail(prefix, error) {
    S.dirty = true;
    var message = error && (error.message || error.error_description)
      ? (error.message || error.error_description)
      : String(error || "");
    setStatus("error", prefix + (message ? ": " + message.slice(0, 160) : ""));

    var code = error && (error.code || error.status);
    if (code === "42501" || code === 401 || code === "PGRST301") return;

    if (S.retry) global.clearTimeout(S.retry);
    S.retry = global.setTimeout(function () {
      if (S.uid) flush();
    }, RETRY_MS);
  }

  function pushSnapshot(messages, memory) {
    if (!S.sb || !S.uid) {
      S.dirty = true;
      return Promise.resolve();
    }

    var seq = S.seq;
    var cleanMessages = normalizeMessages(messages);
    var cleanMemory = normalizeMemory(memory);
    var stamp = new Date().toISOString();
    var payload = {
      messages: cleanMessages,
      memory: cleanMemory,
      version: S.ver + 1,
      updated_at: stamp
    };
    var request;

    setStatus("syncing", "저장 중…");

    if (!S.ver) {
      payload.owner_id = S.uid;
      payload.npc_id = S.npcId;
      payload.version = 1;
      request = S.sb.from(TABLE).insert(payload).select("version,updated_at");
    } else {
      request = S.sb.from(TABLE)
        .update(payload)
        .eq("owner_id", S.uid)
        .eq("npc_id", S.npcId)
        .eq("version", S.ver)
        .select("version,updated_at");
    }

    return request.then(function (res) {
      if (res.error) {
        if (String(res.error.code) === "23505") return pull();
        throw res.error;
      }
      if (!res.data || !res.data.length) return pull();

      var row = res.data[0];
      S.ver = typeof row.version === "number" ? row.version : S.ver + 1;
      S.at = row.updated_at || stamp;
      S.dirty = S.seq !== seq;

      if (S.dirty) {
        setStatus("dirty", "변경 사항을 다시 저장합니다.");
        schedule();
      } else {
        markSynced(S.ver, S.at);
      }
    }, function (error) {
      fail("저장 실패", error);
    });
  }

  function pull() {
    if (!S.sb || !S.uid) return Promise.resolve();

    S.lastPull = Date.now();
    setStatus("syncing", "불러오는 중…");

    var localMessages = readLocalMessages();
    var localMemory = readMemory();

    return S.sb.from(TABLE)
      .select("messages,memory,version,updated_at")
      .eq("owner_id", S.uid)
      .eq("npc_id", S.npcId)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;

        var row = res.data;
        if (!row) {
          S.ver = 0;
          if (localMessages.length || hasMemory(localMemory)) return pushSnapshot(localMessages, localMemory);
          markSynced(0, "");
          return;
        }

        var remoteMessages = normalizeMessages(row.messages);
        var remoteMemory = normalizeMemory(row.memory);

        var currentMessages = readLocalMessages();
        if (messagesSignature(currentMessages) !== messagesSignature(localMessages)) {
          localMessages = currentMessages;
          localMemory = readMemory();
        }

        var mergedMessages = mergeMessages(localMessages, remoteMessages);
        var mergedMemory = mergeMemory(localMemory, remoteMemory);

        S.ver = typeof row.version === "number" ? row.version : 1;

        var localChanged =
          messagesSignature(localMessages) !== messagesSignature(mergedMessages) ||
          memorySignature(localMemory) !== memorySignature(mergedMemory);
        if (localChanged) applyLocal(mergedMessages, mergedMemory);

        var remoteChanged =
          messagesSignature(remoteMessages) !== messagesSignature(mergedMessages) ||
          memorySignature(remoteMemory) !== memorySignature(mergedMemory);
        if (remoteChanged) return pushSnapshot(mergedMessages, mergedMemory);

        markSynced(S.ver, row.updated_at);
      })
      .then(null, function (error) {
        fail("불러오기 실패", error);
      });
  }

  function schedule() {
    if (!S.on) return;

    S.seq += 1;
    S.dirty = true;

    if (!S.uid) {
      setStatus("signedout");
      return;
    }

    if (S.timer) global.clearTimeout(S.timer);
    S.timer = global.setTimeout(function () {
      S.timer = null;
      pushSnapshot(readLocalMessages(), readMemory());
    }, PUSH_DELAY);
  }

  function flush() {
    if (!S.uid) return;
    pushSnapshot(readLocalMessages(), readMemory());
  }

  function setMemory(memory) {
    var normalized = normalizeMemory(memory);
    writeMemory(normalized);
    if (typeof opts.onMemory === "function") {
      try {
        opts.onMemory(normalized);
      } catch (error) {
        // 화면 갱신 실패는 동기화를 막지 않는다.
      }
    }
    schedule();
  }

  function onOnline() {
    if (!S.uid) return;
    if (S.dirty) flush();
    else pull();
  }

  function onFocus() {
    if (!S.uid || S.status === "syncing") return;
    if (Date.now() - S.lastPull < 20000) return;
    pull();
  }

  function bindSession() {
    S.sb.auth.onAuthStateChange(function (event, session) {
      if (event === "SIGNED_OUT") {
        S.uid = null;
        S.ver = 0;
        S.dirty = false;
        setStatus("signedout");
        return;
      }
      if (session && session.user && session.user.id !== S.uid) {
        S.uid = session.user.id;
        S.ver = 0;
        pull();
      }
    });

    S.sb.auth.getSession().then(function (res) {
      var session = res && res.data ? res.data.session : null;
      if (session && session.user) {
        S.uid = session.user.id;
        pull();
      } else {
        setStatus("signedout");
      }
    }, function () {
      setStatus("error", "로그인 세션을 읽지 못했습니다.");
    });
  }

  function init(options) {
    opts = options || {};
    S.npcId = opts.npcId || "ruwata";

    if (typeof opts.onMemory === "function") {
      try {
        opts.onMemory(readMemory());
      } catch (error) {
        // 초기 기억 표시 실패는 무시한다.
      }
    }
    emit();

    if (!CFG.url || !CFG.anonKey) {
      S.on = false;
      setStatus("off");
      return;
    }
    if (!global.supabase || !global.supabase.createClient) {
      setStatus("error", "Supabase 라이브러리를 불러오지 못했습니다. 로컬 저장은 계속 작동합니다.");
      return;
    }

    try {
      S.sb = global.supabase.createClient(CFG.url, CFG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    } catch (error) {
      setStatus("error", "클라우드 설정(URL/키)을 확인해 주세요.");
      return;
    }

    S.on = true;
    bindSession();

    global.addEventListener("online", onOnline);
    global.addEventListener("focus", onFocus);
    if (global.document) {
      global.document.addEventListener("visibilitychange", function () {
        if (!global.document.hidden) onFocus();
      });
    }
  }

  global.NyekoraChatSync = {
    init: init,
    schedule: schedule,
    pull: pull,
    flush: flush,
    setMemory: setMemory,
    readMemory: readMemory,
    normalizeMemory: normalizeMemory,
    mergeMessages: mergeMessages,
    mergeMemory: mergeMemory,
    status: snapshot,
    label: label,
    onStatus: function (listener) {
      if (typeof listener !== "function") return function () {};
      listeners.push(listener);
      return function () {
        listeners = listeners.filter(function (item) {
          return item !== listener;
        });
      };
    }
  };
})(typeof window !== "undefined" ? window : this);
