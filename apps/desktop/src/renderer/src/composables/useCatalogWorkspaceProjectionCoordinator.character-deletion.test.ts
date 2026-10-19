import type { CatalogIndexSnapshot } from "@deepwrite/contracts";
import { createPinia, storeToRefs } from "pinia";
import { effectScope, nextTick, ref, shallowRef, watch } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useCatalogIndexStore } from "../stores/catalogIndexStore";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import { useCatalogWorkspaceProjectionCoordinator } from "./useCatalogWorkspaceProjectionCoordinator";
import { useTreeNodeDisclosure } from "./useTreeNodeDisclosure";

const NOW = "2026-10-18T08:00:00.000Z";

function snapshot(
  bookType: "short" | "script",
  characterIds: string[],
  revision: number
): CatalogIndexSnapshot {
  const document = (id: string) => ({
    id,
    title: id,
    content: "" as const,
    contentBytes: 0,
    contentStamp: `test-stamp-${id}`,
    createdAt: NOW,
    updatedAt: NOW
  });
  return {
    schemaVersion: 1,
    revision,
    updatedAt: NOW,
    creativePlotStages: [],
    materials: [],
    materialGroups: [],
    skills: [],
    skillGroups: [],
    books: [
      {
        id: "book-1",
        title: "测试作品",
        bookType,
        genre: "悬疑",
        status: "editing",
        linkedMaterialIdsByKind: {
          character: [],
          gimmick: [],
          plot: [],
          draft: [],
          other: []
        },
        linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] },
        characterStructure: {
          format: "list",
          items: characterIds.map((id, index) => ({
            id,
            title: id,
            order: index + 1
          }))
        },
        plotStages: [],
        // Document storage order does not define the character tab order.
        documents: [
          document("character_design"),
          ...[...characterIds].reverse().map(document)
        ],
        draft: {
          id: "draft",
          title: "正文",
          createdAt: NOW,
          updatedAt: NOW,
          sections: [
            {
              id: "section-1",
              title: "第一节",
              wordCountRequirement: "",
              body: document("section-1-body"),
              characterState: document("section-1-state"),
              createdAt: NOW,
              updatedAt: NOW
            }
          ]
        },
        projectRevision: revision,
        createdAt: NOW,
        updatedAt: NOW
      }
    ]
  };
}

function createHarness(bookType: "short" | "script", ids: string[]) {
  const scope = effectScope();
  const result = scope.run(() => {
    const store = useCatalogIndexStore(createPinia());
    const selectedResourceId = ref("");
    const activeCreationResourceId = ref("");
    const documents = shallowRef<WorkspaceDocument[]>([]);
    const drafts = shallowRef<Record<string, EditorDraftState>>({});
    let current = snapshot(bookType, ids, 1);
    const coordinator = useCatalogWorkspaceProjectionCoordinator({
      api: () => ({ index: async () => current, snapshot: vi.fn() }),
      index: {
        ...storeToRefs(store),
        ensureSnapshot: (loader) => store.ensureSnapshot(loader)
      },
      documents: {
        values: documents,
        reconcileProjection(projection) {
          documents.value = projection.workspaceDocuments;
          return {
            documents: documents.value,
            retainedBodyIds: [],
            discardedBodyIds: [],
            removedIds: []
          };
        }
      },
      state: { drafts, selectedResourceId, activeCreationResourceId },
      proposals: { all: () => [], resume: vi.fn() },
      scheduler: { queueMicrotask: vi.fn() },
      notifications: { error: vi.fn(), info: vi.fn(), warning: vi.fn() }
    });
    const resourceId = (id: string) =>
      store.workspaceDocuments.find(
        (document) => document.catalogDocumentId === id
      )!.id;
    return {
      store,
      selectedResourceId,
      activeCreationResourceId,
      coordinator,
      resourceId,
      select(id: string) {
        selectedResourceId.value = resourceId(id);
        activeCreationResourceId.value = resourceId(id);
      },
      async refresh(ids: string[]) {
        current = snapshot(bookType, ids, current.revision + 1);
        await coordinator.loadSnapshot();
        await nextTick();
      }
    };
  })!;
  return { ...result, scope };
}

describe.each(["short", "script"] as const)(
  "%s character deletion selection",
  (bookType) => {
    it.each([
      {
        ids: ["a", "b", "c"],
        selected: "a",
        remaining: ["b", "c"],
        expected: "b"
      },
      {
        ids: ["a", "b", "c"],
        selected: "b",
        remaining: ["a", "c"],
        expected: "c"
      },
      {
        ids: ["a", "b", "c"],
        selected: "c",
        remaining: ["a", "b"],
        expected: "b"
      },
      { ids: ["a"], selected: "a", remaining: [], expected: "character_design" }
    ])(
      "keeps deletion of $selected in the character directory",
      async ({ ids, selected, remaining, expected }) => {
        const harness = createHarness(bookType, ids);
        try {
          await harness.coordinator.loadSnapshot();
          harness.select(selected);
          const changes: string[] = [];
          harness.scope.run(() =>
            watch(harness.selectedResourceId, (id) => changes.push(id), {
              flush: "sync"
            })
          );
          const draftNode = () =>
            harness.store.resourceSections[0]!.nodes[0]!.children!.find(
              (node) => node.stageCategoryId === "draft"
            )!;
          const draftDisclosure = harness.scope.run(() =>
            useTreeNodeDisclosure(
              draftNode,
              () => harness.selectedResourceId.value
            )
          )!;
          const bookDisclosure = harness.scope.run(() =>
            useTreeNodeDisclosure(
              () => harness.store.resourceSections[0]!.nodes[0]!,
              () => harness.selectedResourceId.value
            )
          )!;
          bookDisclosure.open.value = false;
          expect(draftDisclosure.open.value).toBe(false);

          await harness.refresh(remaining);

          const expectedId =
            harness.store.projection!.index.resourceIdByDocumentId.get(
              harness.resourceId(expected)
            );
          expect(harness.selectedResourceId.value).toBe(expectedId);
          expect(harness.activeCreationResourceId.value).toBe(expectedId);
          expect(changes).toEqual([expectedId]);
          expect(draftDisclosure.open.value).toBe(false);
          expect(bookDisclosure.open.value).toBe(false);
        } finally {
          harness.scope.stop();
        }
      }
    );

    it("keeps another selected character when deleting an unselected entry", async () => {
      const harness = createHarness(bookType, ["a", "b", "c"]);
      try {
        await harness.coordinator.loadSnapshot();
        harness.select("a");
        await harness.refresh(["a", "c"]);
        expect(harness.selectedResourceId.value).toBe(harness.resourceId("a"));
        expect(harness.activeCreationResourceId.value).toBe(
          harness.resourceId("a")
        );
      } finally {
        harness.scope.stop();
      }
    });
  }
);
