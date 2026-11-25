/*
  Nyekora Archive — Gmail 알림 Edge Function (gmail-digest)

  Supabase Edge Functions 는 Deno 런타임이므로 npm: 지정자로 의존성을 가져온다.

  action
    - "preview" : 발송 대상/메일 HTML·텍스트만 반환 (발송 X, 클레임 X)
    - "test"    : 본인 이메일로 [테스트] 메일 발송 (클레임/중복기록 X)
    - "send"    : 원자적 클레임(RPC) → SMTP 발송 → mark_sent/mark_error
    - "cron"    : service_role 로 enabled 인 daily/weekly 설정을 순회하며 due 인 것만 처리

  인증
    - preview/test/send : Authorization: Bearer <사용자 JWT> 필수
    - cron              : x-cron-secret: <CRON_SECRET> 필수

  원자적 클레임
    - nyekora_claim_settings(RPC) 가 INSERT ... ON CONFLICT 로 동시 요청을 한 건만 통과시킨다.
    - 결과 result_status: claimed | claimed_by_other | sent | error_cooldown | available
    - claimed 일 때만 실제 SMTP 발송을 진행하고, 발송 후 mark_sent/mark_error 를 claim_token 으로 호출한다.

  시크릿 (Supabase Dashboard → Functions → Secrets)
    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (자동 주입됨)
    SMTP_HOSTNAME, SMTP_PORT, SMTP_SECURE, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM
    PUBLIC_SITE_URL, ALLOWED_ORIGIN, CRON_SECRET
*/

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const SMTP_HOSTNAME = Deno.env.get("SMTP_HOSTNAME") ?? "smtp.gmail.com";
const SMTP_PORT = parseInt(Deno.env.get("SMTP_PORT") ?? "465", 10);
const SMTP_SECURE = (Deno.env.get("SMTP_SECURE") ?? "true") === "true";
const SMTP_USERNAME = Deno.env.get("SMTP_USERNAME") ?? "";
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD") ?? "";
const SMTP_FROM = Deno.env.get("SMTP_FROM") ?? "";

const PUBLIC_SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") ?? "").replace(/\/+$/, "");
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------- helpers
function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "x-error-type, x-retry-after",
  };
}
function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(), ...extra },
  });
}
function fail(status: number, message: string, type: string, extra: Record<string, string> = {}): Response {
  console.error("[gmail-digest]", { status, type, message });
  return jsonResponse({ error: message, type, status }, status, { "x-error-type": type, ...extra });
}
function userClient(authHeader: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

const CAT_NAME: Record<string, string> = {
  language: "언어", music: "음악", history: "역사",
  clothing: "의복", society: "사회·관습", architecture: "건축",
};

// ---------------------------------------------------------------- digest key (설정 + 발송기간)
function pad2(n: number): string { return String(n).padStart(2, "0"); }
function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;          // 월=0
  t.setUTCDate(t.getUTCDate() - day + 3);        // 그 주 목요일
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fd = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fd + 3);
  const week = 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86400000));
  return `${t.getUTCFullYear()}-W${pad2(week)}`;
}
function dateKeyInTz(tz: string, now: Date): string {
  try {
    // en-CA 는 YYYY-MM-DD 형식을 돌려준다
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
  } catch {
    return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
  }
}
function computeDigestKey(ownerId: string, settings: Record<string, unknown>, now = new Date()): string {
  const mode = String(settings.mode ?? "manual");
  const tz = String(settings.timezone ?? "Asia/Seoul");
  const dayKey = dateKeyInTz(tz, now);
  if (mode === "weekly") return `${ownerId}:weekly:${isoWeekKey(now)}`;
  if (mode === "daily") return `${ownerId}:daily:${dayKey}`;
  // manual: 같은 로컬 날짜+시간대 중복 클릭만 막는다
  return `${ownerId}:manual:${dayKey}:${settings.send_hour ?? 0}`;
}

// ---------------------------------------------------------------- email body
type MailItem = { id: string; rank: number; title: string; category: string; score: number; reason: string; link: string };

