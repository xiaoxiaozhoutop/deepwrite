/** One result of a finished web search, as read back from the tool's text. */
export interface WebSearchSource {
  title: string;
  url: string;
  /** Site name, when the service gave one. */
  site?: string;
  /** `YYYY-MM-DD`, when the service gave a date. */
  date?: string;
}

export interface WebSearchSummary {
  query: string;
  /** The count the search reported, which can exceed what survived truncation. */
  total: number | undefined;
  sources: WebSearchSource[];
  /** The search ran and found nothing. */
  empty: boolean;
}

/** The page a finished `web_fetch` read, as its text leads with it. */
export interface WebFetchPage {
  title: string;
  url: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function httpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the text `web_search` returns to the model: a header with the query
 * and count, then `[n] title` / `来源：site · date · url` per result. The
 * conversation keeps only this text, so it is the one source for the card.
 * An entry cut short by the summary limit has no link and is left out.
 */
export function parseWebSearchSummary(text: string): WebSearchSummary {
  const lines = text.split("\n");
  const query = /^联网搜索：(.*)$/u.exec(lines[0] ?? "")?.[1]?.trim() ?? "";
  const total = Number(/共 (\d+) 条结果/u.exec(text)?.[1]);
  const sources: WebSearchSource[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^\[\d+\] (.+)$/u.exec(lines[index]!);
    const origin = /^来源：(.+)$/u.exec(lines[index + 1] ?? "");
    if (!heading || !origin) continue;
    const parts = origin[1]!.split(" · ").map((part) => part.trim());
    const url = httpUrl(parts.pop() ?? "");
    if (!url) continue;
    const date = parts.find((part) => DATE.test(part));
    const site = parts.filter((part) => part && part !== date).join(" · ");
    sources.push({
      title: heading[1]!.trim(),
      url,
      ...(site ? { site } : {}),
      ...(date ? { date } : {})
    });
  }
  return {
    query,
    total: Number.isFinite(total) ? total : undefined,
    sources,
    empty: /没有找到相关结果/u.test(text)
  };
}

/**
 * Reads the first lines `web_fetch` returns to the model: `网页正文：title`
 * then `来源：url`. The page text after them is never needed for the card.
 */
export function parseWebFetchSummary(text: string): WebFetchPage | undefined {
  const lines = text.split("\n");
  const title = /^网页正文：(.*)$/u.exec(lines[0] ?? "")?.[1]?.trim();
  const url = httpUrl(/^来源：(.+)$/u.exec(lines[1] ?? "")?.[1]?.trim() ?? "");
  return title !== undefined && url ? { title, url } : undefined;
}
