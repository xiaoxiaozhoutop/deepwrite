import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getReleaseForUpload,
  publishTagRelease,
  uploadReleaseAssets
} from "./publish-release-assets.mjs";

const temporaryDirectories = [];
const tag = "v9.8.7";
const repo = { owner: "example-owner", repo: "example-repository" };
const installer = "DeepWrite-9.8.7-win-x64-test.exe";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function fixture() {
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

describe("published release asset uploads", () => {
  it("uploads update metadata after downloads and verifies the remote digests", async () => {
    const { args, github, uploads } = await fixture();
    expect(await uploadReleaseAssets(args)).toBe(
      "https://example.test/releases/v9.8.7"
    );
    expect(uploads).toEqual([installer, "SHA256SUMS.txt", "latest.yml"]);
    expect(github.paginate).toHaveBeenCalledTimes(2);
    expect(github.rest.repos.uploadReleaseAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        ...repo,
        release_id: 42,
        name: installer,
        data: await readFile(join(args.directory, installer))
      })
    );
  });

  it("resumes an interrupted upload without replacing completed downloads", async () => {
    const { args, github, uploads } = await fixture();
    const upload = github.rest.repos.uploadReleaseAsset.getMockImplementation();
    github.rest.repos.uploadReleaseAsset
      .mockImplementationOnce(upload)
      .mockRejectedValueOnce(new Error("temporary upload failure"));
    await expect(uploadReleaseAssets(args)).rejects.toThrow(
      "temporary upload failure"
    );
    expect(uploads).toEqual([installer]);
    await expect(uploadReleaseAssets(args)).resolves.toBe(
      "https://example.test/releases/v9.8.7"
    );
    expect(uploads).toEqual([installer, "SHA256SUMS.txt", "latest.yml"]);
  });

  it("does not upload twice when a completed job runs again", async () => {
    const { args, uploads } = await fixture();
    await uploadReleaseAssets(args);
    await uploadReleaseAssets(args);
    expect(uploads).toHaveLength(3);
  });

  it.each([
    "different digest",
    "missing digest",
    "wrong size",
    "incomplete upload"
  ])("preserves an existing asset with %s", async (reason) => {
    const { args, github, assets, uploads } = await fixture();
    const data = await readFile(join(args.directory, "latest.yml"));
    const asset = {
      name: "latest.yml",
      size: data.length,
      state: "uploaded",
      digest: `sha256:${createHash("sha256").update(data).digest("hex")}`
    };
    if (reason === "different digest") asset.digest = "sha256:invalid";
    if (reason === "missing digest") delete asset.digest;
    if (reason === "wrong size") asset.size += 1;
    if (reason === "incomplete upload") asset.state = "starter";
    assets.push(asset);
    await expect(uploadReleaseAssets(args)).rejects.toThrow("拒绝覆盖");
    expect(uploads).toEqual([]);
    expect(github.rest.repos.deleteReleaseAsset).not.toHaveBeenCalled();
  });

  it.each(["draft", "immutable"])(
    "rejects a %s release before any upload",
    async (field) => {
      const { args, release, uploads } = await fixture();
      release[field] = true;
      await expect(uploadReleaseAssets(args)).rejects.toThrow();
      expect(uploads).toEqual([]);
    }
  );

  it("rejects a release replaced after the build started", async () => {
    const { args, release, uploads } = await fixture();
    release.id = 43;
    await expect(uploadReleaseAssets(args)).rejects.toThrow("Release 已改变");
    expect(uploads).toEqual([]);
  });

  it("rejects a changed release tag", async () => {
    const { args, release } = await fixture();
    release.tag_name = "v9.8.8";
    await expect(getReleaseForUpload(args)).rejects.toThrow("Release 已改变");
  });

  it("does not treat a missing release as permission to create one", async () => {
    const { args, github, uploads } = await fixture();
    github.rest.repos.getReleaseByTag.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 })
    );
    await expect(uploadReleaseAssets(args)).rejects.toThrow("not found");
    expect(uploads).toEqual([]);
  });

  it("reports remote corruption after uploading", async () => {
    const { args, github, assets } = await fixture();
    github.paginate
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async () => {
        assets[0].digest = "sha256:invalid";
        return assets;
      });
    await expect(uploadReleaseAssets(args)).rejects.toThrow("SHA-256 校验失败");
  });

  it("rejects empty local files before uploading anything", async () => {
    const { args, uploads } = await fixture();
    await writeFile(join(args.directory, "latest.yml"), "");
    await expect(uploadReleaseAssets(args)).rejects.toThrow("非空");
    expect(uploads).toEqual([]);
  });
});

const commit = "a".repeat(40);
const runId = 123;
const owner = `<!-- deepwrite-tag-build:${runId}:${commit} -->`;

async function tagFixture() {
  const result = await fixture();
  return { ...result, args: { ...result.args, commit, runId } };
}

