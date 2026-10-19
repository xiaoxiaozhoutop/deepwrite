import { isProvisionalExpertDraftSectionId } from "@deepwrite/contracts";
import {
  draftUnitLabel,
  orderedExpertSections,
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import { shortProposalSummary } from "./unified-proposal";
import type { ShortUnifiedTarget } from "./unified-target";

interface EditMeta {
  title?: string;
  description?: string;
  move?: "up" | "down";
}

function characterMetaProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  meta: EditMeta,
  rawSummary: string
) {
  if (meta.description !== undefined) {
    throw new Error("character 的 meta 不接受 description。");
  }
  if (
    Number(meta.title !== undefined) + Number(meta.move !== undefined) !==
    1
  ) {
    throw new Error("人物 meta 必须且只能选择 title 或 move。");
  }
  const item = state.characterItems.get(target.itemId!);
  if (!item) throw new Error(`不存在人物条目 ${target.id}。`);
  const summary = rawSummary.trim();
  if (meta.title !== undefined) {
    const title = meta.title.trim();
    if (!title) throw new Error("人物标题不能为空。");
    if (
      [...state.characterItems.values()].some(
        (candidate) =>
          candidate.id !== item.id &&
          candidate.title.toLocaleLowerCase() === title.toLocaleLowerCase()
      )
    ) {
      throw new Error("已存在同名人物条目。");
    }
    const previousTitle = item.title;
    state.characterItems.set(item.id, { ...item, title });
    return textResult(shortProposalSummary(input, summary), {
      kind: "workspace-character-structure-mutation",
      workspaceId: input.workspace.id,
      stageId: "character_design",
      mutation: { type: "updateItem", itemId: item.id, previousTitle, title },
      baseRevision: state.stageRevisions.get("character_design")!,
      summary
    });
  }
  const direction = meta.move!;
  const index = state.characterItemOrder.indexOf(item.id);
  const destination = direction === "up" ? index - 1 : index + 1;
  if (destination < 0 || destination >= state.characterItemOrder.length) {
    throw new Error("人物条目已经位于列表边界。");
  }
  [state.characterItemOrder[index], state.characterItemOrder[destination]] = [
    state.characterItemOrder[destination]!,
    state.characterItemOrder[index]!
  ];
  return textResult(shortProposalSummary(input, summary), {
    kind: "workspace-character-structure-mutation",
    workspaceId: input.workspace.id,
    stageId: "character_design",
    mutation: {
      type: "moveItem",
      itemId: item.id,
      direction,
      title: item.title
    },
    baseRevision: state.stageRevisions.get("character_design")!,
    summary
  });
}

function plotStageMetaProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  meta: EditMeta,
  rawSummary: string
) {
  if (meta.move !== undefined) {
    throw new Error("剧情结构排序由界面管理，plot_stage 的 meta 不接受 move。");
  }
  const stage = state.plotStages.get(target.id);
  if (!stage) throw new Error(`不存在剧情结构 ${target.id}。`);
  if (stage.provisional) {
    throw new Error(
      "待创建剧情结构不能在同一轮改名，请在 create 时直接使用目标信息。"
    );
  }
  const title = meta.title?.trim() ?? stage.title;
  const description = meta.description?.trim() ?? stage.description;
  if (!title) throw new Error("剧情结构标题不能为空。");
  if (!description) throw new Error("剧情结构说明不能为空。");
  if (
    [...state.plotStages.values()].some(
      (candidate) =>
        candidate.id !== stage.id &&
        candidate.title.toLocaleLowerCase() === title.toLocaleLowerCase()
    )
  ) {
    throw new Error("已存在同名剧情结构。");
  }
  state.plotStages.set(stage.id, { ...stage, title, description });
  const summary = rawSummary.trim();
  return textResult(shortProposalSummary(input, summary), {
    kind: "workspace-plot-structure-mutation",
    workspaceId: input.workspace.id,
    stageId: target.stageId,
    mutation: {
      type: "update",
      stageId: target.stageId,
      previousTitle: stage.title,
      title,
      description
    },
    baseRevision: target.revision,
    summary
  });
}

function draftMetaProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  meta: EditMeta,
  rawSummary: string
) {
  if (meta.move || meta.description !== undefined) {
    throw new Error(
      `${draftUnitLabel(input)} meta 只支持 title；排序由界面管理。`
    );
  }
  const section = state.expertSections.get(target.sectionId!);
  if (!section) {
    throw new Error(`不存在${draftUnitLabel(input)} ${target.id}。`);
  }
  if (isProvisionalExpertDraftSectionId(section.id)) {
    throw new Error(
      `待创建${draftUnitLabel(input)}不能在同一轮改名，请创建时直接使用目标标题。`
    );
  }
  const title = meta.title?.trim() ?? "";
  if (!title) throw new Error(`${draftUnitLabel(input)}标题不能为空。`);
  if (
    orderedExpertSections(input, state.expertSections).some(
      (candidate) => candidate.id !== section.id && candidate.title === title
    )
  ) {
    throw new Error(`正文目录已存在同名${draftUnitLabel(input)}。`);
  }
  const previousTitle = section.title;
  state.expertSections.set(section.id, {
    ...section,
    title,
    body: { ...section.body, title },
    characterState: { ...section.characterState, title: `${title} · 人物状态` }
  });
  const summary = rawSummary.trim();
  return textResult(shortProposalSummary(input, summary), {
    kind: "workspace-expert-draft-section-rename",
    workspaceId: input.workspace.id,
    stageId: "draft",
    sectionId: section.id,
    previousTitle,
    title,
    baseRevision: state.expertDraftDirectoryBaseRevision,
    summary
  });
}

export function formShortMetaProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  meta: EditMeta,
  summary: string
) {
  if (target.kind === "character_overview") {
    throw new Error("人物概览不支持 meta 修改。");
  }
  if (target.kind === "character") {
    return characterMetaProposal(input, state, target, meta, summary);
  }
  if (target.kind === "plot_stage") {
    return plotStageMetaProposal(input, state, target, meta, summary);
  }
  return draftMetaProposal(input, state, target, meta, summary);
}
