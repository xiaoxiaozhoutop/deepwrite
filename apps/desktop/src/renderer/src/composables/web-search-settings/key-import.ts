import { ref, type ComputedRef } from "vue";
import {
  webSearchProvider,
  type WebSearchImportKeyInput,
  type WebSearchKeyImportCandidate,
  type WebSearchSettings
} from "@deepwrite/contracts/renderer";
import { getErrorDetail } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import { webSearchApi, webSearchT as t, type WebSearchDraft } from "./bridge";

export interface WebSearchKeyImportRequest {
  candidates: WebSearchKeyImportCandidate[];
  hasCurrentKey: boolean;
}

export interface WebSearchKeyImportContext {
  draft: WebSearchDraft;
  provider: ComputedRef<string>;
  canImport: ComputedRef<boolean>;
  resetKeyDraft(): void;
  importKey(input: WebSearchImportKeyInput): Promise<void>;
}

/**
 * "一键导入": copy the key of a saved custom model into web search. One
 * unambiguous candidate imports at once; anything that needs a decision opens
 * the choice dialog.
 */
export function useWebSearchKeyImport(context: WebSearchKeyImportContext) {
  const { draft } = context;
  const importing = ref(false);
  const importRequest = ref<WebSearchKeyImportRequest | null>(null);
  const importConfirming = ref(false);
  /** A model that could lend its key exists while no key is saved. */
  const importHint = ref(false);
  let detectionRevision = 0;

  /** Looks quietly for an importable model; the hint is optional. */
  async function detectImportable(snapshot: WebSearchSettings): Promise<void> {
    const revision = ++detectionRevision;
    importHint.value = false;
    const providerId = snapshot.activeProviderId;
    const active = snapshot.profiles.find(
      (entry) => entry.providerId === providerId
    );
    if (active?.hasApiKey || !webSearchProvider(providerId).keyImport) return;
    try {
      const { candidates } = await webSearchApi().listKeyImportCandidates({
        providerId
      });
      if (revision === detectionRevision)
        importHint.value = candidates.length > 0;
    } catch {
      // The import button still reports real failures.
    }
  }

  /** Replaces the key and provider; unsaved parameter edits stay untouched. */
  async function runImport(
    candidate: WebSearchKeyImportCandidate
  ): Promise<void> {
    const submitted = { ...draft };
    await context.importKey({
      providerId: draft.activeProviderId,
      sourceModelId: candidate.sourceModelId
    });
    if (
      draft.activeProviderId === submitted.activeProviderId &&
      draft.apiKey === submitted.apiKey &&
      draft.clearKey === submitted.clearKey
    )
      context.resetKeyDraft();
    importHint.value = false;
    uiMessage.success(
      t("importDone", { model: candidate.models[0]?.label ?? "" })
    );
  }

  async function startImport(): Promise<void> {
    if (importing.value || !context.canImport.value) return;
    importing.value = true;
    try {
      const { candidates, hasCurrentKey } =
        await webSearchApi().listKeyImportCandidates({
          providerId: draft.activeProviderId
        });
      const [only] = candidates;
      if (!only) {
        uiMessage.warning(
          t("importNone", { provider: context.provider.value })
        );
      } else if (candidates.length === 1 && only.matchesCurrentKey) {
        uiMessage.info(t("importAlreadyUsing"));
      } else if (candidates.length === 1 && !hasCurrentKey) {
        await runImport(only);
      } else {
        importRequest.value = { candidates, hasCurrentKey };
      }
    } catch (error) {
      uiMessage.error(getErrorDetail(error) ?? t("importFailed"));
    } finally {
      importing.value = false;
    }
  }

  /** The dialog closes either way; a refused import is retried from the button. */
  async function confirmImport(sourceModelId: string): Promise<void> {
    const candidate = importRequest.value?.candidates.find(
      (entry) => entry.sourceModelId === sourceModelId
    );
    if (!candidate || importConfirming.value) return;
    importConfirming.value = true;
    try {
      await runImport(candidate);
    } catch (error) {
      uiMessage.error(getErrorDetail(error) ?? t("importFailed"));
    } finally {
      importConfirming.value = false;
      importRequest.value = null;
    }
  }

  function cancelImport(): void {
    if (!importConfirming.value) importRequest.value = null;
  }

  return {
    importing,
    importRequest,
    importConfirming,
    importHint,
    detectImportable,
    startImport,
    confirmImport,
    cancelImport
  };
}
