// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed to the codex classifier and the execution-context builder; the
// claude-code normalizers and service-tier assertions are not carried.

import type { RuntimePermissionPolicy } from "./vocabulary/shared-types.js";
import type {
  ClassifyProviderExecutionSettingsChangeArgs,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderExecutionSettingsChange,
} from "./provider-adapter.js";
import type { AgentRuntimeExecutionOptions } from "./types.js";

interface AssertProviderSupportsExecutionOptionsArgs {
  adapter: ProviderAdapter;
  options: AgentRuntimeExecutionOptions;
  providerId: string;
}

interface ToProviderExecutionContextArgs {
  envVars: Record<string, string>;
  execOpts: AgentRuntimeExecutionOptions;
  instructions: string | undefined;
}

interface SameExecutionSettingsArgs {
  left: AgentRuntimeExecutionOptions;
  right: AgentRuntimeExecutionOptions;
}

export function assertProviderSupportsExecutionOptions(
  args: AssertProviderSupportsExecutionOptionsArgs,
): void {
  if (!args.adapter.capabilities.supportedPermissionModes.includes(args.options.permissionMode)) {
    throw new Error(
      `Provider "${args.providerId}" does not support permission mode "${args.options.permissionMode}".`,
    );
  }
}

function sameExecutionSettings(args: SameExecutionSettingsArgs): boolean {
  return (
    args.left.model === args.right.model &&
    args.left.reasoningLevel === args.right.reasoningLevel &&
    args.left.permissionMode === args.right.permissionMode &&
    args.left.permissionScope === args.right.permissionScope &&
    args.left.approvalReviewer === args.right.approvalReviewer &&
    args.left.permissionEscalation === args.right.permissionEscalation
  );
}

export function classifySessionExecutionSettingsChange(
  args: ClassifyProviderExecutionSettingsChangeArgs,
): ProviderExecutionSettingsChange {
  return sameExecutionSettings({ left: args.current, right: args.next }) ? "unchanged" : "session";
}

export function toProviderExecutionContext(
  args: ToProviderExecutionContextArgs,
): ProviderExecutionContext {
  const permissionPolicy: RuntimePermissionPolicy = args.execOpts;
  return {
    ...permissionPolicy,
    ...(args.execOpts.model !== undefined ? { model: args.execOpts.model } : {}),
    ...(args.execOpts.reasoningLevel !== undefined
      ? { reasoningLevel: args.execOpts.reasoningLevel }
      : {}),
    ...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
    envVars: args.envVars,
  };
}
