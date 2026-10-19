import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

const temporaryDirectories = [];
export const tag = "v9.8.7";
export const repo = { owner: "example-owner", repo: "example-repository" };
export const installer = "DeepWrite-9.8.7-win-x64-test.exe";

export async function cleanupReleaseFixtures() {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
}

export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "deepwrite-release-upload-"));
  temporaryDirectories.push(directory);
  for (const name of [installer, "latest.yml", "SHA256SUMS.txt"]) {
    await writeFile(join(directory, name), `test data for ${name}`);
  }
  const release = {
    id: 42,
    tag_name: tag,
    draft: false,
    immutable: false,
    html_url: "https://example.test/releases/v9.8.7"
  };
  const assets = [];
  const uploads = [];
  const releases = [];
  const latest = { tag: undefined };
  const github = {
    rest: {
      repos: {
        getCommit: vi.fn(async ({ ref }) => {
          if (ref !== `refs/tags/${tag}`)
            throw Object.assign(new Error("fixture invalid tag reference"), {
              status: 422
            });
          return { data: { sha: commit } };
        }),
        getReleaseByTag: vi.fn(async () => ({ data: release })),
        getRelease: vi.fn(async () => ({ data: release })),
        listReleases: vi.fn(),
        createRelease: vi.fn(async (options) => {
          Object.assign(release, options);
          releases.push(release);
          return { data: release };
        }),
        updateRelease: vi.fn(async (options) => {
          Object.assign(release, options);
          if (options.make_latest === "true") latest.tag = release.tag_name;
          if (options.make_latest === "legacy") {
            // Model GitHub's version-based selection at publication time.
            latest.tag = releases
              .filter((item) => !item.draft && !item.prerelease)
              .map((item) => item.tag_name)
              .sort(new Intl.Collator("en", { numeric: true }).compare)
              .at(-1);
          }
          return { data: release };
        }),
        listReleaseAssets: vi.fn(),
        deleteReleaseAsset: vi.fn(async ({ asset_id }) => {
          const index = assets.findIndex((asset) => asset.id === asset_id);
          if (index < 0) throw new Error("fixture asset not found");
          assets.splice(index, 1);
        }),
        uploadReleaseAsset: vi.fn(async ({ name, data }) => {
          uploads.push(name);
          const asset = {
            id: assets.length + 100,
            name,
            size: data.length,
            state: "uploaded",
            digest: `sha256:${createHash("sha256").update(data).digest("hex")}`
          };
          assets.push(asset);
          return { data: asset };
        })
      }
    },
    paginate: vi.fn(async (method) =>
      method === github.rest.repos.listReleases
        ? releases.map((item) => ({ ...item }))
        : assets.map((asset) => ({ ...asset }))
    )
  };
  const args = { github, repo, tag, releaseId: 42, directory };
  return { args, github, release, releases, assets, uploads, latest };
}

export const commit = "a".repeat(40);
export const runId = 123;
export const owner = `<!-- deepwrite-tag-build:${runId}:${commit} -->`;

export async function tagFixture() {
  const result = await fixture();
  return { ...result, args: { ...result.args, commit, runId } };
}
