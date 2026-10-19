import { describe, expect, it } from "vitest";
import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  WEB_TOOL_COMPACTORS,
  webFetchCompactor,
  webSearchCompactor
} from "./compactor";
import { formatWebPage, formatWebSearchResult } from "./format";
import type { WebFetchToolDetails } from "./fetch-tool";
import { hit, page } from "./test-support";
import type { WebSearchToolDetails } from "./tool";

const hits = Array.from({ length: 12 }, (_, index) =>
  hit(index + 1, { summary: "文".repeat(300) })
);

function resultMessage(
  text: string,
  overrides: Partial<ToolResultMessage> = {}
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "web_search",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 0,
    ...overrides
  } as ToolResultMessage;
}

const call = (query: unknown): ToolCall =>
  ({
    type: "toolCall",
    id: "call_1",
    name: "web_search",
    arguments: { query }
  }) as ToolCall;

describe("webSearchCompactor", () => {
  it("keeps short results and failures as they are", () => {
    const short = resultMessage(formatWebSearchResult("短", [hit(1)]));
    expect(webSearchCompactor.result!(short, call("短"))).toBeUndefined();
    const failure = resultMessage("错".repeat(2_000), { isError: true });
    expect(webSearchCompactor.result!(failure, call("错"))).toBeUndefined();
  });

  it("replaces an old result by the query and the first ten titles and links", () => {
    const details: WebSearchToolDetails = {
      kind: "web-search",
      providerId: "deepseek",
      query: "唐代驿站",
      cached: false,
      callIndex: 1,
      callLimit: 20,
      results: hits.map(({ title, url, snippet }) => ({ title, url, snippet }))
    };
    const message = resultMessage(formatWebSearchResult("唐代驿站", hits), {
      details: details as never
    });
    const placeholder = webSearchCompactor.result!(message, call("唐代驿站"))!;
    expect(placeholder).toContain("已联网搜索「唐代驿站」，共 12 条结果");
    expect(placeholder).toContain("1. 结果 1 https://example.test/1");
    expect(placeholder).toContain("10. 结果 10 https://example.test/10");
    expect(placeholder).not.toContain("11. ");
    expect(placeholder).toContain("摘要已移出上下文");
    expect(placeholder).not.toContain("文".repeat(50));
  });

  it("reads titles and links from the text when the conversation was restored", () => {
    const message = resultMessage(formatWebSearchResult("恢复", hits));
    const placeholder = webSearchCompactor.result!(message, undefined)!;
    expect(placeholder).toContain("已联网搜索「恢复」，共 12 条结果");
    expect(placeholder).toContain("3. 结果 3 https://example.test/3");
  });
});

describe("webFetchCompactor", () => {
  const long = page(1, { content: "# 网页 1\n\n" + "文".repeat(3_000) });
  const text = formatWebPage({ ...long, totalChars: 3_008 });
  const fetchCall = (url: unknown): ToolCall =>
    ({
      type: "toolCall",
      id: "call_1",
      name: "web_fetch",
      arguments: { url }
    }) as ToolCall;

  it("is registered next to the search compactor for both tools", () => {
    expect(WEB_TOOL_COMPACTORS).toEqual({
      web_search: webSearchCompactor,
      web_fetch: webFetchCompactor
    });
  });

  it("keeps short pages and failures as they are", () => {
    const short = resultMessage(formatWebPage({ ...page(2), totalChars: 12 }), {
      toolName: "web_fetch"
    });
    expect(
      webFetchCompactor.result!(short, fetchCall(page(2).url))
    ).toBeUndefined();
    const failure = resultMessage("错".repeat(2_000), {
      toolName: "web_fetch",
      isError: true
    });
    expect(webFetchCompactor.result!(failure, undefined)).toBeUndefined();
  });

  it("replaces an old page by its title and address, dropping the text", () => {
    const details: WebFetchToolDetails = {
      kind: "web-fetch",
      providerId: "deepseek",
      url: long.url,
      title: long.title,
      cached: false,
      callIndex: 1,
      callLimit: 20,
      characters: 3_008,
      truncated: false
    };
    const message = resultMessage(text, {
      toolName: "web_fetch",
      details: details as never
    });
    const placeholder = webFetchCompactor.result!(message, fetchCall("x"))!;
    expect(placeholder).toBe(
      "〔已读取网页「网页 1」https://example.test/page/1，正文已移出上下文；需要时请重新读取。〕"
    );
    expect(placeholder).not.toContain("文".repeat(20));
  });

  it("reads title and address from the text when the conversation was restored", () => {
    const message = resultMessage(text, { toolName: "web_fetch" });
    const placeholder = webFetchCompactor.result!(message, undefined)!;
    expect(placeholder).toContain("「网页 1」https://example.test/page/1");
    expect(placeholder).not.toContain("文".repeat(20));
  });

  it("falls back to the call's address when the text has none", () => {
    const message = resultMessage("文".repeat(2_000), {
      toolName: "web_fetch"
    });
    const placeholder = webFetchCompactor.result!(
      message,
      fetchCall("https://example.test/from-call")
    )!;
    expect(placeholder).toContain("https://example.test/from-call");
    expect(placeholder).not.toContain("「");
  });
});
