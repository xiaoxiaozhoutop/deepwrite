import type {
  LongBookSummary,
  LongWorkspaceIndexResult
} from "@deepwrite/contracts";
import { createLongWorkspaceNavigationSnapshot } from "@deepwrite/contracts/renderer";

/** Keep metadata and navigation from the same authoritative index response. */
export function longWorkspaceSummaryFromIndex(
  result: LongWorkspaceIndexResult,
  fallback?: LongBookSummary | null
): LongBookSummary {
  const { bookId, workspaceIndex, metadata } = result;
  const book = metadata ?? fallback;
  if (!book || book.id !== bookId || workspaceIndex.bookId !== bookId) {
    throw new Error(
      "Long workspace result does not include matching book metadata."
    );
  }
  if (metadata && metadata.updatedAt !== workspaceIndex.updatedAt) {
    throw new Error("Long workspace metadata and index versions do not match.");
  }
  return {
    ...book,
    updatedAt: workspaceIndex.updatedAt,
    navigation: createLongWorkspaceNavigationSnapshot(workspaceIndex)
  };
}
