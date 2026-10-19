import {
  WebSearchProviderError,
  testWebSearchProvider,
  type WebSearchFailureKind
} from "@deepwrite/pi-runtime-adapter";
import { electronRemoteFetch } from "../electron-remote-fetch";
import { SafeWebSearchError } from "./web-search-errors";
import type { WebSearchTester } from "./web-search-service";

const NOTICES: Record<WebSearchFailureKind, string> = {
  auth: "联网搜索 API Key 无效或已失效，请检查后重试。",
  balance: "联网搜索服务余额不足，请充值后重试。",
  rate_limit: "联网搜索请求过于频繁，请稍后再试。",
  timeout: "连接联网搜索服务超时，请检查网络后重试。",
  bad_request: "联网搜索服务拒绝了这次请求，请检查查询词。",
  unavailable: "联网搜索服务暂时不可用，请稍后重试。",
  invalid_response: "联网搜索服务返回了无法识别的内容。",
  // Only a page read meets these two; the test search cannot.
  blocked: "联网搜索服务拒绝了这次请求，请稍后重试。",
  no_content: "联网搜索服务没有返回可用内容，请稍后重试。"
};

const networkFetch: typeof fetch = (input, init) =>
  electronRemoteFetch(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    init
  );

/** Words for the person, never the service's own response. */
export function webSearchTestFailure(
  error: unknown
): SafeWebSearchError | unknown {
  return error instanceof WebSearchProviderError
    ? new SafeWebSearchError(NOTICES[error.kind])
    : error;
}

/** The settings page's test search, over whichever network stack is given. */
export function createWebSearchTester(
  fetchImpl: typeof fetch
): WebSearchTester {
  return async (request) => {
    try {
      return await testWebSearchProvider(
        {
          providerId: request.providerId,
          baseUrl: request.baseUrl,
          apiKey: request.apiKey,
          query: request.query
        },
        { fetch: fetchImpl, signal: request.signal }
      );
    } catch (error) {
      throw webSearchTestFailure(error);
    }
  };
}

/**
 * Goes through Electron's network stack, so the app's proxy preference applies
 * as it does for model requests.
 */
export const testWebSearch = createWebSearchTester(networkFetch);
