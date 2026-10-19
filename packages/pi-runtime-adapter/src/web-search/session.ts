import { createHash } from "node:crypto";
import {
  WEB_SEARCH_PROVIDERS,
  type WebSearchProviderId,
  type WebSearchRuntimeConfig
} from "@deepwrite/contracts";
import { abortReason, defaultSleep, isAbortLike } from "./abort";
import {
  WEB_FETCH_CONTENT_MAX,
  cutCharacters,
  normalizePageText
} from "./format";
import { fauxWebSearchClient } from "./providers/faux";
import { webSearchClient } from "./registry";
import {
  sharedWebSearchRateLimiter,
  type WebSearchRateLimiter
} from "./rate-limiter";
import {
  WebSearchProviderError,
  type WebFetchRequest,
  type WebPageExcerpt,
  type WebSearchFetch,
  type WebSearchHit,
  type WebSearchProviderClient,
  type WebSearchProviderContext,
  type WebSearchRequest
} from "./types";

const DEFAULT_TIMEOUT_MS = 20_000;
/** First try plus two retries. */
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];
/** A page read is slower and a dead page stays dead, so it waits longer and retries once. */
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_FETCH_RETRY_DELAYS_MS: readonly number[] = [1_000];
const MAX_RETRY_DELAY_MS = 10_000;
const JITTER_MS = 250;

/** The run's search budget is spent; the model is told to work with what it has. */
export class WebSearchLimitError extends Error {
  constructor(readonly callLimit: number) {
    super(`web search limit of ${callLimit} calls reached`);
    this.name = "WebSearchLimitError";
  }
}

interface Counted {
  /** Answered from this run's cache; no request was sent and none counted. */
  cached: boolean;
  /** Requests sent so far this run, including this one unless cached. */
  callIndex: number;
  callLimit: number;
}

export interface WebSearchOutcome extends Counted {
  hits: WebSearchHit[];
}

export interface WebFetchOutcome extends Counted {
  page: WebPageExcerpt;
}

export interface WebSearchSession {
  readonly providerId: WebSearchProviderId;
  readonly maxResults: number;
  readonly queryHint: string;
  /** Whether pages can be read; without it `web_fetch` is never mounted. */
  readonly canFetch: boolean;
  /** Longest address a page read may carry. */
  readonly fetchUrlMaxChars: number;
  search(
    request: WebSearchRequest,
    signal?: AbortSignal
  ): Promise<WebSearchOutcome>;
  /** Searches and page reads spend the same call budget. */
  fetchPage(
    request: WebFetchRequest,
    signal?: AbortSignal
  ): Promise<WebFetchOutcome>;
}

