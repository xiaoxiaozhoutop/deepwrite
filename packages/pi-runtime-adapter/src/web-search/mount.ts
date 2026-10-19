import type { AgentTool } from "@earendil-works/pi-agent-core";
import { buildWebFetchTool } from "./fetch-tool";
import type { WebSearchSession } from "./session";
import { WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from "./tool-names";
import { buildWebSearchTool } from "./tool";

/**
 * Whether the run's main agent has search: the user switched it on and Main
 * supplied the settings. Members may still search without it, see
 * `subagentWebSearchAllowed`.
 */
export function mainAgentHasWebSearch(input: {
  webSearch?: unknown;
  webSearchEnabled?: boolean | undefined;
}): boolean {
  return input.webSearch !== undefined && input.webSearchEnabled === true;
}

/** The session the main agent may mount, if any. */
export function mainWebSearchSession(
  session: WebSearchSession | undefined,
  input: { webSearchEnabled?: boolean | undefined }
): WebSearchSession | undefined {
  return input.webSearchEnabled === true ? session : undefined;
}

/**
 * The one place a tool list gains web access: `web_search`, and `web_fetch`
 * when the provider can read pages. Without a session (search is off or
 * unconfigured) the list is returned as is; a tool already there is kept, not
 * added twice. `session` must be passed explicitly: a default would turn "no
 * search" into the full session.
 */
export function withWebSearchTool(
  tools: AgentTool[],
  session: WebSearchSession | undefined
): AgentTool[] {
  if (!session) return tools;
  const has = (name: string): boolean =>
    tools.some((tool) => tool.name === name);
  const added = [
    ...(has(WEB_SEARCH_TOOL_NAME) ? [] : [buildWebSearchTool(session)]),
    ...(session.canFetch && !has(WEB_FETCH_TOOL_NAME)
      ? [buildWebFetchTool(session)]
      : [])
  ];
  return added.length ? [...tools, ...added] : tools;
}
