import { describe, expect, it, vi } from "vitest";
import { fauxWebSearchClient } from "./providers/faux";
import { testWebSearchProvider } from "./test-search";
import { TEST_KEY } from "./test-support";
import { WebSearchProviderError } from "./types";

describe("Faux search client", () => {
  const context = {
    apiKey: TEST_KEY,
    baseUrl: "https://search.example.test",
    fetch: vi.fn() as unknown as typeof fetch,
    signal: new AbortController().signal
  };

  it("returns fixed results on reserved example addresses, without the network", async () => {
    const hits = await fauxWebSearchClient.search(
      { query: "驿站", count: 8 },
      context
    );
    expect(hits).toHaveLength(3);
    expect(
      hits.every((entry) => entry.url.startsWith("https://example.test/"))
    ).toBe(true);
    expect(
      await fauxWebSearchClient.search({ query: "驿站", count: 2 }, context)
    ).toHaveLength(2);
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it("finds nothing for a query that asks for it", async () => {
    expect(
      await fauxWebSearchClient.search(
        { query: "这次无结果", count: 5 },
        context
      )
    ).toEqual([]);
  });
});

describe("Faux page reads", () => {
  const context = {
    apiKey: TEST_KEY,
    baseUrl: "https://search.example.test",
    fetch: vi.fn() as unknown as typeof fetch,
    signal: new AbortController().signal
  };
  const read = (url: string) =>
    fauxWebSearchClient.fetch!.page({ url }, context);

  it("returns a fixed page for the address, without the network", async () => {
    const page = await read("https://example.test/docs/a");
    expect(page).toMatchObject({
      title: "示例网页",
      url: "https://example.test/docs/a"
    });
    expect(page.content).toContain("不来自真实网页");
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it("can fail with no content, or run past what the model reads", async () => {
    await expect(read("https://example.test/no-content")).rejects.toMatchObject(
      { kind: "no_content" }
    );
    const long = await read("https://example.test/long");
    expect([...long.content].length).toBeGreaterThan(12_000);
  });
});

describe("testWebSearchProvider", () => {
  const input = {
    providerId: "deepseek" as const,
    baseUrl: "https://search.example.test",
    apiKey: TEST_KEY,
    query: "DeepWrite"
  };
  const result = (title: string) => ({
    title,
    url: `https://example.test/${title}`,
    summary: "摘要",
    snippet: "摘要",
    site_name: "示例站"
  });

  it("asks for three results and reports the count with short samples", async () => {
    const fetchStub = vi.fn(async () =>
      Response.json({ results: [result("a"), result("b"), result("c")] })
    );
    const outcome = await testWebSearchProvider(input, {
      fetch: fetchStub as unknown as typeof fetch,
      signal: new AbortController().signal
    });
    expect(
      JSON.parse(
        (fetchStub.mock.calls[0] as unknown as [string, RequestInit])[1]
          .body as string
      )
    ).toMatchObject({
      query: "DeepWrite",
      count: 3
    });
    expect(outcome).toEqual({
      resultCount: 3,
      samples: ["a", "b", "c"].map((title) => ({
        title,
        url: `https://example.test/${title}`,
        siteName: "示例站"
      }))
    });
  });

  it("lets provider failures through and reads an abort as a timeout", async () => {
    const unauthorized = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(
      testWebSearchProvider(input, {
        fetch: unauthorized as unknown as typeof fetch,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ kind: "auth" });
    const slow = vi.fn(async () => {
      throw new DOMException("slow", "TimeoutError");
    });
    const error = await testWebSearchProvider(input, {
      fetch: slow as unknown as typeof fetch,
      signal: new AbortController().signal
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebSearchProviderError);
    expect(error).toMatchObject({ kind: "timeout", retryable: true });
  });
});
