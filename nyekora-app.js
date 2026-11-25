// Nyekora Archive 화면·편집 코드 (데이터는 nyekora-data.js, 클라우드는 nyekora-cloud.js)
let E=SEED.slice();
window.getArchiveEntries=function(){return E};
const ST=["Canon","Proposal","Unknown","Conflict","Rejected"];
const SL={Canon:"확정",Proposal:"제안",Unknown:"미확인",Conflict:"충돌",Rejected:"거부"};
const SD={Canon:"",Proposal:"아직 확정되지 않은 제안입니다.",Unknown:"아직 확인되지 않은 내용입니다.",Conflict:"자료끼리 충돌하는 내용입니다.",Rejected:"검토 결과 공식 설정으로 채택되지 않은 기록입니다. 기록은 보존됩니다."};
let Q="",F="";
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const badge=s=>`<span class="badge ${s}">${s} · ${SL[s]}</span>`;
const cnt=s=>E.filter(e=>e.s===s).length;
const nres=()=>E.filter(e=>e.conf&&e.res).length;
function sbox(v){return `<form class="sb" role="search" onsubmit="return doSearch(event)"><input id="q" type="search" value="${esc(v)}" placeholder="설정 이름이나 내용을 검색" aria-label="검색"><button type="submit">검색</button></form>`}
function item(e){return `<a class="item" href="#${e.id}"><h3>${esc(e.t)} ${badge(e.s)}${e.rq?' <span class="badge Proposal">수정 요청됨</span>':""}</h3><p>${esc(e.claim)}</p></a>`}
function chips(a){return `<div class="chips" role="group" aria-label="상태별 보기"><button class="chip" aria-pressed="${F===""}" onclick="setF('')">전체</button>${ST.map(s=>`<button class="chip" aria-pressed="${F===s}" onclick="setF('${s}')">${s} (${a.filter(e=>e.s===s).length})</button>`).join("")}</div>`}
function setF(s){F=s;route()}
function doSearch(ev){ev.preventDefault();Q=$("#q").value.trim();if(location.hash==="#search")route();else location.hash="search";return false}
function home(){
return `<section class="hero"><svg class="step" width="64" height="40" viewBox="0 0 64 40" aria-hidden="true"><rect x="2" y="30" width="60" height="7" fill="#d6b25e"/><rect x="12" y="20" width="40" height="7" fill="#d6b25e"/><rect x="22" y="10" width="20" height="7" fill="#d6b25e"/><rect x="29" y="2" width="6" height="5" fill="#3cc1b3"/></svg>
<h1>니에코라 기록관</h1><p>동남아시아풍 판타지 문명 니에코라의 설정을, 확정 여부와 출처와 함께 기록합니다.</p>${sbox("")}</section>
<main><h2>분야별 보기</h2><div class="grid">${Object.keys(CATS).map(k=>{const n=E.filter(e=>e.c===k).length;return `<a class="cat" href="#${k}"><b>${CATS[k]}</b><span>${n?n+"개 항목":"자료 준비 중"}</span></a>`}).join("")}</div>
<h2 style="margin-top:34px">현재 기록 상태</h2><div class="sum">${ST.map(s=>`<div><strong>${cnt(s)}</strong>${badge(s)}</div>`).join("")}<div><strong>${nres()}</strong>해소된 충돌 이력</div></div>
<p class="note">전체 ${E.length}개 항목 중 현재 충돌 상태로 남은 항목은 ${cnt("Conflict")}개이며, 해소된 충돌 ${nres()}건은 상세 화면에 이력으로 남아 있습니다. <a href="#all">전체 기록 보기</a></p>
<p class="note">검토가 필요한 <b>제안 ${cnt("Proposal")}개</b>의 우선순위를 참고용으로 정리해 보았습니다. <a href="#priority">검토 우선순위 추천 보기</a></p></main>`}
function list(title,arr,extra){
const a=F?arr.filter(e=>e.s===F):arr;
return `<main><div class="crumb"><a href="#">처음</a> / ${esc(title)}</div><h2>${esc(title)}</h2>${sbox("")}${extra||""}${arr.length?chips(arr):""}${a.length?a.map(item).join(""):(arr.length?'<p class="note">조건에 맞는 항목이 없습니다.</p>':'<p class="note">자료 준비 중입니다. 아직 이 분야에 옮겨진 항목이 없습니다.</p>')}</main>`}
function search(){
const q=Q.toLowerCase();
const r=q?E.filter(e=>[e.t,e.claim,e.ex||"",e.id,e.tags.join(" "),CATS[e.c],e.s,SL[e.s]].join(" ").toLowerCase().includes(q)):[];
return `<main><div class="crumb"><a href="#">처음</a> / 검색</div><h2>검색 결과</h2>${sbox(Q)}<p class="note">“${esc(Q)}” ${q?`검색 결과 ${r.length}개`:"검색어를 입력해 주세요."}. 현재 기록된 ${E.length}개 항목 안에서만 찾습니다.</p>${r.map(item).join("")}</main>`}
const KEY="nyekora-archive:v1:db",KB="nyekora-archive:v1:autobackups",SEEDVER="2026-11-09-r1";
SRC["creator-decision-app"]="작성자 결정 (기록관 편집 기능)";