function buildEmailHtml(items: MailItem[], totalAnalyzed: number): string {
  const rows = items.map((it) => `
    <div style="border-bottom:1px solid #e0e0e0;padding:12px 0">
      <div style="font-size:14px;font-weight:600;color:#14213d">${it.rank}. ${esc(it.title)}</div>
      <div style="font-size:12px;color:#666;margin-top:4px">카테고리: ${esc(it.category)} · 점수: ${it.score}점</div>
      <div style="font-size:12px;color:#555;margin-top:4px;line-height:1.5">이유: ${esc(it.reason)}</div>
      <div style="font-size:11px;color:#888;margin-top:6px">
        <a href="${esc(it.link)}" target="_blank" style="color:#0f766e">기록관 상세 보기</a>
      </div>
    </div>`).join("");
  const rows2 = rows || '<p style="color:#666">분석할 항목이 없습니다.</p>';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:20px;background:#fafafa;font-family:'Noto Sans KR',sans-serif;color:#14213d">
  <div style="max-width:600px;margin:0 auto">
    <div style="text-align:center;padding:20px 0;border-bottom:2px solid #d6b25e">
      <h1 style="margin:0;font-size:22px">니에코라 기록관 리뷰 우선순위</h1>
      <p style="margin:8px 0 0;font-size:13px;color:#666">AI가 계산한 참고용 순위입니다. 상태를 자동으로 바꾸지 않습니다.</p>
    </div>
    <h2 style="font-size:16px;border-left:4px solid #d6b25e;padding-left:8px">검토 권장 상위 ${items.length}개 (총 ${totalAnalyzed}개 제안 분석)</h2>
    ${rows2}
    <p style="text-align:center;font-size:11px;color:#999;margin-top:24px">
      이 메일은 니에코라 기록관 알림 기능으로 전송되었습니다.<br>
      수신을 원하지 않으면 사이트 알림 설정에서 주기를 바꾸거나 끌 수 있습니다.
    </p>
  </div>
</body></html>`;
}

function buildEmailText(items: MailItem[], totalAnalyzed: number): string {
  const lines = [
    "니에코라 기록관 리뷰 우선순위 추천",
    "============================",
    `총 분석 항목: ${totalAnalyzed}개`,
    "",
  ];
  for (const it of items) {
    lines.push(
      `${it.rank}. ${it.title}`,
      `   카테고리: ${it.category} · 점수: ${it.score}점`,
      `   이유: ${it.reason}`,
      `   상세: ${it.link}`,
      "",
    );
  }
  lines.push("이 메일은 니에코라 기록관 알림 기능으로 발송되었습니다.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- SMTP
async function sendEmail(to: string, subject: string, html: string, text: string) {
  if (!SMTP_USERNAME || !SMTP_PASSWORD || !SMTP_FROM) {
    return { success: false as const, error: "SMTP 설정이 비어 있습니다(시크릿 확인)." };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOSTNAME,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD },
    });
    const info = await transporter.sendMail({ from: SMTP_FROM, to, subject, html, text });
    return { success: true as const, messageId: String(info.messageId ?? "") };
  } catch (e) {
    return { success: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- data access
async function getSettings(client: SupabaseClient, ownerId: string) {
  const { data, error } = await client.from("nyekora_notify_settings").select("*").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`settings: ${error.message}`);
  return data;
}
async function getTopItems(client: SupabaseClient, ownerId: string, topN: number): Promise<MailItem[]> {
  const { data, error } = await client
    .from("nyekora_notify_snapshot").select("snapshot")
    .eq("owner_id", ownerId).order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`snapshot: ${error.message}`);
  const raw: Array<Record<string, unknown>> = (data?.snapshot?.topItems ?? []) as Array<Record<string, unknown>>;
  return raw.slice(0, Math.min(Math.max(topN || 5, 1), 20)).map((x, i) => {
    const id = String(x.id ?? "");
    const code = String(x.category ?? "");
    return {
      id,
      rank: i + 1,
      title: String(x.title ?? "제목 없음"),
      category: CAT_NAME[code] ?? code,
      score: Math.round(Number(x.score ?? 0)),
      reason: String(x.reason ?? "추천 사유는 기록관에서 확인하세요."),
      link: `${PUBLIC_SITE_URL}/#${encodeURIComponent(id)}`,
    };
  });
}
async function upsertLog(
  client: SupabaseClient, ownerId: string, trigger: string, digestKey: string,
  status: string, itemIds: string[], messageId: string | null, error: string | null,
) {
  const { error: e } = await client.from("nyekora_notify_log").upsert({
    owner_id: ownerId, trigger, digest_key: digestKey, item_ids: itemIds,
    status, message_id: messageId, error,
  }, { onConflict: "owner_id,digest_key" });
  if (e) console.error("[gmail-digest] log upsert failed", e.message);
}

// ---------------------------------------------------------------- claim + send
type ClaimRow = { result_status: string; claim_token: string | null; claimed_at: string | null; lease_timeout: string | null };

