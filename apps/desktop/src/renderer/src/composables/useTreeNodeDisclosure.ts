import { computed, ref, watch, type Ref } from "vue";
import type { ResourceTreeNode } from "../types/workspace";
import { resourceTreeContainsResource } from "../utils/resourceTreeLookup";

export function useTreeNodeDisclosure(
  node: () => ResourceTreeNode,
  selectedId: () => string,
  options: {
    initialOpen?: boolean;
    selectionActive?: Readonly<Ref<boolean>>;
  } = {}
) {
  const open = ref(options.initialOpen ?? false);
  const containsSelection = computed(() => {
    const current = node();
    const selection = selectedId();
    return Boolean(
      selection &&
      current.children?.length &&
      ((current.selectableBranch && current.id === selection) ||
        resourceTreeContainsResource(current.children, selection))
    );
  });
  let selectionWasContained = false;

  watch(
    [
      selectedId,
      containsSelection,
      () => options.selectionActive?.value ?? true
    ],
    ([selection, contains, active], [previousSelection, , wasActive]) => {
      const current = node();
      const replacingRemovedSelection = Boolean(
        wasActive &&
        selectionWasContained &&
        previousSelection &&
        selection !== previousSelection &&
        previousSelection !== current.id &&
        !resourceTreeContainsResource(current.children ?? [], previousSelection)
      );
      // The refreshed tree can publish before its fallback selection. Remember
      // membership until the selection changes so a manual collapse survives.
      selectionWasContained =
        selection !== previousSelection
          ? contains
          : selectionWasContained || contains;
      if (!contains || !active || replacingRemovedSelection) return;
      open.value = true;
    },
    { immediate: true }
  );

  return { open };
}
