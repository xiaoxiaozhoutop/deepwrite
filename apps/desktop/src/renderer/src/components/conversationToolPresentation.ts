import { createScopedTranslator } from "../i18n";
import { remoteEditProposals } from "./conversationRemoteCards";
import type {
  AgentEditProposal,
  AgentToolTrace,
  ChatMessage
} from "../types/conversation";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import { agentProposalSupportsDiscard } from "../utils/acceptedEditDiscard";

import { isWriteTool } from "./conversationToolStatus";
import {
  processingItems,
  type ProcessingItem
} from "./conversationProcessingItems";
import {
  foldWorkGroups,
  type WorkGroupDisplayItem
} from "./conversationWorkGroups";

const t = createScopedTranslator("components.conversationToolPresentation");
export {
  processingItems,
  type ProcessingItem
} from "./conversationProcessingItems";
export {
  foldWorkGroups,
  type WorkGroupDisplayItem,
  type WorkGroupMemberItem
} from "./conversationWorkGroups";
export {
  subagentPhaseLabel,
  toolActivityLabel,
  workGroupActivityLabel
} from "./conversationActivityLabel";
export {
  hasWebSources,
  isWebFetchTool,
  isWebSearchTool
} from "./conversationWebTools";
export {
  workspaceToolLabel,
  isWriteTool,
  writeToolAction,
  writeActionLabel,
  toolKind,
  toolIcon,
  toolLabel,
  toolGroupIsRunning,
  toolGroupLabel,
  toolDetail,
  writeToolContentLabel,
  writeToolTarget,
  visibleToolArguments,
  formatToolPayload
} from "./conversationToolStatus";

export function hasProcessing(message: ChatMessage): boolean {
  return processingItems(message).length > 0;
}

export function hasProcessingDisclosure(message: ChatMessage): boolean {
  return hasProcessing(message) || Boolean(message.subagentRuns?.length);
}

export type ApprovalCardItem =
  | {
      id: string;
      type: "edit-proposal";
      createdAt: string;
      toolCallIds: string[];
      canDiscard: boolean;
      proposal: AgentEditProposal;
      /** Made and reviewed on this other device; shown read-only. */
      remoteDevice?: string;
    }
  | {
      id: string;
      type: "long-proposal";
      createdAt: string;
      toolCallIds: string[];
      item: LongWorkspaceProposalItem;
    };

export type ProcessingDisplayItem =
  | Exclude<ProcessingItem, { type: "tool" }>
  | { id: string; type: "tool"; tool: AgentToolTrace }
  | { id: string; type: "tool-group"; tools: AgentToolTrace[] }
  | ApprovalCardItem
  | WorkGroupDisplayItem;

