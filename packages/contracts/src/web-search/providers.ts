import { z } from "zod";
import type { ModelConfig } from "../model-configuration";
import { isDeepWriteSiteOfficialModel } from "../model-configuration";

/**
 * Search providers behind the `web_search` tool. Adding one means a new ID and
 * descriptor here, a profile member in `settings.ts` and a client in the Pi
 * adapter; `satisfies Record<…>` keeps each table complete.
 */
export const WEB_SEARCH_PROVIDER_IDS = ["deepseek"] as const;
export const WebSearchProviderIdSchema = z.enum(WEB_SEARCH_PROVIDER_IDS);
export type WebSearchProviderId = z.infer<typeof WebSearchProviderIdSchema>;

export const DEFAULT_WEB_SEARCH_PROVIDER_ID: WebSearchProviderId = "deepseek";

/** Which saved custom models may lend their API key to a search provider. */
export interface WebSearchKeyImportRule {
  /** Model `provider` values; compared after trim and lower-casing. */
  modelProviders: readonly string[];
  /** Exact host names of the model `baseUrl`; an empty URL never matches. */
  baseUrlHosts: readonly string[];
}

export interface WebSearchProviderDescriptor {
  id: WebSearchProviderId;
  /** The only address a provider's key is ever sent to. */
  defaultBaseUrl: string;
  /** Most results one call may ask for, whatever the service itself allows. */
  maxResultsCap: number;
  defaultMaxResults: number;
  queryMaxChars: number;
  /** Whether the provider can read one page's text, which mounts `web_fetch`. */
  supportsFetch: boolean;
  /** Longest address `web_fetch` sends; only meaningful with `supportsFetch`. */
  fetchUrlMaxChars: number;
  keyImport?: WebSearchKeyImportRule;
}

export const WEB_SEARCH_PROVIDERS = {
  deepseek: {
    id: "deepseek",
    defaultBaseUrl: "https://api.deepseek.com",
    maxResultsCap: 20,
    defaultMaxResults: 8,
    queryMaxChars: 128,
    supportsFetch: true,
    fetchUrlMaxChars: 8192,
    keyImport: {
      modelProviders: ["deepseek"],
      baseUrlHosts: ["api.deepseek.com"]
    }
  }
} as const satisfies Record<WebSearchProviderId, WebSearchProviderDescriptor>;

export function webSearchProvider(
  id: WebSearchProviderId
): WebSearchProviderDescriptor {
  return WEB_SEARCH_PROVIDERS[id];
}

export type WebSearchKeyImportModel = Pick<
  ModelConfig,
  "id" | "provider" | "baseUrl" | "hasApiKey"
> & { managedBy?: ModelConfig["managedBy"] | undefined };

/**
 * Whether a saved model qualifies as a key source. Pure: it never sees the
 * key itself, only whether one is saved.
 */
export function matchesWebSearchKeyImport(
  model: WebSearchKeyImportModel,
  rule: WebSearchKeyImportRule
): boolean {
  if (
    !model.hasApiKey ||
    model.managedBy ||
    isDeepWriteSiteOfficialModel(model)
  )
    return false;
  const provider = model.provider.trim().toLowerCase();
  if (!rule.modelProviders.some((entry) => entry.toLowerCase() === provider))
    return false;
  if (!model.baseUrl) return false;
  let host: string;
  try {
    host = new URL(model.baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return rule.baseUrlHosts.some((entry) => entry.toLowerCase() === host);
}
