import {
  WebSearchProviderError,
  type WebSearchHit,
  type WebSearchProviderClient
} from "../types";

const EMPTY_MARKER = "无结果";
const MAX_FAUX_RESULTS = 3;
/** Addresses containing these words make the Faux page fail or run long. */
const NO_CONTENT_MARKER = "no-content";
const LONG_MARKER = "long";

/**
 * Stands in for the real service in the local Faux runtime: no network, fixed
 * results, reserved example addresses. A query containing “无结果” finds nothing;
 * an address containing “no-content” yields no page and one containing “long”
 * yields a page longer than the model reads.
 */
export const fauxWebSearchClient: WebSearchProviderClient = {
  id: "deepseek",
  maxQps: 1_000,
  queryHint: "本地演示搜索源，返回固定的示例结果。",
  fetch: {
    maxQps: 1_000,
    async page(request) {
      const { pathname } = new URL(request.url);
      if (pathname.includes(NO_CONTENT_MARKER))
        throw new WebSearchProviderError("no_content", false);
      const paragraphs = pathname.includes(LONG_MARKER) ? 1_500 : 3;
      return {
        title: "示例网页",
        url: request.url,
        content: [
          "# 示例网页",
          ...Array.from(
            { length: paragraphs },
            (_, index) =>
              `第 ${index + 1} 段：本地演示读取的固定正文，不来自真实网页。`
          )
        ].join("\n\n")
      };
    }
  },
  async search(request): Promise<WebSearchHit[]> {
    if (request.query.includes(EMPTY_MARKER)) return [];
    const slug = encodeURIComponent(request.query).slice(0, 48);
    return Array.from(
      { length: Math.min(request.count, MAX_FAUX_RESULTS) },
      (_, index) => ({
        title: `「${request.query}」相关资料 ${index + 1}`,
        url: `https://example.test/search/${slug}/${index + 1}`,
        siteName: "示例资料站",
        publishedAt: `2026-01-0${index + 1}T00:00:00+00:00`,
        snippet: `示例摘要 ${index + 1}：关于「${request.query}」的公开资料。`,
        summary: `示例长摘要 ${index + 1}：这是本地演示搜索源为「${request.query}」生成的固定内容，不来自真实网页。`
      })
    );
  }
};