// notify 라우트 관련 상수
const NOTIFY_EMAIL_KEY = "nyekora-archive:notify:email";
const NOTIFY_PERIOD_KEY = "nyekora-archive:notify:period";
const NOTIFY_HOUR_KEY = "nyekora-archive:notify:hour";
const NOTIFY_DAY_KEY = "nyekora-archive:notify:day";
let DB={v:1,ent:{},del:{},log:[]},storeOk=true,FL="",MODE=null,FM=null,MG={},abDone=false;
const now=()=>new Date().toISOString(),clone=o=>JSON.parse(JSON.stringify(o));
const ymd=()=>{const d=new Date(),p=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())};
const fmt=t=>new Date(t).toLocaleString("ko-KR");
const go=h=>{if(location.hash.slice(1)===h)route();else location.hash=h};
function load(){try{localStorage.setItem("nyk:t","1");localStorage.removeItem("nyk:t");const r=localStorage.getItem(KEY);if(r){const d=JSON.parse(r);if(d&&d.v===1&&d.ent&&d.del&&Array.isArray(d.log))DB=d}}catch(x){storeOk=false}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(DB));storeOk=true}catch(x){storeOk=false}if(window.cloudAfterSave)cloudAfterSave()}
function abk(why){try{let a=JSON.parse(localStorage.getItem(KB)||"[]");a.unshift({t:now(),why,db:clone(DB)});localStorage.setItem(KB,JSON.stringify(a.slice(0,3)))}catch(x){}}
function abl(){try{return JSON.parse(localStorage.getItem(KB)||"[]")}catch(x){return[]}}
function rebuild(){const ids=new Set(),o=[];SEED.forEach(s=>{ids.add(s.id);if(!DB.del[s.id])o.push(DB.ent[s.id]||s)});Object.keys(DB.ent).forEach(i=>{if(!ids.has(i)&&!DB.del[i])o.push(DB.ent[i])});E=o}
const cur=id=>DB.ent[id]||SEED.find(s=>s.id===id);
function commit(type,id,b,a,why,fl){if(!abDone){abk("편집 시작 전");abDone=true}if(a)DB.ent[id]=clone(a);DB.log.push({n:DB.log.length+1,t:now(),type,id,b:b?clone(b):null,a:a?clone(a):null,why:why||""});save();rebuild();FL=fl||""}
function decide(n,to,lab,why){const f=n.s,m=ymd()+" "+lab+(f!==to?" ("+f+" → "+to+")":"")+": "+why;n.s=to;n.src=(n.src||[]).concat([["creator-decision-app",m]]);if(to==="Canon")n.v=1;n.dec=m}
const ACT={approve:{to:"Canon",lab:"승인"},reject:{to:"Rejected",lab:"거부"},revise:{to:"Proposal",lab:"수정 요청"},promote:{to:"Proposal",lab:"제안으로 전환"},resolve:{to:"",lab:"충돌 해소"},demote:{to:"Proposal",lab:"Canon 철회(제안으로)"},reopen:{to:"Proposal",lab:"다시 검토(제안으로)"},del:{lab:"삭제"}};
const TL={create:"새로 추가",edit:"편집",status:"상태 변경",approve:"승인",reject:"거부",revise:"수정 요청",promote:"제안으로 전환",resolve:"충돌 해소",demote:"Canon 철회",reopen:"다시 검토",delete:"삭제",restore:"복구",revert:"되돌림"};
const FLD={t:"제목",claim:"설명",c:"분야",tags:"태그",src:"출처",s:"상태",ex:"예시",v:"근거 수준",rq:"수정 요청",res:"해소 결과",dec:"결정 기록"};
const fv=(k,v)=>v==null||v===""?"(없음)":k==="c"?CATS[v]||v:k==="tags"?v.join(", "):k==="src"?v.map(s=>(SRC[s[0]]||s[0].replace("custom:",""))+" — "+s[1]).join("\n"):k==="v"?(v===1?"1차 자료":"2차 자료"):String(v);
const diff=l=>{const b=l.b||{},a=l.a||{};return Object.keys(FLD).filter(k=>JSON.stringify(b[k])!==JSON.stringify(a[k])).map(k=>`<div class="df"><b>${FLD[k]}</b><div class="bf">${esc(fv(k,b[k]))}</div><div class="af">${esc(fv(k,a[k]))}</div></div>`).join("")};
function hist(id){const L=DB.log.filter(l=>l.id===id).reverse();return `<details class="box"><summary><b>변경 이력 (${L.length}건)</b></summary>${L.length?L.map(l=>`<div class="lg"><b>${TL[l.type]||l.type}</b> · ${fmt(l.t)}${l.why?`<br>사유: ${esc(l.why)}`:""}${diff(l)}${l.b&&l.a?`<button class="btn2" onclick="revert(${l.n})">이 수정 전 상태로 되돌리기</button>`:""}</div>`).join(""):'<p class="lc">수정 이력이 없습니다. HTML에 내장된 원본과 같은 상태입니다.</p>'}</details>`}
function revert(n){const l=DB.log.find(x=>x.n===n);if(!l||!l.b)return;const b=cur(l.id);commit("revert",l.id,b,l.b,"이력 #"+n+" 수정 전 상태로 되돌림","되돌렸습니다.");route()}
function openAct(a,id){MODE={a,id};route()}
function panel(e){const A=ACT[MODE.a],er=MODE.err?`<p class="note err">${esc(MODE.err)}</p>`:"";
if(MODE.a==="del")return `<form class="box" onsubmit="return doDel(event,'${e.id}')"><h3>삭제 확인</h3>${er}<p>‘${esc(e.t)}’를 삭제하시겠습니까? 삭제해도 기록은 지워지지 않고 관리 화면의 ‘삭제된 항목’에서 복구할 수 있습니다.</p><label>삭제 사유 (선택)<textarea id="r-why" rows="2" class="big" style="min-height:50px"></textarea></label><div class="bar"><button class="btn2 dg" type="submit">삭제 확인</button><button class="btn2" type="button" onclick="MODE=null;route()">취소</button></div></form>`;
return `<form class="box" onsubmit="return doAct(event,'${e.id}')"><h3>${A.lab}</h3>${er}${MODE.a==="resolve"?'<label>해소 후 상태 <select id="r-to"><option value="Canon">Canon (확정)</option><option value="Proposal">Proposal (제안으로 정리)</option></select></label>':""}<label>${MODE.a==="resolve"?"해소 결과와 사유":"결정 사유 (선택)"}<textarea id="r-why" rows="3" class="big" style="min-height:70px"></textarea></label><div class="bar"><button class="btn" type="submit">${A.lab} 기록</button><button class="btn2" type="button" onclick="MODE=null;route()">취소</button></div></form>`}
function doAct(ev,id){ev.preventDefault();const why=$("#r-why").value.trim()||"사용자가 검토 후 공식 설정으로 승인함.";const e=cur(id),b=clone(e),n=clone(e),a=MODE.a;
if(a==="revise"){n.rq=why;n.dec=ymd()+" 수정 요청: "+why}else{const to=a==="resolve"?$("#r-to").value:ACT[a].to;if(a==="resolve"&&n.conf)n.res=why;decide(n,to,ACT[a].lab,why);delete n.rq}
commit(a,id,b,n,why,ACT[a].lab+"을(를) 기록했습니다.");MODE=null;route();return false}
function doDel(ev,id){ev.preventDefault();const e=cur(id),why=$("#r-why").value.trim();DB.del[id]={t:now()};if(!abDone){abk("편집 시작 전");abDone=true}DB.log.push({n:DB.log.length+1,t:now(),type:"delete",id,b:clone(e),a:null,why});save();rebuild();FL="삭제했습니다. 관리 화면의 ‘삭제된 항목’에서 복구할 수 있습니다.";MODE=null;go(e.c);return false}
function restore(id){const e=cur(id);delete DB.del[id];DB.log.push({n:DB.log.length+1,t:now(),type:"restore",id,b:null,a:clone(e),why:""});save();rebuild();FL="복구했습니다.";route()}
function detail(e){const sd=SEED.some(s=>s.id===e.id),mod=!!DB.ent[e.id];
const A=e.s==="Proposal"?["approve","reject","revise"]:e.s==="Unknown"?["promote"]:e.s==="Conflict"?["resolve"]:e.s==="Canon"?["demote"]:["reopen"];
return `<main><div class="crumb"><a href="#">처음</a> / <a href="#${e.c}">${CATS[e.c]}</a></div>
<h2>${esc(e.t)}</h2><p>${badge(e.s)} ${e.rq?'<span class="badge Proposal">수정 요청됨</span> ':""}<span class="badge Unknown">${e.v===1?"1차 자료":"2차 자료"}</span>${!sd?' <span class="badge Unknown">새로 추가</span>':mod?' <span class="badge Unknown">수정됨</span>':""}</p>
${SD[e.s]?`<p class="note">${SD[e.s]}</p>`:""}${e.rq?`<p class="note">수정 요청: ${esc(e.rq)}</p>`:""}
<div class="bar"><a class="btn" href="#edit-${e.id}">편집</a>${A.map(a=>`<button class="btn2" onclick="openAct('${a}','${e.id}')">${ACT[a].lab}</button>`).join("")}<button class="btn2 dg" onclick="openAct('del','${e.id}')">삭제</button></div>${MODE&&MODE.id===e.id?panel(e):""}
<h3>기록 원문</h3><div class="claim" lang="${e.lg||"en"}">${esc(e.claim)}</div>${e.ex?`<div class="box"><h3>자료에 나온 예시</h3>${esc(e.ex)}</div>`:""}
${e.dec?`<div class="box"><h3>결정 기록</h3>${esc(e.dec)}</div>`:""}
${e.conf?`<div class="box"><h3>${e.res?"해소된 충돌 이력":"충돌 내용 (아직 해소되지 않음)"}</h3><p>서술이 달랐던 내용을 합치지 않고 그대로 보존합니다.</p><ul>${e.conf.map(p=>`<li>${esc(p[0])} — <span class="lc">${esc(SRC[p[1]]||p[1])}</span></li>`).join("")}</ul>${e.res?`<p><b>결과:</b> ${esc(e.res)}</p>`:""}</div>`:""}
<div class="box"><h3>출처와 근거</h3><ul>${e.src.map(s=>`<li>${esc(SRC[s[0]]||s[0].replace("custom:",""))}<br><span class="lc">${esc(s[1])}</span></li>`).join("")}</ul>${e.hint?`<p class="lc">원 대화 근거: 미확인. ${esc(e.hint)}</p>`:""}</div>
<div class="tags">${e.tags.map(t=>`<span>${esc(t)}</span>`).join("")}</div>${hist(e.id)}</main>`}
function srow(s,i){const c=s[0].startsWith("custom:"),u=s[0]&&!c&&!SRC[s[0]];return `<div class="srow"><select aria-label="출처" onchange="fsync();route()"><option value="">출처 선택</option>${Object.keys(SRC).map(k=>`<option value="${k}"${s[0]===k?" selected":""}>${esc(SRC[k])}</option>`).join("")}${u?`<option value="${esc(s[0])}" selected>${esc(s[0])}</option>`:""}<option value="custom"${c?" selected":""}>직접 입력</option></select><input class="sl" aria-label="출처 위치" placeholder="위치(문서 쪽수, 메시지 등)" value="${esc(s[1])}"><button type="button" class="btn2" onclick="rmSrc(${i})">삭제</button>${c?`<input class="cs" aria-label="출처 이름" placeholder="출처 이름" value="${esc(s[0].slice(7))}">`:""}</div>`}
function fsync(){if(!FM)return;const d=FM.d,g=i=>{const x=document.getElementById(i);return x?x.value:""};d.t=g("f-t").trim();d.claim=g("f-claim");d.ex=g("f-ex");d.c=g("f-c");d.s=g("f-s");d.v=+g("f-v");d.tags=g("f-tags").split(/[,，]/).map(x=>x.trim()).filter(Boolean);FM.why=g("f-why");d.src=[...document.querySelectorAll(".srow")].map(r=>{let v=r.querySelector("select").value;if(v==="custom")v="custom:"+(r.querySelector(".cs")?r.querySelector(".cs").value.trim():"");return[v,r.querySelector(".sl").value]})}
function addSrc(){fsync();FM.d.src.push(["",""]);route()}
function rmSrc(i){fsync();FM.d.src.splice(i,1);route()}
function formView(e){if(!FM){const d=e?clone(e):{id:"n-"+Date.now().toString(36),t:"",c:"language",s:"Proposal",v:2,lg:"ko",tags:[],claim:"",src:[],ex:""};FM={o:e?clone(e):null,d,why:"",err:""}}
const d=FM.d,o=(x,v)=>`<option value="${x}"${v===x?" selected":""}>`;
return `<main><div class="crumb"><a href="#">처음</a> / ${e?`<a href="#${e.id}">${esc(e.t)}</a> / 편집`:"새 설정"}</div><h2>${e?"설정 편집":"새 설정 추가"}</h2>${FM.err?`<p class="note err">${esc(FM.err)}</p>`:""}
<form class="fm" onsubmit="return fsave(event)"><label>제목<input id="f-t" value="${esc(d.t)}"></label>
<label>설명 (기록 원문)<textarea id="f-claim" rows="8">${esc(d.claim)}</textarea></label><label>예시 (선택)<textarea id="f-ex" rows="2">${esc(d.ex||"")}</textarea></label>
<div class="row2"><label>분야<select id="f-c">${Object.keys(CATS).map(k=>o(k,d.c)+CATS[k]+"</option>").join("")}</select></label>
<label>설정 상태<select id="f-s">${ST.map(s=>o(s,d.s)+s+" · "+SL[s]+"</option>").join("")}</select></label>
<label>근거 수준<select id="f-v">${o(1,d.v)}1차 자료</option>${o(2,d.v)}2차 자료</option></select></label></div>
<label>태그 (쉼표로 구분)<input id="f-tags" value="${esc(d.tags.join(", "))}"></label>
<fieldset><legend>출처와 근거</legend>${d.src.map(srow).join("")}<button type="button" class="btn2" onclick="addSrc()">＋ 출처 추가</button></fieldset>
<label>변경 사유 (상태를 바꾸거나 Canon으로 새로 추가할 때 필수)<textarea id="f-why" rows="2">${esc(FM.why)}</textarea></label>
<div class="bar"><button class="btn" type="submit">저장</button><a class="btn2" href="#${e?e.id:""}">취소</a></div></form></main>`}
function fsave(ev){ev.preventDefault();fsync();const d=FM.d,o=FM.o,why=FM.why.trim(),sc=(o&&o.s!==d.s)||(!o&&d.s==="Canon");let er="";
d.src=d.src.filter(s=>s[0]||s[1]);
if(!d.t)er="제목을 입력하세요.";else if(!d.claim.trim())er="설명을 입력하세요.";else if(d.src.some(s=>!s[0]||s[0]==="custom:"))er="출처를 선택하거나 이름을 입력하세요.";else if(sc&&!why)er="상태를 정할 때는 변경 사유를 적어 주세요.";
if(er){FM.err=er;route();return false}
const b=o?clone(o):null,n=clone(d);delete n.rq;if(sc)decide(n,d.s,o?"상태 변경":"새 설정 확정",why);
if(b&&JSON.stringify(b)===JSON.stringify(n)){FL="변경된 내용이 없습니다.";FM=null;go(n.id);return false}
commit(!o?"create":sc?"status":"edit",n.id,b,n,why,"저장했습니다.");FM=null;go(n.id);return false}
const bk=()=>JSON.stringify({app:"nyekora-archive",ver:1,seedVer:SEEDVER,exportedAt:now(),db:DB},null,1);
function copyTA(){const t=$("#bk");if(!t)return;t.select();try{navigator.clipboard.writeText(t.value).then(()=>{FL="복사했습니다.";}).catch(()=>{})}catch(x){}try{document.execCommand("copy")}catch(x){}}
function showBk(v){MG.view=v;route()}
function parseDB(txt){try{const o=JSON.parse(txt),d=o.db||o;if(d&&d.v===1&&d.ent&&d.del&&Array.isArray(d.log))return d}catch(x){}return null}
function stageImp(txt){const d=parseDB(txt);if(!d){MG.err="백업 형식이 올바르지 않습니다. 복구 파일을 그대로 붙여 넣어 주세요.";MG.imp=null}else{MG.err="";MG.imp=d}route()}
function doImp(){if(!MG.imp)return;abk("복구 전");DB=MG.imp;save();rebuild();MG={};FL="복구했습니다. 이전 상태는 자동 백업에 남았습니다.";route()}
function doReset(){abk("초기화 전");DB={v:1,ent:{},del:{},log:[]};save();rebuild();MG={};FL="HTML 원본 데이터로 되돌렸습니다. 이전 상태는 자동 백업에 남았습니다.";route()}
function manage(){let sz=0;try{sz=(localStorage.getItem(KEY)||"").length}catch(x){}const ab=abl(),L=DB.log.slice(-30).reverse(),T=Object.keys(DB.del),er=MG.err?`<p class="note err">${esc(MG.err)}</p>`:"";
const ttl=id=>{const x=cur(id)||((DB.log.find(l=>l.id===id&&l.b)||{}).b)||{};return x.t||id};
return `<main><div class="crumb"><a href="#">처음</a> / 관리</div><h2>관리: 백업·복구·이력</h2>
<p class="note">저장 상태: ${storeOk?"이 브라우저에 자동 저장 중":"저장할 수 없음(새로고침하면 사라집니다)"} · 수정·추가 ${Object.keys(DB.ent).length}개 · 삭제 ${T.length}개 · 이력 ${DB.log.length}건 · 저장 용량 약 ${Math.round(sz/1024)}KB<br>편집 내용은 이 브라우저에 저장되고, ☁ 클라우드에 로그인하면 내 계정에도 저장됩니다. 사이트 파일 속 원본 데이터는 바뀌지 않습니다. 백업을 복사해 보관해 두면 더 안전합니다.</p>
<h3>백업</h3><div class="bar"><button class="btn2" onclick="showBk('bk')">복구용 백업 보기</button><button class="btn2" onclick="showBk('all')">현재 전체 항목 JSON 보기</button></div>
${MG.view?`<textarea id="bk" class="big" readonly>${esc(MG.view==="bk"?bk():JSON.stringify(E,null,1))}</textarea><div class="bar"><button class="btn" onclick="copyTA()">전체 선택·복사</button></div>`:""}
<h3>복구</h3>${er}<textarea id="imp" class="big" placeholder="복구용 백업 내용을 여기에 붙여 넣으세요"></textarea><div class="bar"><button class="btn2" onclick="stageImp($('#imp').value)">백업 확인</button></div>
${MG.imp?`<div class="box"><p>이 백업으로 복구하면 지금의 편집 내용이 교체됩니다 (수정·추가 ${Object.keys(MG.imp.ent).length}개, 삭제 ${Object.keys(MG.imp.del).length}개, 이력 ${MG.imp.log.length}건). 지금 상태는 자동 백업에 먼저 저장됩니다.</p><div class="bar"><button class="btn" onclick="doImp()">복구 실행</button><button class="btn2" onclick="MG.imp=null;route()">취소</button></div></div>`:""}
<h3>자동 백업 (최근 3개)</h3>${ab.length?ab.map((x,i)=>`<div class="lg">${fmt(x.t)} · ${esc(x.why)} <button class="btn2" onclick="stageImp(JSON.stringify(abl()[${i}].db))">이 백업으로 복구</button></div>`).join(""):'<p class="lc">아직 자동 백업이 없습니다. 편집을 시작하거나 복구·초기화 전에 만들어집니다.</p>'}
<h3>삭제된 항목</h3>${T.length?T.map(id=>`<div class="lg">${esc(ttl(id))} · ${fmt(DB.del[id].t)} <button class="btn2" onclick="restore('${id}')">복구</button></div>`).join(""):'<p class="lc">삭제된 항목이 없습니다.</p>'}
<h3>최근 변경 이력</h3>${L.length?L.map(l=>`<div class="lg"><b>${TL[l.type]||l.type}</b> · ${fmt(l.t)} · ${DB.del[l.id]?esc(ttl(l.id)):`<a href="#${l.id}">${esc(ttl(l.id))}</a>`}${l.why?` — ${esc(l.why)}`:""}</div>`).join(""):'<p class="lc">아직 변경 이력이 없습니다.</p>'}
<h3>HTML 원본으로 되돌리기</h3>${MG.reset?`<div class="box"><p>모든 편집 내용과 이력을 지우고 HTML에 내장된 원본 데이터로 돌아갑니다. 지금 상태는 자동 백업에 먼저 저장됩니다.</p><div class="bar"><button class="btn2 dg" onclick="doReset()">초기화 확인</button><button class="btn2" onclick="MG.reset=false;route()">취소</button></div></div>`:'<div class="bar"><button class="btn2 dg" onclick="MG.reset=true;route()">원본으로 되돌리기…</button></div>'}</main>`}
function route(){
const h=location.hash.slice(1);let html;
$("#nav").innerHTML=`<a href="#all" ${h==="all"?'aria-current="page"':""}>전체</a>`+Object.keys(CATS).map(k=>`<a href="#${k}" ${h===k?'aria-current="page"':""}>${CATS[k]}</a>`).join("")+`<a href="#new" ${h==="new"?'aria-current="page"':""}>＋ 새 설정</a><a href="#priority" ${h==="priority"?'aria-current="page"':""}>📊 우선순위</a><a href="#notify" ${h==="notify"?'aria-current="page"':""}>🔔 알림</a><a href="#manage" ${h==="manage"?'aria-current="page"':""}>관리</a><a href="#cloud" id="cloud-nav" ${h==="cloud"?'aria-current="page"':""}>${window.cloudNavLabel?cloudNavLabel():"☁"}</a>`;
const e=E.find(x=>x.id===h),ee=h.startsWith("edit-")?E.find(x=>x.id===h.slice(5)):null;
const known=!!e||!!ee||["new","manage","cloud","search","all","priority","notify"].includes(h)||!!CATS[h]||h==="";
if(h==="new")html=formView(null);
else if(ee)html=formView(ee);
else if(h==="manage")html=manage();
else if(h==="priority")html=window.NyekoraPriority?NyekoraPriority.renderView(E,{sourceLabel:"현재 기록관 데이터"}):'<main><p class="note err">우선순위 분석기를 불러오지 못했습니다. index.html의 priority-analyzer.js 스크립트를 확인해 주세요.</p></main>';
else if(h==="cloud")html=window.cloudView?cloudView():home();
else if(h==="notify")html=notifyView(E);
else if(e)html=detail(e);
else if(h==="search")html=search();
else if(h==="all")html=list("전체 기록",E);
else if(CATS[h]){const a=E.filter(x=>x.c===h);html=list(CATS[h],a,`<p class="note">${CATNOTE[h]}</p>`)}
else html=home();
const w=storeOk?"":'<div class="flash warn" role="alert">이 환경에서는 브라우저 저장이 되지 않습니다. 수정 내용은 새로고침하면 사라지니 관리 화면에서 백업을 복사해 두세요.</div>';
$("#app").innerHTML=w+(FL?`<div class="flash" role="status">${esc(FL)}</div>`:"")+html;FL="";
if(!known)location.hash="";
document.title=(h==="priority"?"검토 우선순위 추천 · ":"")+(e?e.t+" · ":"")+"니에코라 기록관 · Nyekora Archive";
}
function notifyEmailEsc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

