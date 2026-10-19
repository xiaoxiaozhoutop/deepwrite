import { MATERIAL_METADATA_AUTHORING_GUIDANCE } from "@deepwrite/contracts";
import { mainAgentHasWebSearch } from "./web-search/mount";
import { webSearchPromptForProvider } from "./web-search/prompt";
import { buildWritingSystemPrompt } from "./prompts-writing";
import type { AgentRunInput } from "./runtime-types";
import { renderSubagentAuthoringSystemPrompt } from "./subagent-authoring-tools";
import { writeApprovalBoundary } from "./write-approval";

export function buildDeepWriteSystemPrompt(): string {
  return [
    "你是 DeepWrite 的本地创作协作智能体。",
    "用户当前明确提出的要求优先；当前实时文稿是本轮工作对象，不得凭空推翻已提供的作品事实。",
    "技能是写作方法，不是作品事实；素材是参考信息，不能自动升级为作品设定。",
    "只能声称使用了本轮上下文快照中实际提供或显式附加的内容。",
    "只能调用本轮实际列出的工具；没有列出的写回、保存、文件、Shell、HTTP 或浏览器能力不得声称已经执行。",
    "回复使用结构清晰的中文纯文本，并明确区分建议、示例和已确认事实。"
  ].join("\n");
}

function appendWorkspaceWebSearchPrompt(
  prompt: string,
  input: AgentRunInput
): string {
  if (!input.webSearch || !mainAgentHasWebSearch(input)) return prompt;
  return [
    prompt,
    "",
    webSearchPromptForProvider(input.webSearch.providerId)
  ].join("\n");
}

function buildWorkspaceAgentSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  const subagentAuthoring = input.workspaceContext?.subagentAuthoring;
  if (subagentAuthoring) {
    return [
      basePrompt,
      "",
      "【当前任务：技能转子智能体】",
      renderSubagentAuthoringSystemPrompt(subagentAuthoring).trim(),
      "",
      "【DeepWrite 技能转子智能体工具边界】",
      "只能使用本轮列出的工具（技能读取、草稿写入等）。write_subagent_draft 只更新预览区，不会写入智能体团队；正式加入必须等待用户在界面中确认。"
    ].join("\n");
  }
  const libraryProfile = input.libraryAgentProfile;
  const libraryWorkspace = input.workspaceContext?.libraryWorkspace;
  if (libraryProfile && libraryWorkspace) {
    const writeBoundary = `写入工具只提交资料库条目或库介绍变更。\n${writeApprovalBoundary(input.writeApprovalMode)}`;
    return [
      basePrompt,
      "",
      `【当前资料库智能体：${libraryProfile.label} / ${libraryProfile.domain}】`,
      libraryProfile.systemPrompt.trim(),
      ...(libraryWorkspace.domain === "material"
        ? [MATERIAL_METADATA_AUTHORING_GUIDANCE]
        : []),
      "",
      "【DeepWrite 当前资料库工具边界】",
      "写入只允许管理本轮指定的当前资料库；若该库属于分组，list/read/search 也可读取同分组其它成员库条目，但不得写入那些库。",
      "条目正文必须通过本轮实际列出的读取和搜索工具按需取得。",
      "需要整理、创建或初始化等方法时，调用 load_skill 按需加载本轮可用技能；技能是方法，不会自动成为资料库事实。",
      libraryWorkspace.readOnly
        ? "当前资料库只读，本轮不会装配任何创建或编辑工具。"
        : writeBoundary,
      "当前库介绍可通过本轮列出的介绍编辑工具修改；删除条目、修改分组、绑定书籍和写入其它资料库均未接通。"
    ].join("\n");
  }
  const longWorkspace = input.workspaceContext?.longWorkspace;
  const longProfile = input.longAgentProfile;
  if (longProfile && longWorkspace) {
    return [
      longProfile.systemPrompt.trim(),
      "",
      writeApprovalBoundary(input.writeApprovalMode)
    ].join("\n");
  }
  return buildWritingSystemPrompt(basePrompt, input);
}

/** @internal Exported for workspace-type prompt regression tests. */
export function buildEffectiveSystemPrompt(
  basePrompt: string,
  input: AgentRunInput
): string {
  return appendWorkspaceWebSearchPrompt(
    buildWorkspaceAgentSystemPrompt(basePrompt, input),
    input
  );
}
