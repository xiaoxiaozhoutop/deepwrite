import { createScopedTranslator } from "../i18n";
import type { AgentToolTrace } from "../types/conversation";
import {
  parseWebFetchSummary,
  parseWebSearchSummary
} from "../utils/webSearchSummary";

const t = createScopedTranslator("components.conversationToolStatus");

export function isWebToolName(name: string): boolean {
  return name === "web_search" || name === "web_fetch";
}

/** Web search; its name must not read as a file search. */
export function isWebSearchTool(tool: Pick<AgentToolTrace, "name">): boolean {
  return tool.name === "web_search";
}

export function isWebFetchTool(tool: Pick<AgentToolTrace, "name">): boolean {
  return tool.name === "web_fetch";
}

/** The web tools whose finished result is shown as links to its sources. */
export function hasWebSources(tool: Pick<AgentToolTrace, "name">): boolean {
  return isWebSearchTool(tool) || isWebFetchTool(tool);
}

export function compactTrace(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}

/** The query while it runs, then the query with what it found. */
function webSearchDetail(tool: AgentToolTrace): string | undefined {
  const args = tool.args as Record<string, unknown> | undefined;
  const asked = typeof args?.query === "string" ? args.query : "";
  if (tool.status !== "completed" || !tool.resultSummary)
    return asked ? compactTrace(asked) : undefined;
  const found = parseWebSearchSummary(tool.resultSummary);
  const query = compactTrace(found.query || asked);
  if (found.empty) return t("webSearchNoResults", { query });
  return found.total === undefined
    ? query
    : t("webSearchResultCount", { query, count: found.total });
}

/** The address while it is read, then the page's title and site. */
function webFetchDetail(tool: AgentToolTrace): string | undefined {
  const args = tool.args as Record<string, unknown> | undefined;
  const asked = typeof args?.url === "string" ? args.url : "";
  const page =
    tool.status === "completed" && tool.resultSummary
      ? parseWebFetchSummary(tool.resultSummary)
      : undefined;
  if (!page) return asked ? compactTrace(asked) : undefined;
  const host = new URL(page.url).hostname;
  return compactTrace(page.title ? `${page.title} · ${host}` : host);
}

/** Detail line of either web tool. */
export function webToolDetail(tool: AgentToolTrace): string | undefined {
  return isWebFetchTool(tool) ? webFetchDetail(tool) : webSearchDetail(tool);
}
