import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { resultText, toolByName } from "./short-agent-tools.test-support";
import {
  directoryId,
  handoffRuntime,
  lastToolText,
  writingInput
} from "./subagent-workspace-handoff.test-support";

const TYPES = ["short", "script"] as const;
const STAGES = ["character_design", "plot_design", "draft"] as const;
const MODES = ["standard", "pure-read"] as const;
const TITLE = "交接测试人物";
const CONTENT = "交接测试人物负责保管一封尚未拆封的信。";

function createReply(kind = "character", title = TITLE) {
  return fauxAssistantMessage(
    fauxToolCall("create", {
      kind,
      meta: {
        title,
        ...(kind === "plot_stage" ? { description: "供后续子任务读取。" } : {})
      },
      content: CONTENT,
      summary: "创建供交接的对象"
    })
  );
}

describe("live writing-workspace directories across subagents", () => {
  const cases = TYPES.flatMap((type) =>
    STAGES.flatMap((stage) => MODES.map((mode) => ({ type, stage, mode })))
  );
  it.each(cases)(
    "$type / $stage / $mode reads a sibling's new character without an id in its summary",
    async ({ type, stage, mode }) => {
      const input = writingInput(type, stage);
      input.subagentDefinitions![1]!.agentMode = mode;
      let characterId = "";
      const runtime = handoffRuntime(input, (context, index) => {
        if (index === 0) return createReply();
        if (index === 1) return fauxAssistantMessage("已创建人物，交接完毕。");
        if (index === 2) {
          characterId = directoryId(context.systemPrompt, TITLE);
          // Isolated children have no access to their sibling's tool result.
          expect(JSON.stringify(context.messages)).not.toContain("item_id=");
          return fauxAssistantMessage(
            fauxToolCall("read", { kind: "character", id: characterId })
          );
        }
        expect(lastToolText(context)).toContain(CONTENT);
        return fauxAssistantMessage("后续子任务已读到人物卡。");
      });
      const result = await toolByName(runtime.tools, "spawn_subagent").execute(
        "spawn-characters",
        {
          // Serial ordering must suffice for directory discovery, even without depends_on.
          tasks: [
            { key: "create", subagent_id: "creator", task: "创建人物。" },
            { key: "read", subagent_id: "reader", task: "读取新人物。" }
          ]
        }
      );
      expect(resultText(result)).toContain("完成 2 个");
      expect(runtime.contexts).toHaveLength(4);
      expect(characterId).not.toBe("");
      const directory = await toolByName(runtime.tools, "read").execute(
        "parent-directory",
        { kind: "workspace", id: "workspace" }
      );
      expect(directoryId(resultText(directory), TITLE)).toBe(characterId);
      const original =
        input.workspaceContext!.shortWorkspace ??
        input.workspaceContext!.scriptWorkspace!;
      expect(JSON.stringify(original)).not.toContain(TITLE);
    }
  );

  it.each(
    TYPES.flatMap((type) =>
      ["character", "plot_stage", "draft_section"].map((kind) => ({
        type,
        kind
      }))
    )
  )(
    "$type hands off new $kind ids to a dependent parallel task",
    async ({ type, kind }) => {
      const input = writingInput(type);
      input.parallelSubagents = true;
      const title = "交接测试对象";
      const runtime = handoffRuntime(input, (context, index) => {
        if (index === 0) return createReply(kind, title);
        if (index === 1) return fauxAssistantMessage("创建完成。");
        if (index === 2) {
          expect(JSON.stringify(context.messages)).toContain("前置任务交接");
          return fauxAssistantMessage(
            fauxToolCall("read", {
              kind,
              id: directoryId(context.systemPrompt, title),
              ...(kind === "draft_section" ? { document: "body" } : {})
            })
          );
        }
        expect(lastToolText(context)).toContain(CONTENT);
        return fauxAssistantMessage("读取完成。");
      });
      const result = await toolByName(runtime.tools, "spawn_subagent").execute(
        "spawn-dependent",
        {
          tasks: [
            { key: "create", subagent_id: "creator", task: "创建对象。" },
            {
              key: "read",
              subagent_id: "reader",
              task: "读取刚创建的对象。",
              depends_on: ["create"]
            }
          ]
        }
      );
      expect(resultText(result)).toContain("完成 2 个");
      expect(runtime.contexts).toHaveLength(4);
    }
  );

  it("refreshes directories between separate spawn calls in the same parent run", async () => {
    const runtime = handoffRuntime(writingInput("short"), (context, index) => {
      if (index === 0) return createReply();
      if (index === 1) return fauxAssistantMessage("创建完成。");
      if (index === 2) {
        return fauxAssistantMessage(
          fauxToolCall("read", {
            kind: "character",
            id: directoryId(context.systemPrompt, TITLE)
          })
        );
      }
      expect(lastToolText(context)).toContain(CONTENT);
      return fauxAssistantMessage("读取完成。");
    });
    const spawn = toolByName(runtime.tools, "spawn_subagent");
    await spawn.execute("first-spawn", {
      tasks: [{ subagent_id: "creator", task: "创建人物。" }]
    });
    const result = await spawn.execute("second-spawn", {
      tasks: [{ subagent_id: "reader", task: "读取人物。" }]
    });
    expect(resultText(result)).toBe("读取完成。");
    expect(runtime.contexts).toHaveLength(4);
  });

  it("recovers from a name-as-id call through the live directory", async () => {
    const runtime = handoffRuntime(writingInput("short"), (context, index) => {
      if (index === 0) return createReply();
      if (index === 1) return fauxAssistantMessage("创建完成。");
      if (index === 2) {
        return fauxAssistantMessage(
          fauxToolCall("read", { kind: "character", id: TITLE })
        );
      }
      if (index === 3) {
        expect(lastToolText(context)).toContain("kind=workspace");
        return fauxAssistantMessage(
          fauxToolCall("read", { kind: "workspace", id: "workspace" })
        );
      }
      if (index === 4) {
        return fauxAssistantMessage(
          fauxToolCall("read", {
            kind: "character",
            id: directoryId(lastToolText(context), TITLE)
          })
        );
      }
      expect(lastToolText(context)).toContain(CONTENT);
      return fauxAssistantMessage("通过目录恢复读取。");
    });
    const result = await toolByName(runtime.tools, "spawn_subagent").execute(
      "recover-name-as-id",
      {
        tasks: [
          { subagent_id: "creator", task: "创建人物。" },
          { subagent_id: "reader", task: "读取人物。" }
        ]
      }
    );
    expect(resultText(result)).toContain("完成 2 个");
    expect(runtime.contexts).toHaveLength(6);
  });
});
