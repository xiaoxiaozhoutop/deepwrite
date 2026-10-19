import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url)
);
const yaml = createRequire(desktopRequire.resolve("electron-builder"))(
  "js-yaml"
);
const workflow = yaml.load(
  await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8"
  )
);
const script = workflow.jobs.prepare.steps.find(
  (step) => step.id === "recovery"
).with.script;
const execute = compileFunction(`return (async () => {\n${script}\n})();`, [
  "github",
  "context",
  "core",
  "process"
]);
const platforms = ["win-x64", "mac-arm64", "mac-x64", "linux-x64"];
const commit = "a".repeat(40);

function fixture(runId = "123") {
  const run = {
    path: ".github/workflows/release.yml",
    head_sha: commit,
    status: "completed",
    conclusion: "failure"
  };
  const jobs = platforms.map((platform) => ({
    name: `Package ${platform}`,
    status: "completed",
    conclusion: "success"
  }));
  const artifacts = platforms.map((platform) => ({
    name: `installers-${platform}`,
    expired: false,
    size_in_bytes: 10
  }));
  const actions = {
    getWorkflowRun: vi.fn(async () => ({ data: run })),
    listJobsForWorkflowRun: vi.fn(),
    listWorkflowRunArtifacts: vi.fn()
  };
  const github = {
    rest: { actions },
    paginate: vi.fn(async (method) => {
      if (method === actions.listJobsForWorkflowRun) return jobs;
      if (method === actions.listWorkflowRunArtifacts) return artifacts;
      throw new Error("Unexpected fixture request");
    })
  };
  const core = { setOutput: vi.fn() };
  const context = {
    repo: { owner: "example-owner", repo: "example-repository" }
  };
  const invoke = () =>
    execute(github, context, core, {
      env: { REUSE_RUN_ID: runId, RELEASE_COMMIT: commit }
    });
  return { invoke, run, jobs, artifacts, actions, core };
}

describe("verified release artifact recovery", () => {
  it("reuses successful installers when the original publication failed", async () => {
    const { invoke, core, actions } = fixture();
    await invoke();
    expect(core.setOutput).toHaveBeenCalledExactlyOnceWith("run_id", "123");
    expect(actions.getWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "example-owner",
        repo: "example-repository",
        run_id: 123
      })
    );
  });

  it.each(["0", "-1", "01", "invalid", "9007199254740992"])(
    "rejects invalid run ID %s before contacting GitHub",
    async (runId) => {
      const { invoke, actions, core } = fixture(runId);
      await expect(invoke()).rejects.toThrow("Invalid installer run ID");
      expect(actions.getWorkflowRun).not.toHaveBeenCalled();
      expect(core.setOutput).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["head_sha", "b".repeat(40)],
    ["path", ".github/workflows/other.yml"],
    ["status", "in_progress"]
  ])("rejects a mismatched run %s", async (key, value) => {
    const { invoke, run, core } = fixture();
    run[key] = value;
    await expect(invoke()).rejects.toThrow(
      "does not match the released source"
    );
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it.each(platforms)(
    "requires successful %s verification",
    async (platform) => {
      const { invoke, jobs, core } = fixture();
      jobs.find((job) => job.name === `Package ${platform}`).conclusion =
        "failure";
      await expect(invoke()).rejects.toThrow(platform);
      expect(core.setOutput).not.toHaveBeenCalled();
    }
  );

  it.each(["missing", "duplicate", "unfinished"])(
    "rejects %s installer verification",
    async (kind) => {
      const { invoke, jobs, core } = fixture();
      if (kind === "missing") jobs.pop();
      if (kind === "duplicate") jobs.push({ ...jobs[0] });
      if (kind === "unfinished") jobs[0].status = "in_progress";
      await expect(invoke()).rejects.toThrow("verification did not pass");
      expect(core.setOutput).not.toHaveBeenCalled();
    }
  );

  it.each(platforms)("rejects expired %s installers", async (platform) => {
    const { invoke, artifacts, core } = fixture();
    artifacts.find(
      (artifact) => artifact.name === `installers-${platform}`
    ).expired = true;
    await expect(invoke()).rejects.toThrow("incomplete or expired");
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it.each(["missing", "empty", "duplicate", "unexpected"])(
    "rejects %s installer artifacts",
    async (kind) => {
      const { invoke, artifacts, core } = fixture();
      if (kind === "missing") artifacts.pop();
      if (kind === "empty") artifacts[0].size_in_bytes = 0;
      if (kind === "duplicate") artifacts.push({ ...artifacts[0] });
      if (kind === "unexpected") artifacts[0].name = "installers-other";
      await expect(invoke()).rejects.toThrow("incomplete or expired");
      expect(core.setOutput).not.toHaveBeenCalled();
    }
  );

  it("preserves a GitHub access error without accepting any artifacts", async () => {
    const { invoke, actions, core } = fixture();
    actions.getWorkflowRun.mockRejectedValue(
      new Error("Fixture run unavailable")
    );
    await expect(invoke()).rejects.toThrow("Fixture run unavailable");
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});
