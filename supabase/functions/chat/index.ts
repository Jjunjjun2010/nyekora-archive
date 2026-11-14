/*
  니에코라 마을 - Ruwata AI 대화용 Edge Function

  - 브라우저(GitHub Pages) → 이 함수 → Ollama Cloud
  - Ollama API 키는 이 함수의 시크릿(OLLAMA_API_KEY)에만 존재하며,
    코드·저장소·브라우저 어디에도 노출되지 않는다.
  - 로그인 없이 누구나 호출할 수 있으므로 IP당 분당 요청 수와
    메시지 길이/대화 길이를 제한한다. (인메모리 근사치)
  - Supabase 대시보드(Table Editor)의 데이터 수정 권한은 기존 RLS가 그대로 담당한다.

  시크릿:
    OLLAMA_API_KEY  (필수) Ollama Cloud API 키
    OLLAMA_MODEL    (선택) 기본값 glm-5.3-flash
    ALLOWED_ORIGIN  (선택) 허용할 Origin. 기본값 "*"
*/

const OLLAMA_API_KEY = Deno.env.get("OLLAMA_API_KEY");
const OLLAMA_MODEL = Deno.env.get("OLLAMA_MODEL") || "glm-5.3-flash";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const OLLAMA_URL = "https://ollama.com/v1/chat/completions";

const RATE_LIMIT = 10;           // IP당 분당 최대 요청 수
const RATE_WINDOW_MS = 60_000;
const MAX_HISTORY = 16;          // 최근 대화 최대 개수
const MAX_MESSAGE_CHARS = 1000;  // 말풍선 하나당 최대 길이
const MAX_TOTAL_CHARS = 8000;    // 대화 전체 최대 길이

const hits = new Map<string, { count: number; reset: number }>();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || "unknown";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [key, value] of hits) {
      if (now > value.reset) hits.delete(key);
    }
  }
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) {
    hits.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_LIMIT;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

function clampText(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.slice(0, maxChars).trim() : "";
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function parseMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = clampText((item as { content?: unknown }).content, MAX_MESSAGE_CHARS);
    if ((role === "user" || role === "assistant") && content) {
      out.push({ role, content });
    }
  }
  let trimmed = out.slice(-MAX_HISTORY);
  let total = trimmed.reduce((sum, m) => sum + m.content.length, 0);
  while (trimmed.length > 1 && total > MAX_TOTAL_CHARS) {
    total -= trimmed[0].content.length;
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

function buildSystemPrompt(state: Record<string, string>): string {
  const lines = [
    "당신은 니에코라 마을의 전통 악기 제작자 'Ruwata(루와타)'입니다.",
    "- 이름의 뜻: ruwa(물) + wata(나무)",
    "- 직업: 전통 악기 제작자. 수랄라(Surala)와 수타리(Sutari)라는 전통 악기를 만들고 다듬는다.",
    "- 성격: 신중하고 호기심이 많음. 말수가 많지 않고 차분하며, 악기와 소리에 진심이다.",
    "- 사는 곳: 니에코라 마을의 악기 작업장. 가끔 kalawa 광장에 나가 주민들과 이야기를 나누고 연주를 들려준다.",
    "- 소속된 세계: 니에코라 기록관(마을의 역사와 구전 이야기를 보관하는 곳)과 작은 시장(아침마다 열리는 시장)이 있는 마을.",
    "",
    "현재 게임 상태:",
    `- 마을 시간: ${state.time || "알 수 없음"} (${state.period || "시간대 미상"})`,
    `- Ruwata의 현재 상태: ${state.status || "알 수 없음"}`,
    `- 지금 하는 일: ${state.activity || "알 수 없음"}`,
    "",
    "대화 규칙:",
    "- 항상 루와타로서 1인칭으로, 한국어로 대답한다.",
    "- 2~4문장 정도의 짧은 대화체로 답한다. 긴 설명이나 목록은 피한다.",
    "- 확정되지 않은 마을 설정을 새로 지어내지 않는다. 모르는 것은 모른다고 하거나 추측임을 밝힌다.",
    "- 악기, 소리, 재료, 작업에 관한 이야기를 자연스럽게 섞는다.",
    "- 마을 바깥의 현실 세계 이야기가 나오면 루와타는 그런 것을 모른다고 반응한다.",
  ];
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "POST만 지원합니다." }, 405);
  }
  if (!OLLAMA_API_KEY) {
    return jsonResponse({ error: "서버에 API 키가 설정되지 않았습니다." }, 500);
  }
  if (rateLimited(clientIp(req))) {
    return jsonResponse({ error: "요청이 너무 많습니다. 잠시 후에 다시 시도해 주세요." }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const messages = parseMessages(payload.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return jsonResponse({ error: "사용자 메시지가 필요합니다." }, 400);
  }

  const rawState = (payload.state ?? {}) as Record<string, unknown>;
  const state: Record<string, string> = {
    time: clampText(rawState.time, 10),
    period: clampText(rawState.period, 10),
    status: clampText(rawState.status, 60),
    activity: clampText(rawState.activity, 200),
  };

  const ollamaMessages = [
    { role: "system", content: buildSystemPrompt(state) },
    ...messages,
  ];

  let upstream: Response;
  try {
    upstream = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + OLLAMA_API_KEY,
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: ollamaMessages,
        stream: false,
        temperature: 0.8,
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (_err) {
    return jsonResponse({ error: "응답을 받지 못했습니다. 잠시 후에 다시 시도해 주세요." }, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("Ollama upstream error", upstream.status, detail.slice(0, 500));
    if (upstream.status === 429) {
      return jsonResponse({ error: "지금은 손님이 많아 대답하기 어렵습니다. 잠시 뒤에 다시 말을 걸어 주세요." }, 429);
    }
    return jsonResponse({ error: "지금은 대답할 수 없습니다. 잠시 후에 다시 시도해 주세요." }, 502);
  }

  let data: unknown;
  try {
    data = await upstream.json();
  } catch {
    return jsonResponse({ error: "응답 형식이 올바르지 않습니다." }, 502);
  }

  const reply =
    (data as { choices?: Array<{ message?: { content?: string } }> })
      ?.choices?.[0]?.message?.content?.trim() ?? "";

  if (!reply) {
    return jsonResponse({ error: "빈 응답을 받았습니다. 다시 시도해 주세요." }, 502);
  }

  return jsonResponse({ reply });
});