async function claim(client: SupabaseClient, ownerId: string, digestKey: string): Promise<ClaimRow> {
  const { data, error } = await client.rpc("nyekora_claim_settings", { p_owner_id: ownerId, p_digest_key: digestKey });
  if (error) throw new Error(`claim: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("claim: 빈 응답");
  return row as ClaimRow;
}

function retrySeconds(leaseTimeout: string | null): number {
  if (!leaseTimeout) return 60;
  const ms = new Date(leaseTimeout).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 1000));
}

// 수동/send 와 cron 이 공유하는 클레임→발송→마킹 파이프라인
async function runClaimAndSend(
  client: SupabaseClient,
  ownerId: string,
  recipient: string,
  settings: Record<string, unknown>,
  trigger: string,
) {
  const items = await getTopItems(client, ownerId, Number(settings.top_n ?? 5));
  if (items.length === 0) {
    return { ok: false as const, status: 200, outcome: "no_items",
      message: "발송할 우선순위 항목이 없습니다. #priority 분석/스냅샷을 확인해 주세요." };
  }

  const digestKey = computeDigestKey(ownerId, settings);
  const claimRow = await claim(client, ownerId, digestKey);

  switch (claimRow.result_status) {
    case "claimed": break;
    case "claimed_by_other":
      return { ok: false as const, status: 429, outcome: "claimed_by_other",
        retryAfter: retrySeconds(claimRow.lease_timeout),
        message: "이미 다른 요청이 발송을 진행 중입니다. 잠시 후 다시 시도해 주세요." };
    case "sent":
      return { ok: false as const, status: 409, outcome: "sent",
        message: "이번 발송 기간에는 이미 발송되었습니다." };
    case "error_cooldown":
      return { ok: false as const, status: 503, outcome: "error_cooldown",
        retryAfter: retrySeconds(claimRow.lease_timeout),
        message: "이전 발송이 실패했습니다. 대기 시간 후 다시 시도해 주세요." };
    default:
      return { ok: false as const, status: 409, outcome: claimRow.result_status ?? "unknown",
        message: "발송 권한을 얻지 못했습니다." };
  }

  const claimToken = String(claimRow.claim_token);

  const subject = `[니에코라 기록관] 리뷰 우선순위 추천 (Top ${items.length})`;
  const result = await sendEmail(recipient, subject, buildEmailHtml(items, items.length), buildEmailText(items, items.length));

  if (result.success) {
    await client.rpc("nyekora_mark_sent", {
      p_owner_id: ownerId, p_digest_key: digestKey, p_claim_token: claimToken, p_item_ids: items.map((i) => i.id),
    });
    await upsertLog(client, ownerId, trigger, digestKey, "sent", items.map((i) => i.id), result.messageId, null);
    return { ok: true as const, status: 200, outcome: "sent", sentCount: items.length, messageId: result.messageId };
  }

  await client.rpc("nyekora_mark_error", { p_owner_id: ownerId, p_digest_key: digestKey, p_claim_token: claimToken });
  await upsertLog(client, ownerId, trigger, digestKey, "error", items.map((i) => i.id), null, result.error ?? "unknown");
  return { ok: false as const, status: 500, outcome: "error", message: result.error ?? "메일 발송에 실패했습니다." };
}

// ---------------------------------------------------------------- serve
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return fail(405, "POST 만 지원합니다.", "method_not_allowed");

  const url = new URL(req.url);
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = req.headers.get("x-cron-secret") ?? "";

  // action 은 쿼리스트링을 우선하되, 없으면 JSON 바디의 action 을 사용한다.
  // (supabase-js functions.invoke 는 쿼리 지정이 번거로워 바디로도 받도록 지원)
  let bodyAction = "";
  try {
    const b = await req.json();
    if (b && typeof b.action === "string") bodyAction = b.action;
  } catch { /* 바디 없음 또는 JSON 아님 */ }
  const action = url.searchParams.get("action") || bodyAction || "";

  // 인증/권한
  let ownerId = "";
  if (action === "cron") {
    if (!CRON_SECRET || cronSecret !== CRON_SECRET) return fail(401, "잘못된 크론 시크릿입니다.", "invalid_cron_secret");
  } else {
    if (!authHeader.startsWith("Bearer ")) return fail(401, "인증 토큰이 없습니다.", "missing_jwt");
    const { data: userData, error: userErr } = await admin.auth.getUser(authHeader.slice(7));
    if (userErr || !userData.user) return fail(401, "유효하지 않은 인증 토큰입니다.", "invalid_jwt");
    ownerId = userData.user.id;
  }

  const user = ownerId ? userClient(authHeader) : admin;

  try {
    // ---------- preview: 발송/클레임 없음
    if (action === "preview") {
      const settings = await getSettings(user, ownerId);
      if (!settings || !settings.enabled) {
        return jsonResponse({ action, enabled: false, topItems: [], message: "알림이 비활성화되었거나 설정이 없습니다." });
      }
      const items = await getTopItems(user, ownerId, Number(settings.top_n ?? 5));
      return jsonResponse({
        action, enabled: true, topItems: items,
        settingsLink: `${PUBLIC_SITE_URL}/#notify`,
        message: "미리보기입니다. 실제 메일은 발송되지 않습니다.",
      });
    }

    // ---------- test: 테스트 메일 (클레임/중복기록 없음)
    if (action === "test") {
      const settings = await getSettings(user, ownerId);
      if (!settings) return fail(400, "알림 설정이 없습니다.", "no_settings");
      const { data: userData } = await admin.auth.getUser(authHeader.slice(7));
      const recipient = settings.recipient_email || userData.user?.email || "";
      if (!recipient) return fail(400, "수신 이메일을 찾을 수 없습니다.", "no_recipient");

      const items = await getTopItems(user, ownerId, Number(settings.top_n ?? 5));
      const sample: MailItem[] = items.length ? items : [{
        id: "sample", rank: 1, title: "Sûlora 문자 성격", category: "언어",
        score: 61, reason: "언어 분야의 출발점이 되는 항목입니다(테스트 데이터).",
        link: `${PUBLIC_SITE_URL}/#priority`,
      }];
      const r = await sendEmail(recipient, "[니에코라 기록관] 테스트 우선순위 메일",
        buildEmailHtml(sample, sample.length), buildEmailText(sample, sample.length));
      if (!r.success) return fail(500, r.error ?? "테스트 발송 실패", "smtp_error");
      return jsonResponse({ action, success: true, messageId: r.messageId, message: "테스트 메일을 발송했습니다." });
    }

    // ---------- send: 원자적 클레임 → 발송 → 마킹
    if (action === "send") {
      const settings = await getSettings(user, ownerId);
      if (!settings) return fail(400, "알림 설정이 없습니다.", "no_settings");
      if (!settings.enabled) return fail(400, "알림이 꺼져 있습니다.", "disabled");
      const { data: userData } = await admin.auth.getUser(authHeader.slice(7));
      const recipient = settings.recipient_email || userData.user?.email || "";
      if (!recipient) return fail(400, "수신 이메일을 찾을 수 없습니다.", "no_recipient");

      const res = await runClaimAndSend(user, ownerId, recipient, settings as Record<string, unknown>, "manual");
      const headers: Record<string, string> = {};
      if ("retryAfter" in res && res.retryAfter) headers["x-retry-after"] = String(res.retryAfter);
      return jsonResponse({ action, ...res }, res.status, headers);
    }

    // ---------- cron: enabled daily/weekly 순회, due 만 처리
    if (action === "cron") {
      const { data: allSettings, error } = await admin
        .from("nyekora_notify_settings").select("*").eq("enabled", true).in("mode", ["daily", "weekly"]);
      if (error) return fail(500, error.message, "settings_query_error");

      const results: unknown[] = [];
      for (const s of allSettings ?? []) {
        if (!isDue(s)) { results.push({ owner_id: s.owner_id, skipped: "not_due" }); continue; }
        const { data: u } = await admin.auth.admin.getUserById(s.owner_id);
        const recipient = s.recipient_email || u.user?.email || "";
        if (!recipient) { results.push({ owner_id: s.owner_id, skipped: "no_recipient" }); continue; }
        try {
          const res = await runClaimAndSend(admin, s.owner_id, recipient, s as Record<string, unknown>, "cron");
          results.push({ owner_id: s.owner_id, ...res });
        } catch (e) {
          results.push({ owner_id: s.owner_id, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return jsonResponse({ action, processed: results.length, results });
    }

    return fail(400, "지원하지 않는 액션입니다.", "bad_action");
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "예상치 못한 오류가 발생했습니다.", "internal_error");
  }
});

// 설정의 시각/요일이 지금 처리 대상인지 (대략 판정: cron 은 1시간 간격 가정)
function isDue(s: Record<string, unknown>): boolean {
  const now = new Date();
  const tz = String(s.timezone ?? "Asia/Seoul");
  let hour: number, weekday: string;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", weekday: "short", hour12: false }).formatToParts(now);
    hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
    weekday = (parts.find((p) => p.type === "weekday")?.value ?? "").toLowerCase();
  } catch {
    hour = now.getHours();
    weekday = now.toLocaleString("en-US", { weekday: "short" }).toLowerCase();
  }
  const sendHour = Number(s.send_hour ?? 9);
  if (String(s.mode) === "daily") return hour === sendHour;
  if (String(s.mode) === "weekly") return hour === sendHour && weekday === String(s.day_of_week ?? "");
  return false;
}