function notifyView(entries){
  // 저장된 설정 읽기
  const savedEmail = localStorage.getItem(NOTIFY_EMAIL_KEY) || "";
  const savedPeriod = localStorage.getItem(NOTIFY_PERIOD_KEY) || "manual";
  const savedHour = localStorage.getItem(NOTIFY_HOUR_KEY) || "9";
  const savedDay = localStorage.getItem(NOTIFY_DAY_KEY) || "none";

  // 주간 요일 옵션
  const dayOptions = ["mon","tue","wed","thu","fri","sat","sun","weekday","weekend","none"]
    .map(d=>`<option value="${d}"${d===savedDay?" selected":""}">${d}</option>`).join("");

  // 시간대 옵션 (시)
  const hourOptions = (()=> {
    let opts=""; for(let h=0;h<24;h++) opts+=`<option value="${h}"${h===parseInt(savedHour)? " selected":""}">${String(h).padStart(2,"0")}</option>`;
    return opts;
  })();

  // 모드 옵션
  const modeOptions = `<option value="manual"${savedPeriod==="manual"?" selected":""}>수동</option><option value="daily"${savedPeriod==="daily"?" selected":""}>일일</option><option value="weekly"${savedPeriod==="weekly"?" selected":""}>주간</option><option value="off"${savedPeriod==="off"?" selected":""}>꺼기</option>`;

  let html = `
  <main class="nyekora-notify">
    <div class="crumb"><a href="#">처음</a> / 알림 설정</div>
    <h2>리뷰 우선순위 Gmail 알림</h2>
    <p class="note">AI가 분석한 우선순위 Top 5를 이메일로 받아보실 수 있습니다. AI가 임의로 상태를 변경하지 않으며, 확인용 권장 순서만 전달합니다.</p>

    <form class="fm" onsubmit="return notifySave(event)">
      <div class="row2">
        <label>수신 이메일 <input id="notify-email" type="email" value="${notifyEmailEsc(savedEmail)}" placeholder="Gmail 주소"></label>
      </div>
      <div class="row2">
        <label>발송 주기 <select id="notify-period">${modeOptions}</select></label>
      </div>
      <div class="row2">
        <label>보낼 시간 (시) <select id="notify-hour">${hourOptions}</select></label>
      </div>
      <div class="row2">
        <label>보낼 요일 <select id="notify-day">${dayOptions}</select></label>
      </div>
      <div class="bar">
        <button class="btn" type="submit">설정 저장</button>
        <button class="btn2" type="button" onclick="location.hash=''">취소</button>
      </div>
    </form>

    <div class="section">
      <h3>발송 및 미리보기</h3>
      <div class="bar">
        <button class="btn2" type="button" onclick="notifyPreview()">미리보기 (발송 안 함)</button>
        <button class="btn2" type="button" onclick="notifyTest()">테스트 발송</button>
        <button class="btn" type="button" onclick="notifySend()">지금 발송</button>
      </div>
      <div id="notify-result"></div>
      <p class="note">발송하려면 ☁ 로그인이 필요합니다. 정기 발송은 Supabase Cron 설정이 있어야 동작합니다.</p>
    </div>
    <div class="section" id="notify-logs">
      <h3>최근 발송 이력</h3>
      <div id="notify-log-loading"><span class="lc">로그인하면 발송 이력을 볼 수 있습니다.</span></div>
    </div>

    <div class="section" style="margin-top:32px;">
      <h3>알림 안내</h3>
      <ul>
        <li>AI가 승인·거부를 자동으로 변경하지 않습니다. 확인용 권장 순서만 전달합니다.</li>
        <li>Gmail SMTP 앱 비밀번호가 Edge Function 시크릿에 필요합니다.</li>
        <li>수동 발송은 Authorization 헤더에 Supabase JWT가 필요합니다.</li>
        <li>정기 발송은 Supabase Cron과 CRON_SECRET이 필요합니다.</li>
      </ul>
    </div>
  </main>`;

  // 우선순위 데이터가 있으면 Top 5 자동 추출 (analyze 연동)
  const proposalEntries = (entries||[]).filter(e=>e&&e.s==="Proposal");
  if(proposalEntries.length>0){
    // 우선순위 분석기 사용 (window.NyekoraPriority가 로드된 경우)
    if (window.NyekoraPriority && window.NyekoraPriority.analyze){
      const result = window.NyekoraPriority.analyze(entries||[]);
      const top5 = (result.items||[]).slice(0,5);
      if(top5.length>0){
        html += '<div class="section" style="margin-top:24px;"><h3>추천 상위 5개 (미리보기)</h3>';
        html += '<ul>';
        top5.forEach(r=>{
          const e = r.e;
          html += `<li><strong>${esc(e.t)}</strong> (${esc(CATS[e.c]||e.c)}) — ${r.total}점 — <a href="#${esc(e.id)}">상세 보기</a></li>`;
        });
        html += '</ul></div>';
      }
    } else {
      // 분석기 없이 기본 카드 표시
      html += '<div class="section" style="margin-top:24px;"><h3>분석기 사용 불가 (프로토 미로드)</h3><p>index.html에 priority-analyzer.js가 포함되어 있어야 합니다.</p></div>';
    }
  }

  if(window.CL&&CL.uid) setTimeout(function(){notifyLoadFromCloud();},0);
  return html;
}

