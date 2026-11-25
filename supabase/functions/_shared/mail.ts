/*
  Nyekora Archive — 공용 메일 유틸리티 (mail.ts)
  - Edge Function 내부에서 사용
  - MIME/HTML/텍스트 메일 생성, HTML escape, 링크 생성
*/

/**
 * HTML을 안전하게 이스케이프합니다.
 * 메일 본문에 사용자 제어를 직접 삽입하지 않도록 보호합니다.
 */
export function htmlEscape(text: string): string {
  return String(text)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """)
    .replace(/'/g, "&#039;");
}

/**
 * Proposal 항목에서 제목을 카테고리 이름과 함께 포맷합니다.
 */
export function formatTitle(item: { t: string; c: string; CAT_NAME?: Record<string, string> }): string {
  const catName = item.CAT_NAME?.[item.c] || item.c || "분류";
  return `${htmlEscape(item.t)} (${catName})`;
}

/**
 * 직접 링크를 생성합니다. (#item-id 형태)
 * PUBLIC_SITE_URL과 조합하여 full URL을 만듭니다.
 */
export function buildRecordLink(itemId: string, siteUrl: string): string {
  const encodedId = encodeURIComponent(itemId);
  return `${siteUrl}/#${encodedId}`;
}

/**
 * 이메일 제목을 생성합니다.
 */
export function buildEmailSubject(action: "test" | "send" | "preview", topN: number): string {
  const prefixes = {
    test: "[니에코라 기록관] 테스트 우선순위 메일",
    send: `[니에코라 기록관] 리뷰 우선순위 추천 (Top ${topN})`,
    preview: "[니에코라 기록관] 우선순위 미리보기",
  };
  return (prefixes[action] || "니에코라 기록관 알림");
}

/**
 * HTML 메일 본문을 생성합니다.
 * 항목 데이터와 설정 정보를 받아 전체 HTML을 구성합니다.
 */
export function buildEmailHtml({
  recipient,
  topItems,
  settingsLink,
  totalAnalyzed,
  siteUrl = "https://jjunjjun2010.github.io/nyekora-archive",
}: {
  recipient: string;
  topItems: Array<{
    rank: number;
    title: string;
    category: string;
    score: number;
    reason: string;
    link: string;
  }>;
  settingsLink: string;
  totalAnalyzed: number;
  siteUrl?: string;
}): string {
  const sorted = [...topItems].sort((a, b) => a.rank - b.rank);
  const now = new Date().toLocaleString("ko-KR");

  const itemsHtml = sorted.map((item) => `
    <div style="border-bottom: 1px solid #e0e0e0; padding: 12px 0;">
      <div style="font-size: 14px; font-weight: 600;">
        ${item.rank}. ${htmlEscape(item.title)}
      </div>
      <div style="font-size: 12px; color: #666; margin-top: 4px;">
        카테고리: ${htmlEscape(item.category)} · 점수: ${item.score}점
      </div>
      <div style="font-size: 12px; color: #555; margin-top: 4px; line-height: 1.4;">
        이유: ${htmlEscape(item.reason)}
      </div>
      <div style="font-size: 11px; color: #888; margin-top: 4px;">
        <a href="${item.link}" target="_blank" style="color: #2c3e50;">
          기록관 상세 보기
        </a>
      </div>
    </div>`).join("");

  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>니에코라 기록관 리뷰 우선순위</title>
  <style>
    body { margin: 0; padding: 20px; font-family: 'Noto Sans KR', sans-serif; background: #fafafa; color: #14213d; }
    .max-width { max-width: 600px; margin: 0 auto; }
    .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #d6b25e; }
    .header h1 { margin: 0; font-size: 24px; color: #14213d; }
    .header p { margin: 8px 0 0; font-size: 14px; color: #666; }
    .section { padding: 20px 0; }
    .section h2 { margin: 0 0 12px; font-size: 18px; color: #14213d; border-left: 4px solid #d6b25e; padding-left: 8px; }
    .item { margin-bottom: 20px; padding: 12px; background: #fff; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .item h3 { margin: 0 0 8px; font-size: 16px; color: #14213d; }
    .item meta { font-size: 12px; color: #666; margin-bottom: 8px; }
    .item reason { font-size: 13px; line-height: 1.4; color: #333; }
    .item .link { font-size: 11px; color: #7f8c8d; margin-top: 8px; display: inline-block; }
    .footer { text-align: center; padding: 20px 0; font-size: 11px; color: #999; border-top: 1px solid #e0e0e0; }
    .note { text-align: center; font-size: 11px; color: #666; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="max-width">
    <div class="header">
      <h1>니에코라 기록관 리뷰 우선순위</h1>
      <p>AI가 분석한 우선순위 Top 5를 전달합니다</p>
    </div>

    <div class="section">
      <h2>검토가 권장되는 설정 Top 5</h2>
      ${itemsHtml || '<p class="note">분석할 항목이 없습니다.</p>'}
    </div>

    <div class="note">
      이 메일은 niekora-archive의 알림 기능으로 전송되었습니다.<br>
      수신을 원하지 않으시면 사이트 설정에서 알림을 끄거나 주기를 변경해 주세요.
    </div>
  </div>
</body>
</html>
`;
}

/**
 * 텍스트 메일 본문을 생성합니다.
 */
export function buildEmailText({
  recipient,
  topItems,
  settingsLink,
  totalAnalyzed,
}: {
  recipient: string;
  topItems: Array<{
    rank: number;
    title: string;
    category: string;
    score: number;
    reason: string;
    link: string;
  }>;
  settingsLink: string;
}): string {
  const sorted = [...topItems].sort((a, b) => a.rank - b.rank);
  const now = new Date().toLocaleString("ko-KR");

  const lines = [
    "니에코라 기록관 리뷰 우선순위 추천",
    "============================",
    `발송 일시: ${now}`,
    `총 분석 항목: ${totalAnalyzed}개`,
    "",
    "검토가 권장되는 설정 Top 5:",
    "",
  ];

  sorted.forEach((item) => {
    lines.push(
      `${item.rank}. ${htmlEscape(item.title)}`,
      `   카테고리: ${htmlEscape(item.category)} · 점수: ${item.score}점`,
      `   이유: ${htmlEscape(item.reason)}`,
      `   상세 보기: ${htmlEscape(item.link)}`,
      "",
    );
  });

  lines.push(
    "----------------------------",
    "이 메일은 niekora-archive의 알림 기능으로 전송되었습니다.",
    "수신을 원하지 않으시면 사이트 설정에서 알림을 끄거나 주기를 변경해 주세요.",
  );

  return lines.join("\n");
}