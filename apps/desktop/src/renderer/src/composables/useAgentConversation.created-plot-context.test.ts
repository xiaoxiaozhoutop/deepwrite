import { WorkspaceRuntimeContextSchema } from "@deepwrite/contracts/renderer";
import {
  createDeferredApi,
  createScriptWorkspaceDocuments,
  createShortWorkspaceContentRevision,
  createShortWorkspaceDocuments,
  describe,
  expect,
  it,
  runtime,
  useAgentConversation
} from "./useAgentConversation.test-support";

describe("new plot stage prompt context", () => {
  it.each([
    ["short", "empty"],
    ["script", "empty"],
    ["short", "missing"],
    ["script", "missing"]
  ] as const)(
    "immediately uses the live %s plot content when its directory body is %s",
    async (workspaceType, directoryBody) => {
      const deferred = createDeferredApi();
      const controller = useAgentConversation({ api: () => deferred.api });
      const documents =
        workspaceType === "short"
          ? createShortWorkspaceDocuments()
          : createScriptWorkspaceDocuments();
      const source = documents.find(
        ({ stageId }) => stageId === "plot_design"
      )!;
      const stageId = "plot-stage-agent:created-ending";
      const active = {
        ...source,
        id: `${source.workspaceId}:${stageId}`,
        stageId,
        title: "终局回收",
        plotStageDescription: "回收前文伏笔。",
        plotStageOrder: documents.length,
        content: `${"线索".repeat(10_010)}\n真相在此揭晓。`
      };
      const stale = { ...active, content: "", catalogContentLoaded: false };
      if (directoryBody === "empty") documents.push(stale);
      controller.draft.value = "继续完善新建的剧情结构";
      deferred.resolveAccepted(0, {
        sessionId: controller.sessionId.value,
        runId: `run-created-plot-${workspaceType}`,
        acceptedAt: new Date().toISOString(),
        runtime
      });

      try {
        await controller.sendMessage(active, documents);

        const context = WorkspaceRuntimeContextSchema.parse(
          deferred.prompts[0]?.workspaceContext
        );
        const workspace = context.shortWorkspace ?? context.scriptWorkspace;
        expect(workspace?.activeStageId).toBe(stageId);
        expect(
          workspace?.stages.find((stage) => stage.stageId === stageId)
        ).toMatchObject({
          content: active.content,
          revision: createShortWorkspaceContentRevision(active.content)
        });
        expect(context.activeResource).toMatchObject({
          content: active.content.slice(0, 20_000),
          truncated: true,
          originalLength: active.content.length
        });
        expect(stale.content).toBe("");
      } finally {
        controller.dispose();
      }
    }
  );

  it("captures the active stage before asynchronous context loading", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    const documents = createShortWorkspaceDocuments();
    const active = documents.find(({ stageId }) => stageId === "plot_design")!;
    const sentContent = active.content;
    controller.draft.value = "检查当前剧情";
    deferred.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run-context-snapshot",
      acceptedAt: new Date().toISOString(),
      runtime
    });

    try {
      const sending = controller.sendMessage(active, documents);
      active.content = "发送后编辑器发生的新修改。";
      await sending;

      const context = WorkspaceRuntimeContextSchema.parse(
        deferred.prompts[0]?.workspaceContext
      );
      expect(context.activeResource?.content).toBe(sentContent);
      expect(
        context.shortWorkspace?.stages.find(
          (stage) => stage.stageId === "plot_design"
        )?.content
      ).toBe(sentContent);
    } finally {
      controller.dispose();
    }
  });
});