describe("tag-triggered release publication", () => {
  it("rejects a moved tag before creating or uploading a release", async () => {
    const { args, github, uploads } = await tagFixture();
    github.rest.repos.getCommit.mockResolvedValue({
      data: { sha: "b".repeat(40) }
    });
    await expect(publishTagRelease(args)).rejects.toThrow("标签对应的提交");
    expect(uploads).toEqual([]);
    expect(github.rest.repos.createRelease).not.toHaveBeenCalled();
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
  });

  it.each(["moved", "deleted"])(
    "keeps the draft private if its tag is %s during upload",
    async (change) => {
      const { args, github, release, uploads } = await tagFixture();
      const upload =
        github.rest.repos.uploadReleaseAsset.getMockImplementation();
      github.rest.repos.uploadReleaseAsset.mockImplementationOnce(
        async (options) => {
          if (change === "moved")
            github.rest.repos.getCommit.mockResolvedValue({
              data: { sha: "b".repeat(40) }
            });
          else
            github.rest.repos.getCommit.mockRejectedValue(
              Object.assign(new Error("fixture tag not found"), { status: 404 })
            );
          return upload(options);
        }
      );
      await expect(publishTagRelease(args)).rejects.toThrow();
      expect(uploads).toHaveLength(3);
      expect(release.draft).toBe(true);
      expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
    }
  );

  it("does not create a tag if the source reference cannot be resolved", async () => {
    const { args, github, uploads } = await tagFixture();
    github.rest.repos.getCommit.mockRejectedValueOnce(
      Object.assign(new Error("fixture tag not found"), { status: 404 })
    );
    await expect(publishTagRelease(args)).rejects.toThrow(
      "fixture tag not found"
    );
    expect(uploads).toEqual([]);
    expect(github.rest.repos.createRelease).not.toHaveBeenCalled();
  });

  it("creates a draft and publishes only after all assets are verified", async () => {
    const { args, github, release, uploads, latest } = await tagFixture();
    const update = github.rest.repos.updateRelease.getMockImplementation();
    github.rest.repos.updateRelease.mockImplementation(async (options) => {
      expect(release.draft).toBe(true);
      expect(uploads).toHaveLength(3);
      return update(options);
    });
    await expect(publishTagRelease(args)).resolves.toBe(release.html_url);
    expect(github.rest.repos.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        tag_name: tag,
        target_commitish: commit,
        draft: true,
        prerelease: false,
        generate_release_notes: true,
        body: owner
      })
    );
    expect(github.rest.repos.updateRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        release_id: 42,
        draft: false,
        make_latest: "legacy"
      })
    );
    expect(release.draft).toBe(false);
    expect(latest.tag).toBe(tag);
    expect(github.rest.repos.getCommit).toHaveBeenCalledTimes(2);
    expect(github.rest.repos.getCommit).toHaveBeenCalledWith({
      ...repo,
      ref: `refs/tags/${tag}`
    });
  });

  it.each([
    ["v9.8.8", false],
    ["v9.8.10", false],
    ["v10.0.0", true],
    ["v9.8.6", false]
  ])(
    "selects Latest by version when %s is published during upload: %s",
    async (otherTag, duringUpload) => {
      const { args, github, releases, release, latest, uploads } =
        await tagFixture();
      const publishOther = () => {
        releases.push({
          id: 43,
          tag_name: otherTag,
          draft: false,
          prerelease: false
        });
        latest.tag = otherTag;
      };
      if (duringUpload) {
        const upload =
          github.rest.repos.uploadReleaseAsset.getMockImplementation();
        github.rest.repos.uploadReleaseAsset.mockImplementationOnce(
          async (options) => {
            publishOther();
            return upload(options);
          }
        );
      } else {
        publishOther();
      }
      await publishTagRelease(args);
      expect(latest.tag).toBe(otherTag === "v9.8.6" ? tag : otherTag);
      expect(release.draft).toBe(false);
      expect(uploads).toHaveLength(3);
    }
  );

  it("keeps interrupted uploads private and resumes the same run's draft", async () => {
    const { args, github, release, uploads } = await tagFixture();
    const upload = github.rest.repos.uploadReleaseAsset.getMockImplementation();
    github.rest.repos.uploadReleaseAsset
      .mockImplementationOnce(upload)
      .mockRejectedValueOnce(new Error("temporary upload failure"));
    await expect(publishTagRelease(args)).rejects.toThrow(
      "temporary upload failure"
    );
    expect(release.draft).toBe(true);
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
    await expect(publishTagRelease(args)).resolves.toBe(release.html_url);
    expect(github.rest.repos.createRelease).toHaveBeenCalledTimes(1);
    expect(uploads).toHaveLength(3);
  });

  it("removes only an empty starter asset from this run's draft before resuming", async () => {
    const { args, github, release, assets, uploads } = await tagFixture();
    const upload = github.rest.repos.uploadReleaseAsset.getMockImplementation();
    github.rest.repos.uploadReleaseAsset
      .mockImplementationOnce(upload)
      .mockImplementationOnce(async ({ name }) => {
        assets.push({ id: 99, name, size: 0, state: "starter" });
        throw Object.assign(new Error("upstream upload failure"), {
          status: 502
        });
      });
    await expect(publishTagRelease(args)).rejects.toThrow(
      "upstream upload failure"
    );
    expect(release.draft).toBe(true);
    await expect(publishTagRelease(args)).resolves.toBe(release.html_url);
    expect(
      github.rest.repos.deleteReleaseAsset
    ).toHaveBeenCalledExactlyOnceWith({
      ...repo,
      asset_id: 99
    });
    expect(github.rest.repos.createRelease).toHaveBeenCalledTimes(1);
    expect(uploads).toEqual([installer, "SHA256SUMS.txt", "latest.yml"]);
    expect(assets.every((asset) => asset.state === "uploaded")).toBe(true);
    expect(release.draft).toBe(false);
  });

  it.each(["public", "another run", "nonempty", "uploaded", "delete failure"])(
    "preserves assets and does not publish on %s recovery failure",
    async (kind) => {
      const { args, github, release, releases, assets, uploads } =
        await tagFixture();
      Object.assign(release, {
        draft: kind !== "public",
        body: kind === "another run" ? "another run's draft" : owner
      });
      releases.push(release);
      const asset = {
        id: 99,
        name: installer,
        size: kind === "nonempty" ? 10 : 0,
        state: kind === "uploaded" ? "uploaded" : "starter"
      };
      assets.push(asset);
      if (kind === "delete failure")
        github.rest.repos.deleteReleaseAsset.mockRejectedValueOnce(
          new Error("fixture deletion failed")
        );
      const pending = expect(publishTagRelease(args)).rejects;
      if (kind === "delete failure")
        await pending.toThrow("fixture deletion failed");
      else await pending.toThrow();
      expect(assets).toEqual([asset]);
      expect(uploads).toEqual([]);
      expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
      if (kind === "delete failure")
        expect(github.rest.repos.deleteReleaseAsset).toHaveBeenCalledTimes(1);
      else expect(github.rest.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    }
  );

  it("rechecks draft ownership before deleting a starter asset", async () => {
    const { args, github, release, releases, assets } = await tagFixture();
    Object.assign(release, { draft: true, body: owner });
    releases.push(release);
    assets.push({ id: 99, name: installer, size: 0, state: "starter" });
    github.rest.repos.getRelease
      .mockResolvedValueOnce({ data: { ...release } })
      .mockResolvedValueOnce({ data: { ...release, draft: false } });
    await expect(publishTagRelease(args)).rejects.toThrow("草稿不属于本轮");
    expect(github.rest.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
  });

  it("checks all conflicts before removing any interrupted upload", async () => {
    const { args, github, release, releases, assets } = await tagFixture();
    Object.assign(release, { draft: true, body: owner });
    releases.push(release);
    assets.push(
      { id: 99, name: installer, size: 0, state: "starter" },
      { id: 100, name: "latest.yml", size: 10, state: "uploaded" }
    );
    await expect(publishTagRelease(args)).rejects.toThrow("拒绝覆盖");
    expect(assets).toHaveLength(2);
    expect(github.rest.repos.deleteReleaseAsset).not.toHaveBeenCalled();
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
  });

  it.each(["public release", "another draft", "changed source"])(
    "preserves an existing %s",
    async (kind) => {
      const { args, github, release, releases, uploads } = await tagFixture();
      release.draft = kind !== "public release";
      release.body =
        kind === "changed source"
          ? owner.replace(commit, "b".repeat(40))
          : "user release notes";
      releases.push(release);
      await expect(publishTagRelease(args)).rejects.toThrow("拒绝覆盖");
      expect(uploads).toEqual([]);
      expect(github.rest.repos.createRelease).not.toHaveBeenCalled();
      expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
    }
  );

  it("does not publish a draft with unexpected attachments", async () => {
    const { args, github, release, releases, assets } = await tagFixture();
    Object.assign(release, { draft: true, body: owner });
    releases.push(release);
    assets.push({ name: "unrelated-file.txt" });
    await expect(publishTagRelease(args)).rejects.toThrow("产物以外");
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
  });

  it("does not publish when the uploaded digest fails verification", async () => {
    const { args, github, release, assets } = await tagFixture();
    const paginate = github.paginate.getMockImplementation();
    let assetReads = 0;
    github.paginate.mockImplementation(async (method, params) => {
      if (method === github.rest.repos.listReleaseAssets && ++assetReads === 2)
        assets[0].digest = "sha256:invalid";
      return paginate(method, params);
    });
    await expect(publishTagRelease(args)).rejects.toThrow("SHA-256 校验失败");
    expect(release.draft).toBe(true);
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled();
  });

  it.each([{ tag: "v9.8.7-beta" }, { commit: "main" }, { runId: undefined }])(
    "rejects invalid publication identity %j",
    async (invalid) => {
      const { args, github } = await tagFixture();
      await expect(publishTagRelease({ ...args, ...invalid })).rejects.toThrow(
        "无效"
      );
      expect(github.paginate).not.toHaveBeenCalled();
    }
  );

  it("propagates listing failures instead of creating an unrelated release", async () => {
    const { args, github } = await tagFixture();
    github.paginate.mockRejectedValueOnce(new Error("permission denied"));
    await expect(publishTagRelease(args)).rejects.toThrow("permission denied");
    expect(github.rest.repos.createRelease).not.toHaveBeenCalled();
  });
});
