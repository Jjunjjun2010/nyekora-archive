/* Nyekora Archive — 클라우드 동기화 (Supabase)
   - 설정은 cloud-config.js 에서 합니다. (service_role 키는 절대 넣지 마세요)
   - 편집 내용(브라우저 저장 데이터 전체)을 "내 계정 한 칸(nyekora_archive 표의 내 행)"에 저장합니다.
   - 로그인하지 않아도 기존처럼 이 브라우저에는 저장됩니다. */
(function () {
  "use strict";
  var CFG = window.NYEKORA_CLOUD || {};
  var META = "nyekora-archive:v1:sync";
  var KB_ = "nyekora-archive:v1:autobackups";
  var CL = { on: false, sb: null, uid: null, email: "", status: "off", msg: "", ver: 0, dirty: false, at: "",
             conflict: null, seq: 0, applying: false, timer: null, retry: null, authMsg: "", lastPull: 0 };
  window.CL = CL;

  var memMeta = {}, chain = Promise.resolve();
  function q(fn) { chain = chain.then(fn).catch(function (e) { fail("동기화 실패", e); }); return chain; }
  function fail(prefix, e) {
    var m = (e && (e.message || e.error_description)) || String(e);
    setS("error", prefix + ": " + friendly(m));
    if (CL.retry) clearTimeout(CL.retry);
    CL.retry = setTimeout(function () { if (CL.uid) q(function () { return CL.dirty ? push() : pull(); }); }, 15000);
  }
  function readMeta() { try { var r = localStorage.getItem(META); return r ? JSON.parse(r) : memMeta; } catch (e) { return memMeta; } }
  function writeMeta(m) { memMeta = m; try { localStorage.setItem(META, JSON.stringify(m)); } catch (e) {} }
  var canon = function (o) {
    return JSON.stringify(o, function (k, v) {
      return v && typeof v === "object" && !Array.isArray(v)
        ? Object.keys(v).sort().reduce(function (a, x) { a[x] = v[x]; return a; }, {}) : v;
    });
  };
  var hasLocal = function (d) { return Object.keys(d.ent).length + Object.keys(d.del).length + d.log.length > 0; };
  var valid = function (d) { return d && d.v === 1 && d.ent && typeof d.ent === "object" && d.del && typeof d.del === "object" && Array.isArray(d.log); };
  var unwrap = function (x) { return x && x.db ? x.db : x; };
  function abkData(why, data) {
    try {
      var a = JSON.parse(localStorage.getItem(KB_) || "[]");
      a.unshift({ t: new Date().toISOString(), why: why, db: JSON.parse(JSON.stringify(data)) });
      localStorage.setItem(KB_, JSON.stringify(a.slice(0, 3)));
    } catch (e) {}
  }

  var LABEL = { off: "☁ 로컬 전용", signedout: "☁ 로그인 필요", syncing: "☁ 저장 중…", synced: "☁ 동기화됨",
                dirty: "☁ 변경 있음", error: "☁ 오류", conflict: "☁ 충돌" };
  window.cloudNavLabel = function () { return LABEL[CL.status] || "☁"; };
  function when(t) { try { return new Date(t).toLocaleString("ko-KR"); } catch (e) { return String(t); } }
  function statusHtml() {
    var h = "<b>" + esc(LABEL[CL.status] || "") + "</b>";
    if (CL.msg) h += " — " + esc(CL.msg);
    if (CL.at && CL.uid) h += '<br><span class="lc">마지막 동기화: ' + esc(when(CL.at)) + " · 클라우드 버전 " + CL.ver + "</span>";
    if (CL.conflict) {
      h += '<div class="bar"><button class="btn" onclick="cloudUseCloud()">클라우드 내용 사용</button>' +
           '<button class="btn2 dg" onclick="cloudUseLocal()">이 컴퓨터 내용으로 덮어쓰기</button></div>' +
           '<p class="lc">선택하지 않은 쪽 내용은 관리 화면의 ‘자동 백업’에 남습니다. (클라우드: ' + esc(when(CL.conflict.at)) +
           " / 이 컴퓨터: 수정·추가 " + Object.keys(DB.ent).length + "개, 이력 " + DB.log.length + "건)</p>";
    }
    return h;
  }
  function paint() {
    var n = document.getElementById("cloud-nav"); if (n) n.textContent = window.cloudNavLabel();
    var s = document.getElementById("cloud-status"); if (s) s.innerHTML = statusHtml();
  }
  function setS(st, msg) { CL.status = st; CL.msg = msg || ""; paint(); }
  function paintAuth() { var m = document.getElementById("cl-msg"); if (m) m.textContent = CL.authMsg; }

  function friendly(m) {
    m = String(m || "");
    if (/Invalid login credentials/i.test(m)) return "이메일 또는 비밀번호가 맞지 않습니다.";
    if (/Email not confirmed/i.test(m)) return "이메일 확인이 끝나지 않았습니다. 확인 메일의 링크를 누르거나 Supabase에서 ‘Confirm email’을 꺼 주세요.";
    if (/already registered|already been registered/i.test(m)) return "이미 만든 계정입니다. ‘로그인’을 눌러 주세요.";
    if (/sign.?ups? (not allowed|are disabled|disabled)|Signups not allowed/i.test(m)) return "새 계정 만들기가 꺼져 있습니다. 이미 계정을 만드셨다면 정상이니 ‘로그인’을 눌러 주세요.";
    if (/at least \d+ characters/i.test(m)) return "비밀번호가 너무 짧습니다.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "인터넷 연결이나 Supabase 주소(URL)를 확인해 주세요.";
    if (/Invalid API key|apikey|JWT/i.test(m)) return "Supabase 키가 올바르지 않습니다. cloud-config.js의 키를 확인해 주세요.";
    if (/does not exist|schema cache|Could not find the table/i.test(m)) return "Supabase에 표가 아직 없습니다. supabase/setup.sql을 SQL Editor에서 실행해 주세요.";
    if (/row-level security|permission denied/i.test(m)) return "권한 오류입니다. supabase/setup.sql의 보안 규칙이 적용됐는지 확인해 주세요.";
    return m;
  }

  function markSynced(v, at) {
    CL.ver = v; CL.dirty = false; CL.at = at || new Date().toISOString();
    writeMeta({ uid: CL.uid, ver: v, dirty: false, at: CL.at });
    setS("synced", "");
  }
  function applyCloud(cdb, v, at, msg) {
    if (hasLocal(DB)) abk("클라우드 불러오기 전");
    CL.applying = true; DB = cdb; save(); CL.applying = false;
    rebuild(); MODE = null; FM = null;
    markSynced(v, at); FL = msg; route();
  }

  async function pull() {
    CL.lastPull = Date.now(); setS("syncing", "불러오는 중…");
    var r = await CL.sb.from("nyekora_archive").select("data,version,updated_at").eq("owner_id", CL.uid).maybeSingle();
    if (r.error) throw r.error;
    var row = r.data, m = readMeta(), mine = m.uid === CL.uid;
    if (!row) {
      CL.ver = 0;
      if (hasLocal(DB)) return push();
      markSynced(0, ""); CL.at = ""; paint(); return;
    }
    var cdb = unwrap(row.data);
    if (!valid(cdb)) throw new Error("클라우드 데이터 형식이 올바르지 않습니다.");
    var cv = row.version;
    if (mine && m.ver === cv) {
      CL.ver = cv;
      if (m.dirty) return push();
      markSynced(cv, row.updated_at); return;
    }
    if (mine && m.ver < cv && !m.dirty) { applyCloud(cdb, cv, row.updated_at, "클라우드에서 새 내용을 불러왔습니다."); return; }
    if (!mine || m.ver > cv) {
      if (!hasLocal(DB)) { applyCloud(cdb, cv, row.updated_at, "클라우드 내용을 불러왔습니다."); return; }
      if (canon(DB) === canon(cdb)) { markSynced(cv, row.updated_at); return; }
    }
    CL.conflict = { cdb: cdb, cv: cv, at: row.updated_at };
    setS("conflict", "이 컴퓨터의 변경과 클라우드 내용이 서로 다릅니다. 어느 쪽을 쓸지 선택해 주세요.");
  }

  async function push() {
    if (!CL.sb || !CL.uid || CL.status === "conflict") return;
    var seq = CL.seq, payload = { schema: 1, db: DB }, stamp = new Date().toISOString(), nv;
    setS("syncing", "저장 중…");
    if (CL.ver === 0) {
      var ins = await CL.sb.from("nyekora_archive").insert({ owner_id: CL.uid, data: payload, version: 1, updated_at: stamp });
      if (ins.error) { if (String(ins.error.code) === "23505") return pull(); throw ins.error; }
      nv = 1;
    } else {
      var up = await CL.sb.from("nyekora_archive").update({ data: payload, version: CL.ver + 1, updated_at: stamp })
        .eq("owner_id", CL.uid).eq("version", CL.ver).select("version");
      if (up.error) throw up.error;
      if (!up.data || up.data.length === 0) return pull();
      nv = CL.ver + 1;
    }
    var again = CL.seq !== seq;
    CL.ver = nv; CL.at = stamp; CL.dirty = again;
    writeMeta({ uid: CL.uid, ver: nv, dirty: again, at: stamp });
    if (again) { setS("dirty", ""); CL.timer = setTimeout(function () { q(push); }, 300); } else setS("synced", "");
  }

  window.cloudAfterSave = function () {
    if (CL.applying || !CFG.url) return;
    CL.seq++;
    var m = readMeta();
    if (!CL.uid) { writeMeta(Object.assign({}, m, { dirty: true })); return; }
    writeMeta({ uid: CL.uid, ver: CL.ver, dirty: true, at: m.at || "" });
    CL.dirty = true;
    if (CL.status === "conflict") return;
    setS("dirty", "");
    clearTimeout(CL.timer);
    CL.timer = setTimeout(function () { q(push); }, 700);
  };

  window.cloudInit = async function () {
    if (!CFG.url || !CFG.anonKey) { setS("off"); return; }
    if (!window.supabase || !window.supabase.createClient) {
      setS("error", "Supabase 라이브러리를 불러오지 못했습니다. 로컬 저장은 계속 작동합니다."); return;
    }
    try {
      CL.sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    } catch (e) { setS("error", "클라우드 설정(URL/키)을 확인해 주세요: " + e.message); return; }
    CL.on = true;
    CL.sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") { CL.uid = null; CL.email = ""; setS("signedout"); } });
    var s = await CL.sb.auth.getSession();
    if (s.error || !s.data || !s.data.session) { setS("signedout"); }
    else { CL.uid = s.data.session.user.id; CL.email = s.data.session.user.email || ""; q(pull); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) onFocus(); });
  };
  function onFocus() {
    if (!CL.uid || CL.conflict || CL.dirty || (typeof FM !== "undefined" && FM) || (typeof MODE !== "undefined" && MODE)) return;
    if (Date.now() - CL.lastPull < 20000) return;
    q(pull);
  }

  async function auth(kind) {
    var email = ((document.getElementById("cl-email") || {}).value || "").trim(), pw = (document.getElementById("cl-pw") || {}).value || "";
    CL.email = email;
    if (!email || pw.length < 6) { CL.authMsg = "이메일과 비밀번호(6자 이상)를 입력해 주세요."; paintAuth(); return; }
    CL.authMsg = "처리 중…"; paintAuth();
    try {
      var r = kind === "up" ? await CL.sb.auth.signUp({ email: email, password: pw }) : await CL.sb.auth.signInWithPassword({ email: email, password: pw });
      if (r.error) { CL.authMsg = friendly(r.error.message); paintAuth(); return; }
      var sess = r.data && r.data.session;
      if (!sess) { CL.authMsg = "가입 요청이 접수되었습니다. 확인 메일의 링크를 누른 뒤 ‘로그인’을 눌러 주세요. (Supabase에서 ‘Confirm email’을 끄면 이 단계가 없어집니다.)"; paintAuth(); return; }
      CL.uid = sess.user.id; CL.email = sess.user.email || email; CL.authMsg = "";
      route();
      q(pull);
    } catch (e) { CL.authMsg = friendly(e.message); paintAuth(); }
  }
  window.cloudLogin = function (ev) { ev.preventDefault(); if (!CL.sb) return false; auth("in"); return false; };
  window.cloudSignup = function () { if (CL.sb) auth("up"); };
  window.cloudLogout = async function () {
    if (!CL.sb) return;
    try { await CL.sb.auth.signOut(); } catch (e) {}
    CL.uid = null; CL.email = ""; CL.conflict = null; CL.ver = 0; setS("signedout"); route();
  };
  window.cloudSyncNow = function () { if (!CL.uid) return; CL.lastPull = 0; q(function () { return CL.dirty && CL.status !== "conflict" ? push() : pull(); }); };
  window.cloudUseCloud = function () {
    var c = CL.conflict; if (!c) return;
    CL.conflict = null;
    q(async function () { applyCloud(c.cdb, c.cv, c.at, "클라우드 내용을 불러왔습니다. 이 컴퓨터의 이전 내용은 자동 백업에 남았습니다."); });
  };
  window.cloudUseLocal = function () {
    var c = CL.conflict; if (!c) return;
    abkData("덮어쓰기 전 클라우드 사본", { v: 1, ent: c.cdb.ent, del: c.cdb.del, log: c.cdb.log });
    CL.conflict = null; CL.ver = c.cv; CL.dirty = true;
    writeMeta({ uid: CL.uid, ver: c.cv, dirty: true, at: c.at });
    setS("dirty", ""); q(push);
  };

  window.cloudView = function () {
    var head = '<main><div class="crumb"><a href="#">처음</a> / 클라우드</div><h2>클라우드 저장</h2><div id="cloud-status" class="note">' + statusHtml() + "</div>";
    if (!CFG.url || !CFG.anonKey) {
      return head + '<div class="box"><h3>아직 연결되지 않았습니다</h3><p>이 사이트에는 클라우드(Supabase) 주소가 설정되어 있지 않아 지금은 이 브라우저에만 저장됩니다. ' +
        "저장소의 cloud-config.js 에 Supabase 프로젝트 URL과 키를 넣고 다시 올리면 켜집니다. 순서는 README.md 를 보세요.</p></div></main>";
    }
    if (!CL.uid) {
      return head + '<form class="box fm" onsubmit="return cloudLogin(event)"><h3>로그인</h3>' +
        '<label>이메일<input id="cl-email" type="email" autocomplete="username" value="' + esc(CL.email || "") + '"></label>' +
        '<label>비밀번호 (6자 이상)<input id="cl-pw" type="password" autocomplete="current-password"></label>' +
        '<p id="cl-msg" class="lc">' + esc(CL.authMsg) + "</p>" +
        '<div class="bar"><button class="btn" type="submit">로그인</button><button class="btn2" type="button" onclick="cloudSignup()">처음 한 번: 계정 만들기</button></div>' +
        '<p class="lc">로그인하면 편집 내용이 내 계정에 저장되어 다른 컴퓨터에서도 같은 내용으로 이어서 편집할 수 있습니다. 로그인하지 않아도 이 브라우저에는 지금처럼 저장됩니다.</p></form></main>';
    }
    return head + '<div class="box"><h3>내 계정</h3><p>' + esc(CL.email) + '</p><div class="bar"><button class="btn" onclick="cloudSyncNow()">지금 동기화</button>' +
      '<button class="btn2" onclick="cloudLogout()">로그아웃</button></div>' +
      '<p class="lc">로그아웃해도 이 컴퓨터의 편집 내용은 지워지지 않습니다. 로그인한 상태에서는 복구·초기화도 클라우드에 반영되니, 관리 화면에서 백업을 먼저 복사해 두세요.</p></div></main>';
  };
})();
