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
const MAX_OUTPUT_TOKENS = 1024; // 한국어 응답이 중간에 끊기지 않도록 여유 있게 설정

// 기록관 참고 자료 (브라우저에서 질문과 관련된 항목만 골라 보낸다)
const MAX_LORE_ITEMS = 6;
const MAX_LORE_TOTAL_CHARS = 4200;
const MAX_LORE_TITLE_CHARS = 120;
const MAX_LORE_CLAIM_CHARS = 700;
const LORE_STATUSES = new Set(["Canon", "Proposal", "Unknown", "Conflict"]);
const LORE_STATUS_LABEL: Record<string, string> = {
  Canon: "확정",
  Proposal: "제안",
  Unknown: "미확인",
  Conflict: "충돌",
};
const LORE_BRIEF_OPEN = "[[NYEKORA_LORE_BRIEF]]";
const LORE_BRIEF_CLOSE = "[[/NYEKORA_LORE_BRIEF]]";

const MAX_SUMMARY_MESSAGES = 60;
const MAX_SUMMARY_MESSAGE_CHARS = 1200;
const MAX_SUMMARY_TOTAL_CHARS = 12000;
const MAX_MEMORY_SUMMARY_CHARS = 1200;
const MAX_MEMORY_FACTS = 12;
const MAX_MEMORY_FACT_CHARS = 200;
const MAX_SUMMARY_OUTPUT_TOKENS = 600;

type ErrorType =
  | "missing_key"
  | "rate_limit"
  | "bad_request"
  | "upstream_error"
  | "upstream_rate_limit"
  | "parse_error"
  | "empty_response";

const hits = new Map<string, { count: number; reset: number }>();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || "unknown";
}

function rateLimitInfo(ip: string): { limited: boolean; retryAfter: number } {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [key, value] of hits) {
      if (now > value.reset) hits.delete(key);
    }
  }
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) {
    hits.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return { limited: false, retryAfter: 0 };
  }
  rec.count += 1;
  if (rec.count <= RATE_LIMIT) {
    return { limited: false, retryAfter: 0 };
  }
  const retryAfter = Math.max(1, Math.ceil((rec.reset - now) / 1000));
  return { limited: true, retryAfter };
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "x-error-type, x-retry-after",
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function errorResponse(
  status: number,
  error: string,
  type: ErrorType,
  retryAfterSeconds?: number,
): Response {
  const headers: Record<string, string> = { "x-error-type": type };
  if (retryAfterSeconds != null) {
    headers["x-retry-after"] = String(retryAfterSeconds);
  }
  console.error("Edge Function error", { status, type, message: error });
  return jsonResponse({ error, type, status }, status, headers);
}

function clampText(value: unknown, maxChars: number): string {
  return typeof value === "string" ? value.slice(0, maxChars).trim() : "";
}

type ChatMessage = { role: "user" | "assistant"; content: string };
type LoreEntry = { id: string; title: string; status: string; category: string; claim: string };
type NpcMemory = { summary: string; facts: string[] };

// 기존 배포본과의 호환용 짧은 참고자료 블록을 메시지에서 제거한다.
// 새 함수는 구조화된 lore 필드를 system prompt에 넣는다.
function stripLoreBrief(text: string): string {
  const start = text.indexOf(LORE_BRIEF_OPEN);
  if (start === -1) return text;
  const end = text.indexOf(LORE_BRIEF_CLOSE, start + LORE_BRIEF_OPEN.length);
  if (end === -1) return text;
  return (text.slice(0, start) + text.slice(end + LORE_BRIEF_CLOSE.length)).trim();
}

function parseMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const rawContent = (item as { content?: unknown }).content;
    const content = clampText(
      stripLoreBrief(typeof rawContent === "string" ? rawContent : ""),
      MAX_MESSAGE_CHARS,
    );
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

function parseLore(raw: unknown): LoreEntry[] {
  if (!Array.isArray(raw)) return [];

  const out: LoreEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const status = String((item as { s?: unknown }).s ?? "");
    if (!LORE_STATUSES.has(status)) continue; // Rejected 등은 참고자료에서 제외

    const title = clampText((item as { t?: unknown }).t, MAX_LORE_TITLE_CHARS);
    const claim = clampText((item as { claim?: unknown }).claim, MAX_LORE_CLAIM_CHARS);
    if (!title || !claim) continue;

    out.push({
      id: clampText((item as { id?: unknown }).id, 80),
      title,
      status,
      category: clampText((item as { c?: unknown }).c, 40),
      claim,
    });
  }

  let limited = out.slice(0, MAX_LORE_ITEMS);
  let total = limited.reduce((sum, entry) => sum + entry.claim.length, 0);
  while (limited.length > 1 && total > MAX_LORE_TOTAL_CHARS) {
    total -= limited[0].claim.length;
    limited = limited.slice(1);
  }
  return limited;
}

function parseSummaryMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];

  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = clampText((item as { content?: unknown }).content, MAX_SUMMARY_MESSAGE_CHARS);
    if ((role === "user" || role === "assistant") && content) {
      out.push({ role, content });
    }
  }

  let trimmed = out.slice(-MAX_SUMMARY_MESSAGES);
  let total = trimmed.reduce((sum, message) => sum + message.content.length, 0);
  while (trimmed.length > 1 && total > MAX_SUMMARY_TOTAL_CHARS) {
    total -= trimmed[0].content.length;
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

function parseMemory(raw: unknown): NpcMemory {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const summary = clampText(source.summary, MAX_MEMORY_SUMMARY_CHARS);
  const facts: string[] = [];

  if (Array.isArray(source.facts)) {
    for (const item of source.facts) {
      const fact = clampText(item, MAX_MEMORY_FACT_CHARS);
      if (!fact || facts.includes(fact)) continue;
      facts.push(fact);
      if (facts.length >= MAX_MEMORY_FACTS) break;
    }
  }

  return { summary, facts };
}

function buildSystemPrompt(
  state: Record<string, string>,
  lore: LoreEntry[],
  memory: NpcMemory,
): string {
  const loreLines: string[] = [];

  if (lore.length) {
    loreLines.push("", "기록관 참고 자료 (확정 여부 구분):");
    for (const entry of lore) {
      const label = LORE_STATUS_LABEL[entry.status] || entry.status;
      loreLines.push(`- [${label} ${entry.status}] ${entry.title}: ${entry.claim}`);
    }
    loreLines.push(
      "",
      "기록 사용 규칙:",
      "- [확정 Canon]만 확정된 사실로 단정한다.",
      "- [제안 Proposal]은 아직 확정되지 않은 제안으로만 말하고, 공식 사실처럼 단정하지 않는다.",
      "- [미확인 Unknown]은 기록에 확인된 내용이 없다는 뜻이므로, 사실처럼 말하지 않는다.",
      "- [충돌 Conflict]은 자료마다 서술이 다르며 아직 확정되지 않았다고 말한다.",
      "- 참고 자료에 없는 내용은 새로 지어내지 않는다.",
      "- 답변에 참고한 기록이 있으면 '기록관 기록에는 …'처럼 자연스럽게 근거를 밝힌다.",
    );
  } else {
    loreLines.push(
      "",
      "기록관 참고 자료:",
      "- 이번 질문과 관련해 확인된 기록을 찾지 못했다. 확정된 설정처럼 지어내지 말고, 모르면 모른다고 말한다.",
    );
  }

  const memoryLines: string[] = [];
  if (memory.summary || memory.facts.length) {
    memoryLines.push("", "장기 기억 (이전 대화에서 정리된 내용):");
    if (memory.summary) memoryLines.push(`- 요약: ${memory.summary}`);
    for (const fact of memory.facts) memoryLines.push(`- ${fact}`);
    memoryLines.push("- 위 기억에 없는 내용은 지어내지 않는다. 기억이 불확실하면 불확실하다고 말한다.");
  }

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
    ...loreLines,
    ...memoryLines,
    "",
    "대화 규칙:",
    "- 항상 루와타로서 1인칭으로, 한국어로 대답한다.",
    "- 2~4문장 정도의 짧은 대화체로 답한다. 긴 설명이나 목록은 피한다.",
    "- 확정되지 않은 마을 설정을 새로 지어내지 않는다. 모르는 것은 모른다고 하거나 추측임을 밝힌다.",
    "- 기록관 자료 일부만으로 세계관 전체를 단정하지 않는다. 자료에 없는 내용은 지어내지 않는다.",
    "- 기록관에 없는 정보를 묻거나 기록이 부족하면 '그건 기록관에 남아 있지 않아서 잘 모르겠어요' 또는 '제 추측일 뿐이에요'라고 답한다.",
    "- 악기, 소리, 재료, 작업에 관한 이야기를 자연스럽게 섞는다.",
    "- 마을 바깥의 현실 세계 이야기가 나오면 루와타는 그런 것을 모른다고 반응한다.",
    "- '이어서' 또는 '계속'이라고 하면, 직전 답변의 문맥을 자연스럽게 이어간다. 직전 내용을 그대로 반복하지 않는다.",
  ];
  return lines.join("\n");
}