function compareApprovalCards(
  left: ApprovalCardItem,
  right: ApprovalCardItem
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

export function longProposalItemsForMessage(
  message: ChatMessage,
  longProposalItems: readonly LongWorkspaceProposalItem[]
): LongWorkspaceProposalItem[] {
  if (!message.runId) return [];
  return longProposalItems.filter(
    (item) => item.event.payload.runId === message.runId
  );
}

export function approvalItemsForMessage(
  message: ChatMessage,
  longProposalItems: readonly LongWorkspaceProposalItem[]
): ApprovalCardItem[] {
  const editItems: ApprovalCardItem[] = (message.editProposals ?? []).map(
    (proposal) => ({
      id: `edit:${proposal.id}`,
      type: "edit-proposal",
      createdAt: proposal.createdAt,
      toolCallIds: proposal.toolCallIds,
      canDiscard: agentProposalSupportsDiscard(proposal),
      proposal
    })
  );
  const longItems: ApprovalCardItem[] = longProposalItemsForMessage(
    message,
    longProposalItems
  ).map((item) => ({
    id: `long:${item.event.id}`,
    type: "long-proposal",
    createdAt: item.event.timestamp,
    toolCallIds: [item.event.payload.toolCallId],
    item
  }));
  const remoteItems: ApprovalCardItem[] = remoteEditProposals(message).map(
    (proposal) => ({
      id: `remote:${proposal.id}`,
      type: "edit-proposal",
      createdAt: proposal.createdAt,
      toolCallIds: [],
      canDiscard: false,
      proposal,
      remoteDevice: message.remote!.device
    })
  );
  return [...editItems, ...longItems, ...remoteItems].sort(
    compareApprovalCards
  );
}

export function liveTimelineItems(
  message: ChatMessage,
  longProposalItems: readonly LongWorkspaceProposalItem[]
): Array<ProcessingItem | ApprovalCardItem> {
  const processing = processingItems(message);
  const positioned: Array<{
    position: number;
    sequence: number;
    item: ProcessingItem | ApprovalCardItem;
  }> = processing.map((item, index) => ({
    position: index * 2,
    sequence: index,
    item
  }));

  for (const [approvalIndex, approval] of approvalItemsForMessage(
    message,
    longProposalItems
  ).entries()) {
    let anchorIndex = -1;
    for (const [index, item] of processing.entries()) {
      if (
        (item.type === "tool" && approval.toolCallIds.includes(item.tool.id)) ||
        (item.type === "subagent" &&
          approval.toolCallIds.includes(item.toolCallId))
      ) {
        anchorIndex = index;
      }
    }
    if (anchorIndex >= 0) {
      positioned.push({
        position: anchorIndex * 2 + 1,
        sequence: processing.length + approvalIndex,
        item: approval
      });
      continue;
    }
    const laterIndex = processing.findIndex(
      (item) => item.createdAt.localeCompare(approval.createdAt) > 0
    );
    positioned.push({
      position: laterIndex < 0 ? processing.length * 2 + 1 : laterIndex * 2 - 1,
      sequence: processing.length + approvalIndex,
      item: approval
    });
  }

  return positioned
    .sort((left, right) => {
      if (left.position !== right.position)
        return left.position - right.position;
      const leftApproval =
        left.item.type === "edit-proposal" ||
        left.item.type === "long-proposal";
      const rightApproval =
        right.item.type === "edit-proposal" ||
        right.item.type === "long-proposal";
      if (leftApproval && rightApproval) {
        return compareApprovalCards(
          left.item as ApprovalCardItem,
          right.item as ApprovalCardItem
        );
      }
      return left.sequence - right.sequence;
    })
    .map(({ item }) => item);
}

export function processingDisplayItems(
  message: ChatMessage,
  includeApprovalCards = false,
  longProposalItems: readonly LongWorkspaceProposalItem[] = []
): ProcessingDisplayItem[] {
  const displayItems: Array<
    Exclude<ProcessingDisplayItem, { type: "work-group" }>
  > = [];
  const timelineItems = includeApprovalCards
    ? liveTimelineItems(message, longProposalItems)
    : processingItems(message);
  for (const item of timelineItems) {
    if (item.type === "edit-proposal" || item.type === "long-proposal") {
      displayItems.push(item);
      continue;
    }
    if (item.type !== "tool" || isWriteTool(item.tool)) {
      displayItems.push(item);
      continue;
    }
    const previous = displayItems.at(-1);
    if (previous?.type === "tool-group") {
      previous.tools.push(item.tool);
      continue;
    }
    displayItems.push({
      id: `${item.id}_group`,
      type: "tool-group",
      tools: [item.tool]
    });
  }
  return foldWorkGroups(displayItems, message.status === "streaming");
}

function hasResponseSteps(message: ChatMessage): boolean {
  return (
    message.processingSteps?.some((step) => step.type === "response") ?? false
  );
}

export function visibleResponse(message: ChatMessage): string {
  if (message.status === "streaming" && hasResponseSteps(message)) return "";
  return message.content;
}

function retryProgress(
  message: ChatMessage
): { current: number; total: number } | undefined {
  if (!message.retry) return undefined;
  return {
    current: Math.max(1, message.retry.attempt - 1),
    total: Math.max(1, message.retry.maxAttempts - 1)
  };
}

export function retryStatusLabel(
  message: ChatMessage,
  now: number
): string | undefined {
  const retry = message.retry;
  const progress = retryProgress(message);
  if (!retry || !progress) return undefined;
  const suffix = t("attemptValueValue", {
    arg0: progress.current,
    arg1: progress.total
  });
  if (retry.state === "trying")
    return t("retryingValue", {
      arg0: suffix
    });
  const retryAt = retry.retryAt ? Date.parse(retry.retryAt) : Number.NaN;
  const remainingSeconds = Number.isFinite(retryAt)
    ? Math.max(0, Math.ceil((retryAt - now) / 1_000))
    : Math.max(0, Math.ceil((retry.delayMs ?? 0) / 1_000));
  return t("connectionInterruptedRetryingValueInValueS", {
    arg0: remainingSeconds,
    arg1: suffix
  });
}

export function hasFirstModelOutput(message: ChatMessage): boolean {
  if (message.content || message.thinking) return true;
  if (message.toolCalls?.length || message.subagentRuns?.length) return true;
  return (
    message.processingSteps?.some(
      (step) =>
        step.type === "tool" ||
        ((step.type === "thinking" || step.type === "response") &&
          step.content.length > 0)
    ) ?? false
  );
}

export const MODEL_QUEUE_LABEL_DELAY_MS = 10_000;

export function processingLabel(message: ChatMessage, now: number): string {
  const retryLabel = retryStatusLabel(message, now);
  if (retryLabel) return retryLabel;
  const start = Date.parse(message.processingStartedAt ?? message.createdAt);
  const end = message.processingCompletedAt
    ? Date.parse(message.processingCompletedAt)
    : message.status === "streaming"
      ? now
      : start + 1_000;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return t("processed");
  }
  const seconds = Math.max(1, Math.ceil((end - start) / 1_000));
  if (
    message.status === "streaming" &&
    end - start >= MODEL_QUEUE_LABEL_DELAY_MS &&
    !hasFirstModelOutput(message)
  ) {
    return t("modelQueuedWaitedValueS", { arg0: seconds });
  }
  if (seconds < 60) {
    return t("processedForValueSeconds", { arg0: seconds });
  }
  return t("processedForValueMinutesValueSeconds", {
    arg0: Math.floor(seconds / 60),
    arg1: seconds % 60
  });
}
