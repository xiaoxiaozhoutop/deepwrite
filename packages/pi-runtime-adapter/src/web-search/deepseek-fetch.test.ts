import { describe, expect, it, vi } from "vitest";
import { deepSeekWebSearchClient } from "./providers/deepseek";
import { TEST_KEY } from "./test-support";
import { WebSearchProviderError, type WebFetchRequest } from "./types";

const PAGE = "https://example.test/article";

function read(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
  request: WebFetchRequest = { url: PAGE }
) {
  const fetchMock = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) =>
      respond(String(url), init!)
  );
  const result = deepSeekWebSearchClient.fetch!.page(request, {
    apiKey: TEST_KEY,
    baseUrl: "https://search.example.test/",
    fetch: fetchMock as unknown as typeof fetch,
    signal: new AbortController().signal
  });
  return { result, fetchMock };
}

async function failureOf(response: Response): Promise<WebSearchProviderError> {
  const error = await read(() => response).result.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(WebSearchProviderError);
  return error as WebSearchProviderError;
}

describe("DeepSeek fetch client", () => {
  it("declares its own rate apart from search", () => {
    expect(deepSeekWebSearchClient.fetch).toMatchObject({ maxQps: 5 });
  });

  it("posts only the address, with the key as a bearer token", async () => {
    const { result, fetchMock } = read(() =>
      Response.json({ title: "标题", content: "# 标题\n\n正文" })
    );
    await result;
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://search.example.test/v1/tools/fetch");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "content-type": "application/json"
      }
    });
    expect(JSON.parse(init!.body as string)).toEqual({ url: PAGE });
  });

  it("maps title and Markdown content, trimming both", async () => {
    const { result } = read(() =>
      Response.json({
        title: "  标题  ",
        content: "\n# 标题\n\n正文\n",
        extra: 1
      })
    );
    await expect(result).resolves.toEqual({
      title: "标题",
      url: PAGE,
      content: "# 标题\n\n正文"
    });
  });

  it("accepts a page without a title", async () => {
    const { result } = read(() =>
      Response.json({ title: "", content: "正文" })
    );
    await expect(result).resolves.toMatchObject({ title: "" });
  });

  it("treats a 200 without text as no content, since only text is billed", async () => {
    const empty = await failureOf(Response.json({ title: "t", content: "  " }));
    expect(empty).toMatchObject({ kind: "no_content", retryable: false });
  });

  it("rejects a reply that is not the documented shape", async () => {
    for (const body of [
      { title: "t" },
      { content: 3 },
      [],
      "text"
    ] as unknown[]) {
      expect(await failureOf(Response.json(body))).toMatchObject({
        kind: "invalid_response",
        retryable: false
      });
    }
    expect(await failureOf(new Response("not json"))).toMatchObject({
      kind: "invalid_response"
    });
  });

  it.each([
    [400, "bad_request", false],
    [413, "bad_request", false],
    [401, "auth", false],
    [402, "balance", false],
    [403, "blocked", false],
    [404, "no_content", false],
    [408, "timeout", true],
    [504, "timeout", true],
    [500, "unavailable", true],
    [502, "unavailable", true],
    [418, "unavailable", false]
  ] as const)(
    "maps HTTP %s to %s (retryable: %s)",
    async (status, kind, retry) => {
      expect(await failureOf(new Response("{}", { status }))).toMatchObject({
        kind,
        retryable: retry
      });
    }
  );

  it("retries a rate limit and honours Retry-After, capped at ten seconds", async () => {
    const limited = await failureOf(
      new Response("{}", { status: 429, headers: { "retry-after": "3" } })
    );
    expect(limited).toMatchObject({
      kind: "rate_limit",
      retryable: true,
      retryAfterMs: 3_000
    });
    const long = await failureOf(
      new Response("{}", { status: 429, headers: { "retry-after": "600" } })
    );
    expect(long.retryAfterMs).toBe(10_000);
  });

  it("never carries the service's error text into the failure", async () => {
    const error = await failureOf(
      new Response(JSON.stringify({ error: { message: `key ${TEST_KEY}` } }), {
        status: 403
      })
    );
    expect(JSON.stringify(error)).not.toContain(TEST_KEY);
    expect(error.message).toBe("blocked");
  });

  it("refuses an address longer than the service takes without sending it", async () => {
    const { result, fetchMock } = read(() => Response.json({}), {
      url: `https://example.test/${"a".repeat(8192)}`
    });
    await expect(result).rejects.toMatchObject({ kind: "bad_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up on a reply larger than eight megabytes", async () => {
    const huge = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024));
        }
      })
    );
    expect(await failureOf(huge)).toMatchObject({ kind: "invalid_response" });
    const declared = new Response("{}", {
      headers: { "content-length": String(9 * 1024 * 1024) }
    });
    expect(await failureOf(declared)).toMatchObject({
      kind: "invalid_response"
    });
  });

  it("reports a transport failure as retryable and lets aborts through", async () => {
    const down = await read(() => {
      throw new TypeError("fetch failed");
    }).result.catch((e: unknown) => e);
    expect(down).toMatchObject({ kind: "unavailable", retryable: true });
    const timeout = await read(() => {
      throw new DOMException("slow", "TimeoutError");
    }).result.catch((e: unknown) => e);
    expect(timeout).toBeInstanceOf(DOMException);
  });
});