async function summarizeMemory(
  memory: NpcMemory,
  messages: ChatMessage[],
): Promise<{ summary: string; facts: string[] }> {
  const transcript = messages.map((message) =>
    `${message.role === "assistant" ? "Ruwata" : "사용자"}: ${message.content}`
  ).join("\n");

  const existing = memory.summary || memory.facts.length
    ? [
      "기존 기억:",
      memory.summary ? `- 요약: ${memory.summary}` : "",
      ...memory.facts.map((fact) => `- ${fact}`),
    ].filter(Boolean).join("\n")
    : "기존 기억: 없음";

  const systemPrompt = [
    "당신은 니에코라 마을 NPC 'Ruwata(루와타)'의 장기 기억을 정리하는 도우미입니다.",
    "아래 '기존 기억'과 '최근 대화'를 바탕으로, 앞으로의 대화에 도움이 될 사실만 간결하게 정리하세요.",
    "규칙:",
    "- 사용자가 알려 준 선호, 약속, 중요한 사건, 관계 변화만 남긴다.",
    "- 추측하거나 새로운 설정을 지어내지 않는다.",
    "- 확정되지 않은 내용은 '미확인'이라고 표시한다.",
    "- 한국어로 작성한다.",
    "- 반드시 JSON만 출력한다. 형식: {\"summary\": \"3~6문장\", \"facts\": [\"짧은 사실\"]}",
    "- facts는 최대 12개, 각 60자 이내로 짧게 쓴다.",
  ].join("\n");

  const upstream = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + OLLAMA_API_KEY,
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: existing + "\n\n최근 대화:\n" + transcript },
      ],
      stream: false,
      temperature: 0.3,
      max_tokens: MAX_SUMMARY_OUTPUT_TOKENS,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    throw new Error(`summary upstream ${upstream.status}: ${detail.slice(0, 200)}`);
  }

  const data = await upstream.json();
  const text = (data as { choices?: Array<{ message?: { content?: string } }> })
    ?.choices?.[0]?.message?.content?.trim() ?? "";

  let summary = "";
  let facts: string[] = [];

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { summary?: unknown; facts?: unknown };
      summary = clampText(parsed.summary, MAX_MEMORY_SUMMARY_CHARS);
      if (Array.isArray(parsed.facts)) {
        for (const item of parsed.facts) {
          const fact = clampText(item, MAX_MEMORY_FACT_CHARS);
          if (!fact || facts.includes(fact)) continue;
          facts.push(fact);
          if (facts.length >= MAX_MEMORY_FACTS) break;
        }
      }
    } catch {
      summary = "";
    }
  }

  if (!summary && !facts.length) {
    summary = clampText(text, MAX_MEMORY_SUMMARY_CHARS);
  }

  return { summary, facts };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "POST만 지원합니다." }, 405);
  }
  if (!OLLAMA_API_KEY) {
    return errorResponse(500, "서버에 API 키가 설정되지 않았습니다.", "missing_key");
  }
  const limitInfo = rateLimitInfo(clientIp(req));
  if (limitInfo.limited) {
    return errorResponse(
      429,
      "요청이 너무 많습니다. 잠시 후에 다시 시도해 주세요.",
      "rate_limit",
      limitInfo.retryAfter,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "요청 형식이 올바르지 않습니다.", "bad_request");
  }

  const payload = (body ?? {}) as Record<string, unknown>;

  if (payload.mode === "summarize") {
    const summaryMessages = parseSummaryMessages(payload.messages);
    if (summaryMessages.length === 0) {
      return errorResponse(400, "요약할 대화가 필요합니다.", "bad_request");
    }
    try {
      const result = await summarizeMemory(parseMemory(payload.memory), summaryMessages);
      return jsonResponse(result);
    } catch (err) {
      console.error("Memory summarize failed", err instanceof Error ? err.message : String(err));
      return errorResponse(502, "기억을 정리하지 못했습니다. 잠시 후 다시 시도해 주세요.", "upstream_error");
    }
  }

  const messages = parseMessages(payload.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return errorResponse(400, "사용자 메시지가 필요합니다.", "bad_request");
  }

  const rawState = (payload.state ?? {}) as Record<string, unknown>;
  const state: Record<string, string> = {
    time: clampText(rawState.time, 10),
    period: clampText(rawState.period, 10),
    status: clampText(rawState.status, 60),
    activity: clampText(rawState.activity, 200),
  };

  const lore = parseLore(payload.lore);
  const memory = parseMemory(payload.memory);

  const ollamaMessages = [
    { role: "system", content: buildSystemPrompt(state, lore, memory) },
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
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.error("Ollama fetch failed", err instanceof Error ? err.message : String(err));
    return errorResponse(502, "응답을 받지 못했습니다. 잠시 후에 다시 시도해 주세요.", "upstream_error");
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("Ollama upstream error", upstream.status, detail.slice(0, 500));
    if (upstream.status === 429) {
      return errorResponse(
        429,
        "지금은 손님이 많아 대답하기 어렵습니다. 잠시 뒤에 다시 말을 걸어 주세요.",
        "upstream_rate_limit",
      );
    }
    return errorResponse(
      502,
      "지금은 대답할 수 없습니다. 잠시 후에 다시 시도해 주세요.",
      "upstream_error",
    );
  }

  let data: unknown;
  try {
    data = await upstream.json();
  } catch {
    return errorResponse(502, "응답 형식이 올바르지 않습니다.", "parse_error");
  }

  const firstChoice = (data as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> })
    ?.choices?.[0];
  const reply = firstChoice?.message?.content?.trim() ?? "";
  const finishReason = firstChoice?.finish_reason ?? "unknown";

  console.log("Ollama response", {
    model: OLLAMA_MODEL,
    finish_reason: finishReason,
    reply_length: reply.length,
  });

  if (!reply) {
    return errorResponse(502, "빈 응답을 받았습니다. 다시 시도해 주세요.", "empty_response");
  }

  return jsonResponse({
    reply,
    refs: lore.map((entry) => ({ id: entry.id, t: entry.title, s: entry.status })),
  });
});