// notify: 설정 저장 (로컬 + 클라우드 동기화)
function notifySave(ev){
  ev.preventDefault();
  const email=$("#notify-email").value.trim();
  const period=$("#notify-period").value;
  const hour=parseInt($("#notify-hour").value,10)||9;
  const day=$("#notify-day").value;
  if(!email){alert("이메일 주소를 입력해 주세요.");return false}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){alert("올바른 이메일 주소가 아닙니다.");return false}
  localStorage.setItem(NOTIFY_EMAIL_KEY,email);
  localStorage.setItem(NOTIFY_PERIOD_KEY,period);
  localStorage.setItem(NOTIFY_HOUR_KEY,String(hour));
  localStorage.setItem(NOTIFY_DAY_KEY,day);
  FL="알림 설정이 저장되었습니다.";
  route();
  if(window.CL&&CL.uid&&CL.sb){ notifySaveCloud(email,period,hour,day); }
  return false;
}

async function notifySaveCloud(email,period,hour,day){
  try{
    const {error}=await CL.sb.from("nyekora_notify_settings").upsert({
      owner_id:CL.uid, enabled:(period!=="off"), mode:period,
      recipient_email:email, send_hour:hour, day_of_week:day,
      timezone:"Asia/Seoul", top_n:5, dedup_days:1, updated_at:new Date().toISOString()
    },{onConflict:"owner_id"});
    if(error)throw error;
    if(window.cloudPushPrioritySnapshot)await window.cloudPushPrioritySnapshot({topN:5});
    FL="알림 설정을 클라우드에 저장했습니다.";
    route();
  }catch(e){ alert("클라우드 저장 실패: "+(e&&e.message?e.message:e)); }
}

