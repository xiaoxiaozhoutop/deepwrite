import type { WebSearchProviderId } from "@deepwrite/contracts";

export interface WebSearchRequest {
  query: string;
  count: number;
  /** The user's own question behind the search; providers that cannot use it ignore it. */
  question?: string;
}

export interface WebSearchHit {
  title: string;
  /** Always an http(s) address. */
  url: string;
  siteName?: string;
  /** RFC 3339 timestamp. */
  publishedAt?: string;
  /** Short summary, shown to the user. */
  snippet: string;
  /** Longer summary, read by the model. */
  summary: string;
  score?: number;
  authority?: number;
}

export type WebSearchFailureKind =
  | "auth"
  | "balance"
  | "rate_limit"
  | "timeout"
  | "bad_request"
  | "unavailable"
  | "invalid_response"
  /** A page read the service refused on policy grounds; only fetching sees it. */
  | "blocked"
  /** The service found no usable text at the address; only fetching sees it. */
  | "no_content";

export class WebSearchProviderError extends Error {
  constructor(
    readonly kind: WebSearchFailureKind,
    readonly retryable: boolean,
    readonly retryAfterMs?: number
  ) {
    super(kind);
    this.name = "WebSearchProviderError";
  }
}

export type WebSearchFetch = typeof fetch;

export interface WebSearchProviderContext {
  apiKey: string;
  baseUrl: string;
  fetch: WebSearchFetch;
  /** Run abort and request timeout, already merged. */
  signal: AbortSignal;
}

export interface WebFetchRequest {
  /** An http(s) address that already passed `checkWebFetchUrl`. */
  url: string;
}

export interface WebPage {
  title: string;
  /** The address that was read. */
  url: string;
  /** The page body as Markdown; never empty. */
  content: string;
}

/** A page cut to what the model reads. */
export interface WebPageExcerpt extends WebPage {
  /** Characters the page had in all; `content` may hold fewer. */
  totalChars: number;
}

/**
 * Reading one page. The service limits it apart from search, so it declares its
 * own rate.
 */
export interface WebFetchCapability {
  /** Requests per second the service allows one key for page reads. */
  readonly maxQps: number;
  page(
    request: WebFetchRequest,
    context: WebSearchProviderContext
  ): Promise<WebPage>;
}

/**
 * One request to a search service. Retries, pacing, caching and call counting
 * belong to the search session, which every provider shares.
 */
export interface WebSearchProviderClient {
  readonly id: WebSearchProviderId;
  /** Requests per second the service allows one key. */
  readonly maxQps: number;
  /** Query syntax worth telling the model about. */
  readonly queryHint: string;
  /** Present when the service can read a page; the descriptor's `supportsFetch` says so too. */
  readonly fetch?: WebFetchCapability;
  search(
    request: WebSearchRequest,
    context: WebSearchProviderContext
  ): Promise<WebSearchHit[]>;
}
