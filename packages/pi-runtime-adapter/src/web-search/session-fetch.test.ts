import { describe, expect, it } from "vitest";
import { WebSearchRateLimiter } from "./rate-limiter";
import { WebSearchLimitError, createWebSearchSession } from "./session";
import {
  deferred,
  hit,
  instantLimiter,
  page,
  recordingSleep,
  runtimeConfig,
  scriptedClient,
  type PageStep,
  type Step
} from "./test-support";
import { WEB_FETCH_CONTENT_MAX } from "./format";
import { WebSearchProviderError } from "./types";

function setup(
  pageSteps: PageStep[],
  config = runtimeConfig(),
  options: Parameters<typeof createWebSearchSession>[1] = {},
  steps: Step[] = [[hit(1)]]
) {
  const client = scriptedClient(steps, pageSteps);
  const sleeper = recordingSleep();
  const session = createWebSearchSession(config, {
    client,
    limiter: instantLimiter(),
    sleep: sleeper.sleep,
    random: () => 0,
    ...options
  });
  return { client, session, delays: sleeper.delays };
}

const read = (index: number) => ({ url: `https://example.test/page/${index}` });

describe("page reads in the search session", () => {
  it("reads when the provider can and says so", async () => {
    expect(setup([page(1)]).session.canFetch).toBe(true);
    expect(setup([page(1)]).session.fetchUrlMaxChars).toBe(8192);
    const searchOnly = createWebSearchSession(runtimeConfig(), {
      client: scriptedClient([[hit(1)]]),
      limiter: instantLimiter()
    });
    expect(searchOnly.canFetch).toBe(false);
    await expect(searchOnly.fetchPage(read(1))).rejects.toThrow(
      /cannot read pages/
    );
  });

  it("answers a repeated address from the cache without spending the budget", async () => {
    const { client, session } = setup([page(1)]);
    const first = await session.fetchPage(read(1));
    const again = await session.fetchPage(read(1));
    expect(client.pageRequests).toHaveLength(1);
    expect(first).toMatchObject({ cached: false, callIndex: 1, callLimit: 20 });
    expect(again).toMatchObject({ cached: true, callIndex: 1 });
    await session.fetchPage(read(2));
    expect(client.pageRequests).toHaveLength(2);
  });

  it("spends one budget with searches, which keep their own cache", async () => {
    const { client, session } = setup(
      [page(1)],
      runtimeConfig({ perRunCallLimit: 3 })
    );
    await session.search({ query: "驿站", count: 3 });
    await session.fetchPage(read(1));
    await session.fetchPage(read(2));
    await expect(session.fetchPage(read(3))).rejects.toBeInstanceOf(
      WebSearchLimitError
    );
    await expect(
      session.search({ query: "另一个", count: 3 })
    ).rejects.toBeInstanceOf(WebSearchLimitError);
    // What is already known is still answered once the budget is spent.
    await expect(session.fetchPage(read(1))).resolves.toMatchObject({
      cached: true
    });
    await expect(
      session.search({ query: "驿站", count: 3 })
    ).resolves.toMatchObject({ cached: true });
    expect(client.pageRequests).toHaveLength(2);
    expect(client.requests).toHaveLength(1);
  });

  it("does not mix a page with a search whose words equal its address", async () => {
    const { client, session } = setup([page(1)]);
    await session.search({ query: read(1).url, count: 3 });
    await session.fetchPage(read(1));
    expect(client.requests).toHaveLength(1);
    expect(client.pageRequests).toHaveLength(1);
  });

  it("shares one request between identical reads in flight", async () => {
    const gate = deferred<ReturnType<typeof page>>();
    const { client, session } = setup([() => gate.promise]);
    const first = session.fetchPage(read(1));
    const second = session.fetchPage(read(1));
    gate.resolve(page(1));
    const [one, two] = await Promise.all([first, second]);
    expect(client.pageRequests).toHaveLength(1);
    expect([one.cached, two.cached]).toEqual([false, true]);
  });

  it("never remembers a failed read and counts it once", async () => {
    const { client, session } = setup([
      new WebSearchProviderError("no_content", false),
      page(1)
    ]);
    await expect(session.fetchPage(read(1))).rejects.toMatchObject({
      kind: "no_content"
    });
    await expect(session.fetchPage(read(1))).resolves.toMatchObject({
      cached: false,
      callIndex: 2
    });
    expect(client.pageRequests).toHaveLength(2);
  });

  it("keeps what the model can read and the page's full length", async () => {
    const long = "字".repeat(WEB_FETCH_CONTENT_MAX + 500);
    const { session } = setup([page(1, { content: long })]);
    const { page: excerpt } = await session.fetchPage(read(1));
    expect([...excerpt.content]).toHaveLength(WEB_FETCH_CONTENT_MAX);
    expect(excerpt.totalChars).toBe(WEB_FETCH_CONTENT_MAX + 500);
    const short = await setup([
      page(2, { content: "一\r\n\r\n\r\n\r\n二  " })
    ]).session.fetchPage(read(2));
    expect(short.page).toMatchObject({ content: "一\n\n二", totalChars: 4 });
  });

  it("never cuts a character in half", async () => {
    const emoji = "😀".repeat(WEB_FETCH_CONTENT_MAX + 3);
    const { session } = setup([page(1, { content: emoji })]);
    const { page: excerpt } = await session.fetchPage(read(1));
    expect(excerpt.content).toBe("😀".repeat(WEB_FETCH_CONTENT_MAX));
    expect(excerpt.totalChars).toBe(WEB_FETCH_CONTENT_MAX + 3);
  });
});

