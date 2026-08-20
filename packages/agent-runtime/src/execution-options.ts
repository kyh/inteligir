// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed to the codex classifier and the execution-context builder; the
// claude-code normalizers and service-tier assertions are not carried.

import type { RuntimePermissionPolicy } from "./vocabulary/shared-types.js";
import type { ProviderAdapter, ProviderExecutionContext } from "./provider-adapter.js";
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

export function assertProviderSupportsExecutionOptions(
  args: AssertProviderSupportsExecutionOptionsArgs,
): void {
  if (!args.adapter.capabilities.supportedPermissionModes.includes(args.options.permissionMode)) {
    throw new Error(
      `Provider "${args.providerId}" does not support permission mode "${args.options.permissionMode}".`,
    );
  }
}

export function toProviderExecutionContext(
  args: ToProviderExecutionContextArgs,
): ProviderExecutionContext {
  const permissionPolicy: RuntimePermissionPolicy = args.execOpts;
  const context: ProviderExecutionContext = { ...permissionPolicy, envVars: args.envVars };
  if (args.execOpts.model !== undefined) context.model = args.execOpts.model;
  if (args.execOpts.reasoningLevel !== undefined) {
    context.reasoningLevel = args.execOpts.reasoningLevel;
  }
  if (args.instructions !== undefined) context.instructions = args.instructions;
  return context;
}
