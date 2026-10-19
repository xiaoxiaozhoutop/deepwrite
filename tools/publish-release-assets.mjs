import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { inspectReleaseFile } from "./release-files.mjs";

async function assertTagCommit({ github, repo, tag, commit }) {
  // Resolve the tag to a commit, including annotated tags. target_commitish
  // does not pin an existing tag when creating a release.
  const { data } = await github.rest.repos.getCommit({
    ...repo,
    ref: `refs/tags/${tag}`
  });
  if (data.sha !== commit) {
    throw new Error("Release 标签对应的提交已改变，拒绝公开本轮安装包。");
  }
}

export async function getReleaseForUpload({
  github,
  repo,
  tag,
  releaseId,
  draftOwner
}) {
  const { data } = await (draftOwner
    ? github.rest.repos.getRelease({ ...repo, release_id: releaseId })
    : github.rest.repos.getReleaseByTag({ ...repo, tag }));
  if (
    data.tag_name !== tag ||
    (releaseId !== undefined && String(data.id) !== String(releaseId))
  ) {
    throw new Error("Release 已改变，无法向本轮发布追加安装包。");
  }
  if (draftOwner) {
    if (!data.draft || !data.body?.includes(draftOwner))
      throw new Error("Release 草稿不属于本轮工作流，拒绝修改。");
  } else if (data.draft) {
    throw new Error("请先发布 Release，再运行自动打包。");
  }
  if (data.immutable) {
    throw new Error(
      "Release 已锁定，无法追加安装包；此流程需要关闭 Release immutability。"
    );
  }
  return data;
}

function matchesAsset(remote, local) {
  return (
    remote?.state === "uploaded" &&
    remote.size === local.size &&
    remote.digest === `sha256:${local.sha256}`
  );
}

export async function uploadReleaseAssets({
  github,
  repo,
  tag,
  releaseId,
  directory,
  draftOwner
}) {
  const release = await getReleaseForUpload({
    github,
    repo,
    tag,
    releaseId,
    draftOwner
  });
  const names = (await readdir(directory)).sort((left, right) => {
    // Update manifests are visible only after all download files are present.
    const priority = (name) => (name.endsWith(".yml") ? 1 : 0);
    return priority(left) - priority(right) || left.localeCompare(right);
  });
  if (!names.length) throw new Error("没有可上传的 Release 文件。");
  const localFiles = [];
  for (const name of names) {
    const path = join(directory, name);
    localFiles.push({ name, path, ...(await inspectReleaseFile(path)) });
  }
  const listAssets = () =>
    github.paginate(github.rest.repos.listReleaseAssets, {
      ...repo,
      release_id: release.id,
      per_page: 100
    });
  const existing = new Map(
    (await listAssets()).map((file) => [file.name, file])
  );
  if (
    draftOwner &&
    [...existing.keys()].some((name) => !names.includes(name))
  ) {
    throw new Error("Release 草稿包含本轮产物以外的附件，拒绝公开。");
  }
  // Check all collisions before uploading anything; public downloads are preserved.
  const interrupted = [];
  for (const local of localFiles) {
    const remote = existing.get(local.name);
    if (draftOwner && remote?.state === "starter" && remote.size === 0) {
      interrupted.push(remote);
      continue;
    }
    if (remote && !matchesAsset(remote, local)) {
      throw new Error(
        `Release 已有不同内容的同名文件，拒绝覆盖：${local.name}`
      );
    }
  }
  for (const remote of interrupted) {
    // A failed upload can leave an empty starter asset. Delete it only while
    // the release is still the private draft owned by this workflow run.
    await getReleaseForUpload({
      github,
      repo,
      tag,
      releaseId: release.id,
      draftOwner
    });
    await github.rest.repos.deleteReleaseAsset({
      ...repo,
      asset_id: remote.id
    });
    existing.delete(remote.name);
  }
  for (const local of localFiles) {
    if (existing.has(local.name)) continue;
    const data = await readFile(local.path);
    if (createHash("sha256").update(data).digest("hex") !== local.sha256) {
      throw new Error(`Release 文件在上传前发生改变：${local.name}`);
    }
    await github.rest.repos.uploadReleaseAsset({
      ...repo,
      release_id: release.id,
      name: local.name,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": data.length
      },
      data
    });
  }
  const uploaded = new Map(
    (await listAssets()).map((file) => [file.name, file])
  );
  if (draftOwner && uploaded.size !== localFiles.length) {
    throw new Error("Release 草稿附件数量与本轮产物不一致，拒绝公开。");
  }
  for (const local of localFiles) {
    if (!matchesAsset(uploaded.get(local.name), local)) {
      throw new Error(
        `Release 文件上传后的大小或 SHA-256 校验失败：${local.name}`
      );
    }
  }
  return release.html_url;
}

/** Only the validated build run may resume its upload draft. */
export async function publishTagRelease({
  github,
  repo,
  tag,
  commit,
  runId,
  directory
}) {
  if (
    !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(tag ?? "") ||
    !/^[a-f\d]{40}$/u.test(commit ?? "") ||
    !/^\d+$/u.test(String(runId ?? ""))
  ) {
    throw new Error("Release 标签、源提交或工作流编号无效。");
  }
  await assertTagCommit({ github, repo, tag, commit });
  const draftOwner = `<!-- deepwrite-tag-build:${runId}:${commit} -->`;
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...repo,
    per_page: 100
  });
  const matches = releases.filter((release) => release.tag_name === tag);
  if (
    matches.length > 1 ||
    (matches[0] &&
      (!matches[0].draft || !matches[0].body?.includes(draftOwner)))
  ) {
    throw new Error("该标签已有公开 Release 或其他运行的草稿，拒绝覆盖。");
  }
  const release =
    matches[0] ??
    (
      await github.rest.repos.createRelease({
        ...repo,
        tag_name: tag,
        target_commitish: commit,
        name: `DeepWrite ${tag.slice(1)}`,
        body: draftOwner,
        generate_release_notes: true,
        draft: true,
        prerelease: false
      })
    ).data;
  await uploadReleaseAssets({
    github,
    repo,
    tag,
    releaseId: release.id,
    directory,
    draftOwner
  });
  // Uploads may take minutes; recheck ownership and mutability at publication.
  await getReleaseForUpload({
    github,
    repo,
    tag,
    releaseId: release.id,
    draftOwner
  });
  await assertTagCommit({ github, repo, tag, commit });
  const { data } = await github.rest.repos.updateRelease({
    ...repo,
    release_id: release.id,
    draft: false,
    prerelease: false,
    // Let GitHub choose by version at publication time, including releases
    // completed by another tag's workflow while these assets were uploading.
    make_latest: "legacy"
  });
  if (data.draft || data.prerelease || data.tag_name !== tag) {
    throw new Error("Release 未成功公开。");
  }
  return data.html_url;
}