// 로컬 저장값을 클라우드 설정으로 upsert (미리보기/발송 직전 보장)
async function notifySyncSettings(){
  if(!window.CL||!CL.uid||!CL.sb) throw new Error("로그인이 필요합니다. ☁ 메뉴에서 로그인해 주세요.");
  const email=localStorage.getItem(NOTIFY_EMAIL_KEY)||"";
  const period=localStorage.getItem(NOTIFY_PERIOD_KEY)||"manual";
  const hour=parseInt(localStorage.getItem(NOTIFY_HOUR_KEY)||"9",10);
  const day=localStorage.getItem(NOTIFY_DAY_KEY)||"none";
  if(!email) throw new Error("먼저 알림 설정을 저장해 주세요.");
  const {error}=await CL.sb.from("nyekora_notify_settings").upsert({
    owner_id:CL.uid, enabled:(period!=="off"), mode:period, recipient_email:email,
    send_hour:hour, day_of_week:day, timezone:"Asia/Seoul", top_n:5, dedup_days:1, updated_at:new Date().toISOString()
  },{onConflict:"owner_id"});
  if(error) throw error;
}

// Edge Function 호출 (실제 JWT + apikey, 쿼리/바디 둘 다 action 전달)
async function notifyInvoke(action){
  if(!window.CL||!CL.sb) throw new Error("Supabase 클라이언트가 없습니다.");
  const sess=await CL.sb.auth.getSession();
  const session=sess&&sess.data?sess.data.session:null;
  if(!session) throw new Error("로그인이 필요합니다. ☁ 메뉴에서 로그인해 주세요.");
  const cfg=window.NYEKORA_CLOUD||{};
  if(!cfg.url||!cfg.anonKey) throw new Error("cloud-config.js 설정이 필요합니다.");
  const res=await fetch(cfg.url+"/functions/v1/gmail-digest?action="+encodeURIComponent(action),{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token,"apikey":cfg.anonKey},
    body:JSON.stringify({action:action})
  });
  let data=null; try{data=await res.json();}catch(e){}
  return {ok:res.ok,status:res.status,data:data||{}};
}

