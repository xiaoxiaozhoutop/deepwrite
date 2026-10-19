import { afterEach, expect, it, vi } from "vitest";
import { hashProjectFiles, type LocalBackupProject } from "./catalog-reader";
import { diffBackupItems } from "./diff";
import { packBackupSnapshot, readBackupSnapshot } from "./packager";
import * as zip from "./zip";

afterEach(() => vi.restoreAllMocks());

function project(id: string): LocalBackupProject {
  const files = [
    { relativePath: "body.md", data: Buffer.from("abc") },
    {
      relativePath: "deepwrite.json",
      data: Buffer.from(JSON.stringify({ id }))
    }
  ];
  return {
    kind: "book",
    id,
    title: id,
    projectDirectory: "unused",
    files,
    ...hashProjectFiles(files)
  };
}

function snapshot() {
  const packed = packBackupSnapshot("test-key", "2026-10-19T00:00:00.000Z", [
    project("book_first"),
    project("book_second")
  ]);
  const changes = diffBackupItems("download", [], packed.manifest.items);
  return { ...packed, changes };
}

it("decodes a multi-project archive once and validates the selected projects", () => {
  const packed = snapshot();
  const decode = vi.spyOn(zip, "readZip");
  const projects = readBackupSnapshot(
    packed.zip,
    packed.manifest,
    packed.changes
  );

  expect(projects.size).toBe(2);
  expect(projects.get("book:book_first")).toEqual(project("book_first").files);
  expect(projects.get("book:book_second")).toEqual(
    project("book_second").files
  );
  expect(decode).toHaveBeenCalledOnce();
});

it("rejects a same-size archive with different content in a later project", () => {
  const packed = snapshot();
  const files = zip.readZip(packed.zip);
  files.set("items/book/book_second/body.md", Buffer.from("xyz"));
  const changed = zip.createZip(
    [...files].map(([name, data]) => ({ name, data }))
  );
  expect(changed.length).toBe(packed.zip.length);

  expect(() =>
    readBackupSnapshot(changed, packed.manifest, packed.changes)
  ).toThrow("备份文件与预览不一致");
});

it("validates backups written on a host with a different filename collation", () => {
  const packed = snapshot();
  const compare = String.prototype.localeCompare;
  vi.spyOn(String.prototype, "localeCompare").mockImplementation(function (
    this: string,
    other: string
  ) {
    return -compare.call(this, other);
  });

  expect(
    readBackupSnapshot(packed.zip, packed.manifest, packed.changes).get(
      "book:book_first"
    )
  ).toEqual(project("book_first").files);
});
