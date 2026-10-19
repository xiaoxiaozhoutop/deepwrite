import {
  resolveWritingEditSummary,
  WRITING_EDIT_SUMMARY_DESCRIPTION
} from "../writing-edit-summary";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  WRITING_DRAFT_SECTION_RENAME_GUIDANCE,
  WRITING_EDIT_CONTENT_DESCRIPTION,
  WRITING_EDIT_CONTENT_GUIDANCE,
  WRITING_EDIT_OVERWRITE_DESCRIPTION,
  WRITING_EDIT_OVERWRITE_RECOVERY
} from "../writing-edit-guidance";
import { WRITING_CONTENT_COUNT_DESCRIPTION } from "../writing-content-counts";
import { defineTool } from "./schema";
import {
  replaceText,
  scriptBodyToolConstraint,
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import {
  explicitTrueParameter,
  stableWritingIdParameter,
  writingContentParameter,
  writingDocumentParameter,
  writingEditKindParameter,
  writingEditMetaParameter
} from "./tool-parameters";
import { formShortMetaProposal } from "./unified-edit-meta";
import { formShortContentProposal } from "./unified-proposal";
import {
  hasCurrentReadEvidence,
  type ShortUnifiedReadState
} from "./unified-read-tool";
import {
  assertWritableTarget,
  resolveShortUnifiedTarget,
  resolveWritingEditKind
} from "./unified-target";
import {
  confirmCrossStageMutation,
  crossStageMutationPolicyText,
  crossStageMutationCancelled
} from "./user-input";

export function buildShortUnifiedEditTool(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState
): AgentTool {
  return defineTool({
    name: "edit",
    label: `修改${input.workspaceType === "script" ? "剧本" : "短篇"}对象`,
    description:
      `修改一个已有对象。${WRITING_DRAFT_SECTION_RENAME_GUIDANCE}建议显式提供 kind；提供稳定小节 id 和 document，或提供已知小节 id 和 meta.title 时可省略 kind，按 draft_section 定位。${WRITING_EDIT_CONTENT_GUIDANCE}kind=draft_section 修改正文或人物状态时必须同时给出 document=body 或 character_state。meta 用于人物改名/移动、剧情结构标题与说明修改、正文小节改名。content、replacements、meta 只能选择一种。${crossStageMutationPolicyText(input)}` +
      scriptBodyToolConstraint(input) +
      WRITING_CONTENT_COUNT_DESCRIPTION,
    parameters: Type.Object(
      {
        kind: Type.Optional(writingEditKindParameter),
        id: stableWritingIdParameter,
        document: Type.Optional(writingDocumentParameter),
        content: Type.Optional(
          Type.Unsafe<string>({
            ...writingContentParameter,
            description: WRITING_EDIT_CONTENT_DESCRIPTION
          })
        ),
        replacements: Type.Optional(
          Type.Array(
            Type.Object(
              {
                original_text: Type.String({
                  minLength: 1,
                  maxLength: 200_000
                }),
                new_text: Type.String({ maxLength: 200_000 })
              },
              { additionalProperties: false }
            ),
            { minItems: 1, maxItems: 100 }
          )
        ),
        meta: Type.Optional(writingEditMetaParameter),
        allow_overwrite_existing: Type.Optional(
          Type.Unsafe<boolean>({
            ...explicitTrueParameter,
            description: WRITING_EDIT_OVERWRITE_DESCRIPTION
          })
        ),
        summary: Type.Optional(
          Type.String({
            maxLength: 1_000,
            description: WRITING_EDIT_SUMMARY_DESCRIPTION
          })
        )
      },
      { additionalProperties: false }
    ),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const kind = resolveWritingEditKind(state, params);
      if (kind === "draft_section" && !params.document && !params.meta) {
        throw new Error(
          "修改 draft_section 正文时必须指定 document=body 或 character_state。"
        );
      }
      const target = resolveShortUnifiedTarget(input, state, {
        kind,
        id: String(params.id),
        ...(params.document ? { document: params.document } : {})
      });
      assertWritableTarget(input, target);
      const decision = await confirmCrossStageMutation(input, {
        toolCallId,
        targetStageId: target.stageId,
        targetTitle: target.title,
        operationLabel: "修改",
        ...(signal ? { signal } : {})
      });
      if (decision === "cancel") {
        return crossStageMutationCancelled(input, target.stageId);
      }

      const intentCount =
        Number(params.content !== undefined) +
        Number(Boolean(params.replacements?.length)) +
        Number(params.meta !== undefined);
      if (intentCount !== 1) {
        throw new Error("edit 必须且只能选择 content、replacements 或 meta。");
      }
      const summary = resolveWritingEditSummary(
        params.summary,
        target.title,
        params
      );
      if (params.meta) {
        return formShortMetaProposal(
          input,
          state,
          target,
          params.meta,
          summary
        );
      }

      if (target.content.trim() && !hasCurrentReadEvidence(readState, target)) {
        return textResult(`未修改：请先用 read 完整读取「${target.title}」。`);
      }
      if (params.content !== undefined) {
        if (target.content.trim() && params.allow_overwrite_existing !== true) {
          return textResult(WRITING_EDIT_OVERWRITE_RECOVERY);
        }
        return formShortContentProposal(
          input,
          state,
          readState,
          target,
          String(params.content),
          summary
        );
      }

      const replaced = replaceText(target.content, params.replacements!);
      if (replaced.error || replaced.next === undefined) {
        return textResult(`未修改：${replaced.error ?? "未知错误"}`);
      }
      return formShortContentProposal(
        input,
        state,
        readState,
        target,
        replaced.next,
        summary
      );
    }
  });
}
