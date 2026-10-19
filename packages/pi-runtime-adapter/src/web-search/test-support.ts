import type { WebSearchRuntimeConfig } from "@deepwrite/contracts";
import { WebSearchRateLimiter } from "./rate-limiter";
import type {
  WebFetchRequest,
  WebPage,
  WebSearchHit,
  WebSearchProviderClient,
  WebSearchRequest
} from "./types";

export const TEST_KEY = "invalid-test-search-key";

export function runtimeConfig(
  overrides: Partial<WebSearchRuntimeConfig> = {}
): WebSearchRuntimeConfig {
  return {
    providerId: "deepseek",
    baseUrl: "https://search.example.test",
    apiKey: TEST_KEY,
    maxResults: 8,
    perRunCallLimit: 20,
    ...overrides
  };
}

export function hit(
  index: number,
  overrides: Partial<WebSearchHit> = {}
): WebSearchHit {
  return {
    title: `结果 ${index}`,
    url: `https://example.test/${index}`,
    siteName: "示例站",
    publishedAt: "2026-06-01T00:00:00+00:00",
    snippet: `短摘要 ${index}`,
    summary: `长摘要 ${index}`,
    ...overrides
  };
}

export function page(index: number, overrides: Partial<WebPage> = {}): WebPage {
  return {
    title: `网页 ${index}`,
    url: `https://example.test/page/${index}`,
    content: `# 网页 ${index}\n\n正文 ${index}`,
    ...overrides
  };
}

export type Step =
  | WebSearchHit[]
  | Error
  | ((request: WebSearchRequest) => Promise<WebSearchHit[]>);

export type PageStep =
  WebPage | Error | ((request: WebFetchRequest) => Promise<WebPage>);

/**
 * A client that plays its steps in order and remembers what it was asked. It
 * can read pages only when page steps are given.
 */
export function scriptedClient(
  steps: Step[],
  pageSteps?: PageStep[]
): WebSearchProviderClient & {
  requests: WebSearchRequest[];
  pageRequests: WebFetchRequest[];
} {
  const requests: WebSearchRequest[] = [];
  const pageRequests: WebFetchRequest[] = [];
  let next = 0;
  let nextPage = 0;
  return {
    id: "deepseek",
    maxQps: 5,
    queryHint: "测试语法提示。",
    requests,
    pageRequests,
    ...(pageSteps
      ? {
          fetch: {
            maxQps: 5,
            async page(request) {
              pageRequests.push(request);
              const step =
                pageSteps[Math.min(nextPage++, pageSteps.length - 1)]!;
              if (step instanceof Error) throw step;
              return typeof step === "function" ? step(request) : step;
            }
          }
        }
      : {}),
    async search(request) {
      requests.push(request);
      const step = steps[Math.min(next++, steps.length - 1)]!;
      if (step instanceof Error) throw step;
      return typeof step === "function" ? step(request) : step;
    }
  };
}

/** Never waits: the limiter's own timing is tested separately. */
export function instantLimiter(): WebSearchRateLimiter {
  return new WebSearchRateLimiter({
    now: () => 0,
    sleep: async () => undefined
  });
}

export function recordingSleep() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    }
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
