import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readRegularFileOptionalWithIdentity } from "./io";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, realpath: vi.fn(fs.realpath), lstat: vi.fn(fs.lstat) };
});
const fs =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const roots: string[] = [];
beforeEach(() => {
  vi.mocked(realpath).mockReset().mockImplementation(fs.realpath);
  vi.mocked(lstat).mockReset().mockImplementation(fs.lstat);
});
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function fixture() {
  const root = await fs.realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-path-race-"))
  );
  roots.push(root);
  const path = join(root, "transaction.lock");
  await writeFile(path, "fixture owner");
  const info = await fs.lstat(path, { bigint: true });
  const read = (pathRaceAsMissing = true) =>
    readRegularFileOptionalWithIdentity(root, path, 4096, {
      pathRaceAsMissing
    });
  return { root, path, info, read };
}

it("treats a disappearing lock as missing before checking a deletion path", async () => {
  const { root, path, read } = await fixture();
  vi.mocked(realpath).mockResolvedValueOnce(join(root, "..", "deleted-lock"));
  vi.mocked(lstat).mockRejectedValueOnce(
    Object.assign(new Error("fixture disappeared"), { code: "ENOENT" })
  );
  await expect(read()).resolves.toBeUndefined();
  expect(await readFile(path, "utf8")).toBe("fixture owner");
});

it("does not consume a replacement while inspecting an old lock handle", async () => {
  const { root, info, read } = await fixture();
  vi.mocked(realpath).mockResolvedValueOnce(join(root, "..", "deleted-lock"));
  vi.mocked(lstat).mockResolvedValueOnce(
    Object.assign(Object.create(info) as typeof info, { ino: info.ino + 1n })
  );
  await expect(read()).resolves.toBeUndefined();
});

it("still rejects an out-of-root canonical path for an unchanged file", async () => {
  const { root, read } = await fixture();
  vi.mocked(realpath).mockResolvedValueOnce(join(root, "..", "outside"));
  await expect(read()).rejects.toThrow("路径越过项目根目录");
});

it("keeps missing-path errors for ordinary document reads", async () => {
  const { read } = await fixture();
  const missing = Object.assign(new Error("fixture disappeared"), {
    code: "ENOENT"
  });
  vi.mocked(lstat).mockRejectedValueOnce(missing);
  await expect(read(false)).rejects.toBe(missing);
});

it("does not suppress permission errors while probing a racing lock", async () => {
  const { read } = await fixture();
  const denied = Object.assign(new Error("fixture denied"), { code: "EACCES" });
  vi.mocked(lstat).mockRejectedValueOnce(denied);
  await expect(read()).rejects.toBe(denied);
});

it("reads an unchanged regular file and retains its exact identity", async () => {
  const { info, read } = await fixture();
  await expect(read()).resolves.toEqual({
    bytes: Buffer.from("fixture owner"),
    identity: `${info.dev}:${info.ino}`
  });
});
