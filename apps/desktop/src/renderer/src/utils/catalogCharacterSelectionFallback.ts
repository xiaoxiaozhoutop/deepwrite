import {
  resolveProjectedResourceTargetDocumentId,
  type CatalogWorkspaceProjection
} from "../data/catalogWorkspace";

/** Keep a removed character's replacement in the same character directory. */
export function catalogCharacterSelectionFallback(
  previous: CatalogWorkspaceProjection | undefined,
  next: CatalogWorkspaceProjection,
  resourceId: string
): string | undefined {
  if (!previous) return undefined;
  const document = previous.index.workspaceDocumentById.get(
    resolveProjectedResourceTargetDocumentId(previous, resourceId)
  );
  if (document?.characterFileKind !== "item" || !document.workspaceId) {
    return undefined;
  }

  const siblings = previous.workspaceDocuments
    .filter(
      (candidate) =>
        candidate.workspaceId === document.workspaceId &&
        candidate.characterFileKind === "item"
    )
    .sort(
      (left, right) =>
        (left.characterItemOrder ?? 0) - (right.characterItemOrder ?? 0)
    );
  const removedIndex = siblings.findIndex(({ id }) => id === document.id);
  const candidates = [
    ...siblings.slice(removedIndex + 1),
    ...siblings.slice(0, removedIndex).reverse()
  ];
  const replacement =
    candidates.find(
      ({ id }) =>
        next.index.workspaceDocumentById.get(id)?.characterFileKind === "item"
    ) ??
    next.workspaceDocuments.find(
      (candidate) =>
        candidate.workspaceId === document.workspaceId &&
        candidate.characterFileKind === "overview"
    );
  return replacement
    ? next.index.resourceIdByDocumentId.get(replacement.id)
    : undefined;
}
