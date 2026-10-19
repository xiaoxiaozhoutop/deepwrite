import {
  WEB_SEARCH_PROVIDERS,
  type WebSearchProviderId
} from "@deepwrite/contracts";
import { deepSeekWebSearchClient } from "./providers/deepseek";
import type { WebSearchProviderClient } from "./types";

/** A new search provider registers its client here; the type checks the table is complete. */
export const WEB_SEARCH_CLIENTS = {
  deepseek: deepSeekWebSearchClient
} as const satisfies Record<WebSearchProviderId, WebSearchProviderClient>;

export function webSearchClient(
  id: WebSearchProviderId
): WebSearchProviderClient {
  return WEB_SEARCH_CLIENTS[id];
}

/** The descriptor and the client agree that pages can be read. */
export function webFetchAvailable(id: WebSearchProviderId): boolean {
  return (
    WEB_SEARCH_PROVIDERS[id].supportsFetch &&
    WEB_SEARCH_CLIENTS[id].fetch !== undefined
  );
}
