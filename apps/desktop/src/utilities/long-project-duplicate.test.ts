import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LongLedgerCommitRecordSchema } from "@deepwrite/contracts";
import { LongProjectStore } from "./long-project-store";

// Creating, committing and copying real projects needs a disk integration budget.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const NOW = "2026-08-05T09:00:00.000Z";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("LongProjectStore duplicateBook", () => {
  it("copies current content and keeps audit commits without rollback metadata", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deepwrite-long-copy-"));
    roots.push(parent);
    const store = new LongProjectStore({ now: () => NOW });
    const source = await store.createBook(parent, {
      id: "longbook_source-copy",
      title: "长篇原稿",
      genre: "悬疑",
      linkedMaterialIdsByKind: {
        character: ["material-one"],
        gimmick: [],
        plot: [],
        draft: [],
        other: []
      },
      linkedSkillIdsByKind: {
        general: [],
        plot: ["skill-one"],
        style: [],
        other: []
      }
    });
    const chapter = source.book.workspaceIndex.chapters[0]!;
    const writes = [
      [chapter.body, "复制后的第一章正文"],
      [chapter.characterState, "人物保持警觉"],
      [chapter.handoff, "下一章继续追查"]
    ] as const;
    const written = await store.applyWorkspaceOperations(
      source.projectDirectory,
      {
        batch: {
          updatedAt: NOW,
          operations: [],
          documentWrites: writes.map(([reference, content], index) => ({
            proposalId: `proposal_copy_${index}`,
            fileId: reference.id,
            mode: "replace" as const,
            updatedAt: NOW,
            content,
            reason: "准备长篇复制测试"
          }))
        }
      }
    );
    const writtenChapter = written.book.workspaceIndex.chapters[0]!;
    const committed = await store.commitChapter(source.projectDirectory, {
      mode: "text_files",
      chapterCardId: writtenChapter.chapterCardId,
      foreshadowingBeatDecisions: {},
      commitMessage: "建立复制测试基线"
    });

    const copy = await store.duplicateBook(
      parent,
      source.projectDirectory,
      "长篇原稿copy1"
    );
    const copiedChapter = copy.book.workspaceIndex.chapters[0]!;
    const copiedCommit = copy.book.workspaceIndex.ledger.commits[0]!;

    expect(copy.book.id).not.toBe(source.book.id);
    expect(copy.book.title).toBe("长篇原稿copy1");
    expect(copy.book.linkedMaterialIdsByKind).toEqual(
      source.book.linkedMaterialIdsByKind
    );
    expect(copy.book.linkedSkillIdsByKind).toEqual(
      source.book.linkedSkillIdsByKind
    );
    expect(copiedCommit.id).toBe(committed.record.id);
    expect(copiedCommit).not.toHaveProperty("reversible");
    expect(committed.record).not.toHaveProperty("reversible");
    await expect(
      store.readDocument(copy.projectDirectory, {
        fileId: copiedChapter.body.id
      })
    ).resolves.toMatchObject({ content: "复制后的第一章正文" });
    await store.writeDocument(copy.projectDirectory, {
      fileId: copiedChapter.body.id,
      content: "副本提交后直接改写"
    });
    await expect(
      store.readDocument(copy.projectDirectory, {
        fileId: copiedChapter.body.id
      })
    ).resolves.toMatchObject({ content: "副本提交后直接改写" });
  });

  it("duplicates a partially cleaned project whose ledger alone has retired metadata", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deepwrite-long-copy-legacy-"));
    roots.push(parent);
    const store = new LongProjectStore({ now: () => NOW });
    const source = await store.createBook(parent, {
      id: "longbook_source-ledger-only",
      title: "仅账本残留旧字段",
      genre: "悬疑"
    });
    const chapter = source.book.workspaceIndex.chapters[0]!;
    await store.writeChapter(source.projectDirectory, {
      chapterCardId: chapter.chapterCardId,
      body: { content: "第一章正文" },
      characterState: { content: "人物状态" },
      handoff: { content: "下一章继续" }
    });
    await store.commitChapter(source.projectDirectory, {
      mode: "text_files",
      chapterCardId: chapter.chapterCardId,
      foreshadowingBeatDecisions: {},
      commitMessage: "建立旧账本兼容测试"
    });

    const reopened = await store.openBook(source.projectDirectory);
    const sourceEntry = reopened.book.workspaceIndex.ledger.commits[0]!;
    const sourceRecordPath = join(
      source.projectDirectory,
      sourceEntry.recordFile.path
    );
    const legacyRecord = JSON.parse(
      await readFile(sourceRecordPath, "utf8")
    ) as Record<string, unknown>;
    legacyRecord.reversible = true;
    legacyRecord.sourceProjectRevision = 1;
    legacyRecord.committedWorkspaceRevision = 2;
    legacyRecord.previousChapterCommitId = null;
    legacyRecord.fileChanges = [];
    legacyRecord.before = { revision: "v1:legacy" };
    for (const file of legacyRecord.continuityFiles as Array<
      Record<string, unknown>
    >) {
      file.revision = "v1:legacy";
    }
    await writeFile(
      sourceRecordPath,
      `${JSON.stringify(legacyRecord, null, 2)}\n`,
      "utf8"
    );

    await expect(
      store.openBook(source.projectDirectory)
    ).resolves.toBeDefined();
    const copy = await store.duplicateBook(
      parent,
      source.projectDirectory,
      "仅账本残留旧字段copy1"
    );
    const copiedEntry = copy.book.workspaceIndex.ledger.commits[0]!;
    const copiedRecordContent = await readFile(
      join(copy.projectDirectory, copiedEntry.recordFile.path),
      "utf8"
    );
    expect(copiedRecordContent).not.toMatch(
      /"(?:revision|[^"\n]*Revision|[^"\n]*Revisions|reversible|fileChanges|before)"\s*:/u
    );
    expect(() =>
      LongLedgerCommitRecordSchema.parse(JSON.parse(copiedRecordContent))
    ).not.toThrow();
  });
});