describe("page read retries and pacing", () => {
  it("retries a transient failure once, after a second", async () => {
    const { client, session, delays } = setup([
      new WebSearchProviderError("unavailable", true),
      page(1)
    ]);
    await expect(session.fetchPage(read(1))).resolves.toMatchObject({
      callIndex: 1
    });
    expect(client.pageRequests).toHaveLength(2);
    expect(delays).toEqual([1_000]);
  });

  it("gives up after the one retry and passes the failure on", async () => {
    const { client, session } = setup([
      new WebSearchProviderError("rate_limit", true, 2_000)
    ]);
    await expect(session.fetchPage(read(1))).rejects.toMatchObject({
      kind: "rate_limit"
    });
    expect(client.pageRequests).toHaveLength(2);
  });

  it.each(["auth", "balance", "bad_request", "blocked", "no_content"] as const)(
    "does not retry %s",
    async (kind) => {
      const { client, session } = setup([
        new WebSearchProviderError(kind, false)
      ]);
      await expect(session.fetchPage(read(1))).rejects.toMatchObject({ kind });
      expect(client.pageRequests).toHaveLength(1);
    }
  );

  it("turns a timeout into a retryable failure", async () => {
    const { client, session } = setup([
      async () => {
        throw new DOMException("slow", "TimeoutError");
      },
      page(1)
    ]);
    await expect(session.fetchPage(read(1))).resolves.toBeDefined();
    expect(client.pageRequests).toHaveLength(2);
  });

  it("paces reads in a bucket apart from searches", async () => {
    const waits: number[] = [];
    let now = 0;
    const limiter = new WebSearchRateLimiter({
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      }
    });
    const { session } = setup([page(1)], runtimeConfig(), { limiter });
    await session.search({ query: "甲", count: 1 });
    await session.fetchPage(read(1));
    expect(waits).toEqual([]);
    await session.fetchPage(read(2));
    await session.search({ query: "乙", count: 1 });
    // Two reads in the same instant wait for the next slot of the fetch bucket
    // only; the second search had its own slot free.
    expect(waits).toEqual([200]);
  });

  it("stops a waiting or running read when the run is aborted", async () => {
    const controller = new AbortController();
    const gate = deferred<ReturnType<typeof page>>();
    const { session } = setup([() => gate.promise], runtimeConfig(), {
      signal: controller.signal
    });
    const pending = session.fetchPage(read(1));
    controller.abort(new DOMException("stop", "AbortError"));
    // A real request rejects once its signal fires.
    gate.reject(new DOMException("stop", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(session.fetchPage(read(2))).rejects.toMatchObject({
      name: "AbortError"
    });
  });

  it("stops at the caller's own signal as well", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, session } = setup([page(1)]);
    await expect(
      session.fetchPage(read(1), controller.signal)
    ).rejects.toBeDefined();
    expect(client.pageRequests).toHaveLength(0);
  });
});
