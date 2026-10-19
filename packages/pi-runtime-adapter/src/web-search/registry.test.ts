import { describe, expect, it } from "vitest";
import {
  WEB_SEARCH_PROVIDER_IDS,
  WEB_SEARCH_PROVIDERS
} from "@deepwrite/contracts";
import { fauxWebSearchClient } from "./providers/faux";
import { WEB_SEARCH_CLIENTS, webFetchAvailable } from "./registry";

describe("search provider registry", () => {
  it.each(WEB_SEARCH_PROVIDER_IDS)(
    "%s: the descriptor and the client agree on reading pages",
    (id) => {
      expect(WEB_SEARCH_PROVIDERS[id].supportsFetch).toBe(
        WEB_SEARCH_CLIENTS[id].fetch !== undefined
      );
      expect(webFetchAvailable(id)).toBe(
        WEB_SEARCH_PROVIDERS[id].supportsFetch
      );
      if (WEB_SEARCH_PROVIDERS[id].supportsFetch) {
        expect(WEB_SEARCH_PROVIDERS[id].fetchUrlMaxChars).toBeGreaterThan(0);
        expect(WEB_SEARCH_CLIENTS[id].fetch!.maxQps).toBeGreaterThan(0);
      }
    }
  );

  it("lets the local Faux runtime read pages wherever the real client can", () => {
    expect(fauxWebSearchClient.fetch !== undefined).toBe(
      WEB_SEARCH_CLIENTS[fauxWebSearchClient.id].fetch !== undefined
    );
  });
});