async function notifyPrepare(){
  await notifySyncSettings();
  if(window.cloudPushPrioritySnapshot) await window.cloudPushPrioritySnapshot({topN:5});
}

function notifySetResult(html){
  const out=document.getElementById("notify-result");
  if(out) out.innerHTML=html;
}

// 미리보기 (발송 안 함)
async function notifyPreview(){
  try{
    notifySetResult('<p class="lc">미리보기 준비 중…</p>');
    await notifyPrepare();
    const r=await notifyInvoke("preview");
    const d=r.data||{};
    if(!r.ok||d.error){ notifySetResult('<p class="note err">미리보기 실패: '+esc(d.error||("HTTP "+r.status))+'</p>'); return; }
    const items=d.topItems||[];
    if(!items.length){ notifySetResult('<p class="note">표시할 우선순위 항목이 없습니다. #priority에서 분석되는지 확인해 주세요.</p>'); return; }
    notifySetResult('<h3>미리보기 (발송 안 함)</h3><ol>'+items.map(function(it){
      return '<li><b>'+esc(it.title)+'</b> — '+esc(it.category)+' · '+it.score+'점<br><span class="lc">'+esc(it.reason)+'</span><br><a href="#'+esc(it.id)+'">기록관에서 열기</a></li>';
    }).join("")+'</ol>');
  }catch(e){ notifySetResult('<p class="note err">'+esc(e&&e.message?e.message:e)+'</p>'); }
}

