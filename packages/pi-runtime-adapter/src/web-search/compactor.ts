import type { ToolCompactor } from "../kernel/context";
import { textOf } from "../kernel/context";
import { isWebFetchToolDetails } from "./fetch-tool";
import { clipText } from "./format";
import { WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from "./tool-names";
import { isWebSearchToolDetails } from "./tool";

/** Old results are worth less than their summaries cost; keep titles and links. */
const SMALL_RESULT_CHARS = 800;
const TITLE_CHARS = 80;
const MAX_LISTED = 10;

interface Listed {
  title: string;
  url: string;
}

/** Restored conversations carry only the text, so fall back to reading it. */
function listedFromText(text: string): Listed[] {
  const listed: Listed[] = [];
  let title: string | undefined;
  for (const line of text.split("\n")) {
    const heading = /^\[\d+\] (.+)$/u.exec(line);
    if (heading) {
      title = heading[1]!;
      continue;
    }
    const source = /^来源：.*?(https?:\/\/\S+)$/u.exec(line);
    if (source && title !== undefined) {
      listed.push({ title, url: source[1]! });
      title = undefined;
    }
  }
  return listed;
}

export const webSearchCompactor: ToolCompactor = {
  result(result, call) {
    const text = textOf(result.content);
    if (result.isError || text.length <= SMALL_RESULT_CHARS) return undefined;
    const details: unknown = result.details;
    const listed: Listed[] = isWebSearchToolDetails(details)
      ? details.results.map(({ title, url }) => ({ title, url }))
      : listedFromText(text);
    const query =
      typeof call?.arguments?.query === "string"
        ? call.arguments.query
        : (/^联网搜索：(.+)$/mu.exec(text)?.[1] ?? "");
    const lines = listed
      .slice(0, MAX_LISTED)
      .map(
        (entry, index) =>
          `${index + 1}. ${clipText(entry.title, TITLE_CHARS)} ${entry.url}`
      );
    return `〔已联网搜索「${clipText(query, 60)}」，共 ${listed.length} 条结果${
      lines.length ? `：\n${lines.join("\n")}\n` : "。"
    }摘要已移出上下文；需要时请重新搜索。〕`;
  }
};

/** A page is mostly text the model has already used; keep what it was and where it came from. */
export const webFetchCompactor: ToolCompactor = {
  result(result, call) {
    const text = textOf(result.content);
    if (result.isError || text.length <= SMALL_RESULT_CHARS) return undefined;
    const details: unknown = result.details;
    const title = isWebFetchToolDetails(details)
      ? details.title
      : (/^网页正文：(.+)$/mu.exec(text)?.[1] ?? "");
    const url = isWebFetchToolDetails(details)
      ? details.url
      : (/^来源：(https?:\/\/\S+)$/mu.exec(text)?.[1] ??
        (typeof call?.arguments?.url === "string" ? call.arguments.url : ""));
    return `〔已读取网页${title ? `「${clipText(title, TITLE_CHARS)}」` : ""}${url}，正文已移出上下文；需要时请重新读取。〕`;
  }
};

/** Registered wherever the web tools are, so an old page shrinks like an old search. */
export const WEB_TOOL_COMPACTORS: Readonly<Record<string, ToolCompactor>> = {
  [WEB_SEARCH_TOOL_NAME]: webSearchCompactor,
  [WEB_FETCH_TOOL_NAME]: webFetchCompactor
};