export interface CreateWebSearchSessionOptions {
  fetch?: WebSearchFetch;
  /** Replaces the registered client; tests and the local Faux runtime use it. */
  client?: WebSearchProviderClient;
  localFaux?: boolean;
  limiter?: WebSearchRateLimiter;
  /** The run's own abort signal; it stops the search and any waiting. */
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchTimeoutMs?: number;
  /** Overrides the delays of both searches and page reads. */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

/** How one kind of request is paced, timed and retried. */
interface Lane {
  limiterKey: string;
  qps: number;
  timeoutMs: number;
  retryDelays: readonly number[];
}

function cacheKey(request: WebSearchRequest): string {
  return `${request.query.trim().replace(/\s+/gu, " ").toLowerCase()}|${request.count}`;
}

/**
 * One budget for a whole run: the main agent and its subagents share the call
 * limit, the caches and, through the process limiter, the service's rate
 * limit. Searches and page reads draw on the same count.
 */
export function createWebSearchSession(
  config: WebSearchRuntimeConfig,
  options: CreateWebSearchSessionOptions = {}
): WebSearchSession {
  const client =
    options.client ??
    (options.localFaux
      ? fauxWebSearchClient
      : webSearchClient(config.providerId));
  const descriptor = WEB_SEARCH_PROVIDERS[config.providerId];
  const maxResults = Math.min(config.maxResults, descriptor.maxResultsCap);
  const fetchCapability = descriptor.supportsFetch ? client.fetch : undefined;
  const limiter = options.limiter ?? sharedWebSearchRateLimiter;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  // The key never appears in the limiter's bookkeeping, only its fingerprint.
  const keyFingerprint = `${config.providerId}:${createHash("sha256")
    .update(config.apiKey)
    .digest("hex")
    .slice(0, 16)}`;
  // The service limits search and fetch apart, so each has its own bucket.
  const searchLane: Lane = {
    limiterKey: keyFingerprint,
    qps: client.maxQps,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryDelays: options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  };
  const fetchLane: Lane = {
    limiterKey: `${keyFingerprint}:fetch`,
    qps: fetchCapability?.maxQps ?? 1,
    timeoutMs: options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
    retryDelays: options.retryDelaysMs ?? DEFAULT_FETCH_RETRY_DELAYS_MS
  };
  const searches = new Map<string, Promise<WebSearchHit[]>>();
  const pages = new Map<string, Promise<WebPageExcerpt>>();
  let calls = 0;

  function aborted(signal?: AbortSignal): AbortSignal | undefined {
    return [options.signal, signal].find((entry) => entry?.aborted);
  }

  async function attempt<T>(
    lane: Lane,
    send: (context: WebSearchProviderContext) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    const outer = [options.signal, signal].filter(
      (entry): entry is AbortSignal => entry !== undefined
    );
    for (let tried = 0; ; tried += 1) {
      const stopped = aborted(signal);
      if (stopped) throw abortReason(stopped);
      let failure: WebSearchProviderError;
      try {
        await limiter.acquire(
          lane.limiterKey,
          lane.qps,
          outer.length ? AbortSignal.any(outer) : undefined
        );
        return await send({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          fetch: options.fetch ?? fetch,
          signal: AbortSignal.any([
            ...outer,
            AbortSignal.timeout(lane.timeoutMs)
          ])
        });
      } catch (error) {
        const stoppedNow = aborted(signal);
        if (stoppedNow) throw abortReason(stoppedNow);
        if (error instanceof WebSearchProviderError) failure = error;
        else if (isAbortLike(error))
          failure = new WebSearchProviderError("timeout", true);
        else throw error;
      }
      const delay = lane.retryDelays[tried];
      if (!failure.retryable || delay === undefined) throw failure;
      await sleep(
        Math.min(
          MAX_RETRY_DELAY_MS,
          failure.retryAfterMs ?? delay + Math.floor(random() * JITTER_MS)
        ),
        outer.length ? AbortSignal.any(outer) : undefined
      );
    }
  }

  /** Cache first; otherwise spend one call, keeping the request in the cache while it runs. */
  async function counted<T>(
    cache: Map<string, Promise<T>>,
    key: string,
    start: () => Promise<T>
  ): Promise<Counted & { value: T }> {
    const known = cache.get(key);
    if (known) {
      return {
        value: await known,
        cached: true,
        callIndex: calls,
        callLimit: config.perRunCallLimit
      };
    }
    if (calls >= config.perRunCallLimit)
      throw new WebSearchLimitError(config.perRunCallLimit);
    const callIndex = ++calls;
    // Stored while in flight, so parallel subagents asking the same thing share one request.
    const pending = start();
    cache.set(key, pending);
    try {
      return {
        value: await pending,
        cached: false,
        callIndex,
        callLimit: config.perRunCallLimit
      };
    } catch (error) {
      // A failed or aborted request is never remembered.
      if (cache.get(key) === pending) cache.delete(key);
      throw error;
    }
  }

  return {
    providerId: config.providerId,
    maxResults,
    queryHint: client.queryHint,
    canFetch: fetchCapability !== undefined,
    fetchUrlMaxChars: descriptor.fetchUrlMaxChars,
    async search(request, signal) {
      const { value, ...counts } = await counted(
        searches,
        cacheKey(request),
        () =>
          attempt(
            searchLane,
            (context) => client.search(request, context),
            signal
          ).then((hits) => hits.slice(0, request.count))
      );
      return { hits: value, ...counts };
    },
    async fetchPage(request, signal) {
      if (!fetchCapability)
        throw new Error("This search provider cannot read pages.");
      const { value, ...counts } = await counted(pages, request.url, () =>
        attempt(
          fetchLane,
          (context) => fetchCapability.page(request, context),
          signal
        ).then((page) => {
          // Only what the model can read is kept for the run.
          const { head, total } = cutCharacters(
            normalizePageText(page.content),
            WEB_FETCH_CONTENT_MAX
          );
          return { ...page, content: head.trimEnd(), totalChars: total };
        })
      );
      return { page: value, ...counts };
    }
  };
}