// 테스트 발송 (본인 이메일로 1건)
async function notifyTest(){
  try{
    notifySetResult('<p class="lc">테스트 메일 발송 중…</p>');
    await notifySyncSettings();
    const r=await notifyInvoke("test");
    const d=r.data||{};
    if(!r.ok||d.error){ notifySetResult('<p class="note err">테스트 실패: '+esc(d.error||("HTTP "+r.status))+'</p>'); return; }
    notifySetResult('<p class="note">테스트 메일을 발송했습니다. 받은편지함(스팸함 포함)을 확인해 주세요.</p>');
  }catch(e){ notifySetResult('<p class="note err">'+esc(e&&e.message?e.message:e)+'</p>'); }
}

// 지금 발송 (원자적 클레임 → 발송)
async function notifySend(){
  if(!confirm("지금 우선순위 메일을 발송할까요?")) return;
  try{
    notifySetResult('<p class="lc">발송 준비 중…</p>');
    await notifyPrepare();
    const r=await notifyInvoke("send");
    const d=r.data||{};
    const outcome=d.outcome||d.result_status||d.status;
    if(r.ok&&outcome==="sent"){ notifySetResult('<p class="note">'+esc(d.message||((d.sentCount||0)+"개 항목을 발송했습니다."))+'</p>'); notifyRefreshLogs(); return; }
    if(outcome==="sent"||outcome==="claimed_by_other"||outcome==="error_cooldown"||outcome==="no_items"||outcome==="skipped"){
      notifySetResult('<p class="note">'+esc(d.message||("발송하지 않았습니다 ("+outcome+")"))+'</p>');
      return;
    }
    notifySetResult('<p class="note err">발송 실패: '+esc(d.message||d.error||("HTTP "+r.status))+'</p>');
  }catch(e){ notifySetResult('<p class="note err">'+esc(e&&e.message?e.message:e)+'</p>'); }
}

