import { effectScope, nextTick, ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { ResourceTreeSection } from "../types/workspace";
import { useSidebarSelectionReveal } from "./useSidebarSelectionReveal";

function createHarness() {
  const selectedId = ref("character-a");
  const selectionActive = ref(true);
  const sections = shallowRef<ResourceTreeSection[]>([
    {
      id: "creation",
      label: "创作空间",
      icon: "book",
      nodes: [
        {
          id: "characters",
          label: "人物",
          children: [
            { id: "character-a", label: "人物甲" },
            { id: "character-b", label: "人物乙" }
          ]
        }
      ]
    }
  ]);
  const selected = { getBoundingClientRect: () => ({ top: 20, height: 30 }) };
  const scroller = {
    clientHeight: 200,
    scrollHeight: 1000,
    scrollTop: 400,
    contains: () => true,
    getBoundingClientRect: () => ({ top: 100, height: 200 }),
    querySelector: vi.fn(() => selected)
  };
  const scope = effectScope();
  scope.run(() =>
    useSidebarSelectionReveal({
      selectedId: () => selectedId.value,
      sections: () => sections.value,
      selectionActive,
      scroller: shallowRef(scroller as unknown as HTMLElement)
    })
  );
  return { selectedId, selectionActive, sections, scroller, scope };
}

async function flushReveal(): Promise<void> {
  await nextTick();
  await nextTick();
}

describe("useSidebarSelectionReveal", () => {
  it("keeps the viewport when a removed selection falls back to another character", async () => {
    const harness = createHarness();
    try {
      harness.sections.value = [
        {
          ...harness.sections.value[0]!,
          nodes: [
            {
              id: "characters",
              label: "人物",
              children: [{ id: "character-b", label: "人物乙" }]
            }
          ]
        }
      ];
      harness.selectedId.value = "character-b";
      await flushReveal();
      expect(harness.scroller.scrollTop).toBe(400);
    } finally {
      harness.scope.stop();
    }
  });

  it("reveals an explicitly selected resource with only the necessary scrolling", async () => {
    const harness = createHarness();
    try {
      harness.selectedId.value = "character-b";
      await flushReveal();
      expect(harness.scroller.scrollTop).toBe(320);
    } finally {
      harness.scope.stop();
    }
  });

  it("keeps the sidebar still while a different feature is active", async () => {
    const harness = createHarness();
    try {
      harness.selectionActive.value = false;
      harness.selectedId.value = "character-b";
      await flushReveal();
      expect(harness.scroller.scrollTop).toBe(400);
    } finally {
      harness.scope.stop();
    }
  });

  it("centers the selection when returning from a different feature", async () => {
    const harness = createHarness();
    try {
      harness.selectionActive.value = false;
      await flushReveal();
      harness.selectionActive.value = true;
      await flushReveal();
      expect(harness.scroller.scrollTop).toBe(235);
    } finally {
      harness.scope.stop();
    }
  });

  it("discards a scheduled reveal when navigation changes before the next render", async () => {
    const harness = createHarness();
    try {
      harness.selectedId.value = "character-b";
      await nextTick();
      harness.selectionActive.value = false;
      await flushReveal();
      expect(harness.scroller.scrollTop).toBe(400);
    } finally {
      harness.scope.stop();
    }
  });
});