// 로그인 상태에서 클라우드 설정을 폼에 반영
async function notifyLoadFromCloud(){
  if(!window.CL||!CL.uid||!CL.sb) return;
  try{
    const {data,error}=await CL.sb.from("nyekora_notify_settings").select("*").eq("owner_id",CL.uid).maybeSingle();
    if(error) throw error;
    if(data){
      localStorage.setItem(NOTIFY_EMAIL_KEY,data.recipient_email||"");
      localStorage.setItem(NOTIFY_PERIOD_KEY,data.mode||"manual");
      localStorage.setItem(NOTIFY_HOUR_KEY,String(data.send_hour!=null?data.send_hour:9));
      localStorage.setItem(NOTIFY_DAY_KEY,data.day_of_week||"none");
      const f=function(id,v){const el=document.getElementById(id);if(el&&v!=null)el.value=v;};
      f("notify-email",data.recipient_email||"");
      f("notify-period",data.mode||"manual");
      f("notify-hour",String(data.send_hour!=null?data.send_hour:9));
      f("notify-day",data.day_of_week||"none");
    }
    notifyRefreshLogs();
  }catch(e){ /* 로그인 전/권한 없음은 조용히 무시 */ }
}

// 최근 발송 이력 조회 (nyekora_notify_log 직접 조회)
async function notifyRefreshLogs(){
  const box=document.getElementById("notify-log-loading");
  if(!box) return;
  if(!window.CL||!CL.uid||!CL.sb){ box.innerHTML='<span class="lc">로그인하면 발송 이력을 볼 수 있습니다.</span>'; return; }
  try{
    const {data,error}=await CL.sb.from("nyekora_notify_log")
      .select("created_at,trigger,status,message_id,error,item_ids")
      .eq("owner_id",CL.uid).order("created_at",{ascending:false}).limit(10);
    if(error) throw error;
    if(!data||!data.length){ box.innerHTML='<span class="lc">아직 발송 이력이 없습니다.</span>'; return; }
    box.innerHTML=data.map(function(l){
      return '<div class="lg">'+new Date(l.created_at).toLocaleString("ko-KR")+' · '+esc(l.trigger||"")+' · '+esc(l.status||"")+(l.error?' — <span class="lc">'+esc(l.error)+'</span>':'')+'</div>';
    }).join("");
  }catch(e){ box.innerHTML='<span class="lc">이력 조회 실패: '+esc(e&&e.message?e.message:e)+'</span>'; }
}

window.priorityRefresh=function(){route()};
$("#foot").innerHTML=`<p><b>자료 출처 안내.</b> 현재 기록은 대화 일부와 정리 문서에서 가져왔습니다. 원본 대화 전체와 이미지 원본은 아직 확인되지 않았고, 2차 자료만 근거인 내용은 Canon으로 표시하지 않습니다. 기록 원문은 원본 언어 그대로 보여 줍니다.</p><p>이 시제품에는 예시용으로 지어낸 설정이 없습니다. 항목 제목과 분야 배정은 찾아보기 편하도록 붙인 이름표이며 설정이 아닙니다.</p><p>편집한 내용은 이 브라우저에 저장되고, ☁ 클라우드에 로그인하면 내 계정에도 저장됩니다. 사이트 파일 속 원본 데이터는 바뀌지 않습니다. 관리 화면에서 백업을 복사해 두세요.</p>`;
addEventListener("hashchange",()=>{F="";MODE=null;FM=null;MG={};route();scrollTo(0,0)});
load();rebuild();route();
if(window.cloudInit)cloudInit();
