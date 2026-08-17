// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
//
// Codex provider adapter: maps the trimmed ProviderAdapter contract onto the
// OpenAI Codex app-server JSON-RPC protocol. Validates the outer JSON-RPC
// envelope before translating the provider-specific payloads.
//
// Reference: https://github.com/openai/codex (codex-rs/app-server-protocol/)
//
// Trimmed relative to upstream (each with its consumer): the git-writable-
// roots hardening (the vault's .git lives INSIDE the workspace root, so
// workspace-write already covers it — bb needed it for linked worktrees whose
// git dir lives outside cwd), dynamic tools, skills configuration, fork,
// goals, archive/rename, thread compaction commands, raw-response shell
// output recovery (`experimentalRawEvents` is NOT requested), sub-agent
// delegation linking (`features.multi_agent` is forced off instead), the
// turn/input-accepted correlation (this host records the user message
// itself, so codex's userMessage echoes are dropped by the consumer), and
// service tiers. See PROVENANCE.md.

import type { ReasoningEffort as CodexReasoningEffort } from "./generated/codex-app-server/schema/ReasoningEffort.js";
import type { JsonValue } from "./generated/codex-app-server/schema/serde_json/JsonValue.js";
import type { SandboxPolicy } from "./generated/codex-app-server/schema/v2/SandboxPolicy.js";
import type { SandboxMode as CodexSandboxMode } from "./generated/codex-app-server/schema/v2/SandboxMode.js";
import type { ThreadResumeParams } from "./generated/codex-app-server/schema/v2/ThreadResumeParams.js";
import type { ThreadStartParams } from "./generated/codex-app-server/schema/v2/ThreadStartParams.js";
import type { UserInput as CodexUserInput } from "./generated/codex-app-server/schema/v2/UserInput.js";
import type { AskForApproval } from "./generated/codex-app-server/schema/v2/AskForApproval.js";
import type { ApprovalsReviewer } from "./generated/codex-app-server/schema/v2/ApprovalsReviewer.js";
import type { PermissionEscalation, ReasoningLevel } from "../domain/shared-types.js";
import { CODEX_PROVIDER_CAPABILITIES } from "../domain/provider-types.js";
import { mapBbReasoningLevelToCodex, parseModelsResponse } from "./models.js";
import { buildShellEnvironmentPolicyConfig } from "../shared/adapter-utils.js";
import type {
  AdapterCommand,
  PromptInput,
  ProviderAdapter,
  ProviderCommandPlan,
  ProviderExecutionContext,
} from "../provider-adapter.js";
import { classifySessionExecutionSettingsChange } from "../execution-options.js";
import type { ProviderInboundRequest, ProviderRuntimeEvent } from "../runtime-json-rpc.js";
import { translateCodexEvent } from "./event-translation.js";
import {
  buildCodexInteractiveResponse,
  decodeCodexInteractiveRequest,
} from "./interactive-requests.js";

interface CodexPermissionSettings {
  approvalPolicy: AskForApproval;
  approvalsReviewer: ApprovalsReviewer;
  sandbox: CodexSandboxMode;
  sandboxPolicy: SandboxPolicy;
}

interface CodexThreadPermissionSettings {
  approvalPolicy: AskForApproval;
  approvalsReviewer: ApprovalsReviewer;
  sandbox: CodexSandboxMode;
}

type CodexInstructionCommand = Extract<AdapterCommand, { type: "thread/start" | "thread/resume" }>;

interface CodexInstructionOverrides {
  baseInstructions?: string;
  developerInstructions?: string;
}

function resolveCodexInstructionOverrides(
  command: CodexInstructionCommand,
): CodexInstructionOverrides {
  const instructions = command.options.instructions?.trim();
  if (!instructions) {
    return {};
  }
  if (command.instructionMode === "replace") {
    return { baseInstructions: instructions };
  }
  return { developerInstructions: instructions };
}

function toWorkspaceWriteCodexSandboxPolicy(): SandboxPolicy {
  return {
    type: "workspaceWrite",
    writableRoots: [],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function toEscalationApprovalPolicy(escalation: PermissionEscalation): AskForApproval {
  return escalation === "deny" ? "never" : "on-request";
}

function toWorkspaceApprovalPolicy(options: {
  approvalReviewer: "automatic" | "user";
  permissionEscalation: PermissionEscalation;
}): AskForApproval {
  if (options.approvalReviewer === "automatic") {
    return "on-request";
  }
  return toEscalationApprovalPolicy(options.permissionEscalation);
}

function toCodexApprovalsReviewer(options: ProviderExecutionContext): ApprovalsReviewer {
  return options.approvalReviewer === "automatic" ? "auto_review" : "user";
}

function toCodexThreadPermissionSettings(
  options: ProviderExecutionContext,
): CodexThreadPermissionSettings {
  const permissionPolicy = options;
  switch (permissionPolicy.permissionScope) {
    case "workspace":
      return {
        approvalPolicy: toWorkspaceApprovalPolicy(permissionPolicy),
        approvalsReviewer: toCodexApprovalsReviewer(options),
        sandbox: "workspace-write",
      };
    case "full":
      return {
        approvalPolicy: "never",
        approvalsReviewer: toCodexApprovalsReviewer(options),
        sandbox: "danger-full-access",
      };
  }
}

function toCodexPermissionSettings(options: ProviderExecutionContext): CodexPermissionSettings {
  const permissionPolicy = options;
  switch (permissionPolicy.permissionScope) {
    case "workspace":
      return {
        approvalPolicy: toWorkspaceApprovalPolicy(permissionPolicy),
        approvalsReviewer: toCodexApprovalsReviewer(options),
        sandbox: "workspace-write",
        sandboxPolicy: toWorkspaceWriteCodexSandboxPolicy(),
      };
    case "full":
      return {
        approvalPolicy: "never",
        approvalsReviewer: toCodexApprovalsReviewer(options),
        sandbox: "danger-full-access",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
  }
}

function toCodexReasoningEffort(reasoningLevel: ReasoningLevel): CodexReasoningEffort {
  const codexEffort = mapBbReasoningLevelToCodex(reasoningLevel);
  if (codexEffort == null) {
    // "none" is exposed by some other providers' models; "ultracode" is
    // Claude-specific. Codex models never expose either — fail closed if
    // something slips through.
    throw new Error(`Codex does not support the ${reasoningLevel} reasoning level.`);
  }
  return codexEffort;
}

function toCodexUserInput(input: PromptInput[]): CodexUserInput[] {
  return input.map((chunk): CodexUserInput => {
    switch (chunk.type) {
      case "text":
        return { type: "text", text: chunk.text, text_elements: [] };
      case "image":
        return { type: "image", url: chunk.url };
      case "localImage":
        return { type: "localImage", path: chunk.path };
      case "localFile":
        return {
          type: "text",
          text: `[Attached file: ${chunk.path}]`,
          text_elements: [],
        };
    }
  });
}

interface BuildCodexConfigArgs {
  options?: ProviderExecutionContext;
  threadId: string;
}

function buildCodexConfig(args: BuildCodexConfigArgs): { [key in string]?: JsonValue } | undefined {
  const config: { [key in string]?: JsonValue } = {};
  if (args.threadId) {
    config["shell_environment_policy.set.INTELIGIR_THREAD_ID"] = args.threadId;
  }
  const shellEnvironmentConfig = buildShellEnvironmentPolicyConfig(args.options?.envVars);
  if (shellEnvironmentConfig) {
    Object.assign(config, shellEnvironmentConfig);
  }
  if (args.options?.reasoningLevel) {
    config["model_reasoning_effort"] = toCodexReasoningEffort(args.options.reasoningLevel);
  }
  config["features.default_mode_request_user_input"] = false;
  // Provider subagents are always off here: the trimmed grammar carries no
  // delegation linking, so a child turn would be indistinguishable from a
  // root turn.
  config["features.multi_agent"] = false;
  config["features.multi_agent_v2.max_concurrent_threads_per_session"] = 1;
  // Codex memories are provider-level state in ~/.codex; an unattended vault
  // agent silently accreting them would be surprising, so both halves stay off.
  config["memories.use_memories"] = false;
  config["memories.generate_memories"] = false;
  return Object.keys(config).length > 0 ? config : undefined;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export interface CreateCodexProviderAdapterOptions {
  /** Tests point this at a fake app-server script. */
  processCommand?: string;
  processArgs?: string[];
}

export function createCodexProviderAdapter(
  opts?: CreateCodexProviderAdapterOptions,
): ProviderAdapter {
  function buildProviderCommandPlan(command: AdapterCommand): ProviderCommandPlan {
    switch (command.type) {
      case "initialize":
        return {
          kind: "request",
          method: "initialize",
          params: {
            clientInfo: { name: "inteligir", version: "1.0.0", title: null },
            capabilities: { experimentalApi: true },
          },
        };
      case "model/list":
        return {
          kind: "request",
          method: "model/list",
          params: {},
        };
      case "thread/start": {
        const permissionSettings = toCodexThreadPermissionSettings(command.options);
        const config = buildCodexConfig({ options: command.options, threadId: command.threadId });
        const params: ThreadStartParams = {
          approvalPolicy: permissionSettings.approvalPolicy,
          approvalsReviewer: permissionSettings.approvalsReviewer,
          sandbox: permissionSettings.sandbox,
          cwd: command.cwd,
          ...resolveCodexInstructionOverrides(command),
          ...(command.options.model !== undefined ? { model: command.options.model } : {}),
          // The runtime reaps idle thread-scoped Codex processes and later
          // resumes by provider thread id, so the rollout must exist on
          // disk. Codex already defaults to non-ephemeral; pin the value so
          // a future default flip cannot silently break resume.
          ephemeral: false,
          ...(config !== undefined ? { config } : {}),
        };
        return {
          kind: "request",
          method: "thread/start",
          params,
        };
      }
      case "thread/resume": {
        const permissionSettings = toCodexThreadPermissionSettings(command.options);
        const config = buildCodexConfig({ options: command.options, threadId: command.threadId });
        const params: ThreadResumeParams = {
          threadId: command.providerThreadId,
          approvalPolicy: permissionSettings.approvalPolicy,
          approvalsReviewer: permissionSettings.approvalsReviewer,
          sandbox: permissionSettings.sandbox,
          cwd: command.cwd,
          ...resolveCodexInstructionOverrides(command),
          ...(command.options.model !== undefined ? { model: command.options.model } : {}),
          ...(config !== undefined ? { config } : {}),
        };
        return {
          kind: "request",
          method: "thread/resume",
          params,
        };
      }
      case "turn/start": {
        const permissionSettings = toCodexPermissionSettings(command.options);
        return {
          kind: "request",
          method: "turn/start",
          params: {
            threadId: command.providerThreadId,
            input: toCodexUserInput(command.input),
            approvalPolicy: permissionSettings.approvalPolicy,
            approvalsReviewer: permissionSettings.approvalsReviewer,
            sandboxPolicy: permissionSettings.sandboxPolicy,
            model: command.options.model ?? undefined,
          },
        };
      }
      case "turn/steer":
        return {
          kind: "request",
          method: "turn/steer",
          params: {
            threadId: command.providerThreadId,
            expectedTurnId: command.expectedTurnId,
            input: toCodexUserInput(command.input),
          },
        };
      case "thread/stop":
        if (command.activeTurnId === null) {
          return { kind: "noop", reason: "no active turn to interrupt" };
        }
        return {
          kind: "request",
          method: "turn/interrupt",
          params: {
            threadId: command.providerThreadId,
            turnId: command.activeTurnId,
          },
        };
    }
  }

  return {
    id: "codex",
    displayName: "Codex",
    capabilities: CODEX_PROVIDER_CAPABILITIES,
    approvalRequestPolicy: "runtime",
    classifyExecutionSettingsChange: classifySessionExecutionSettingsChange,
    // Codex app-server connections are owned by the runtime process manager;
    // live threads run on thread-scoped app-server processes, while
    // provider-only probes (model listing) use a provider-scoped one.
    process: {
      command: opts?.processCommand ?? "codex",
      args: opts?.processArgs ?? ["app-server"],
    },
    buildCommandPlan: buildProviderCommandPlan,
    translateEvent(event: ProviderRuntimeEvent) {
      return translateCodexEvent(event);
    },
    parseModelListResult(result: unknown) {
      return { models: parseModelsResponse(result) };
    },
    decodeInteractiveRequest(request: ProviderInboundRequest) {
      return decodeCodexInteractiveRequest(request);
    },
    buildInteractiveResponse(args) {
      return buildCodexInteractiveResponse(args);
    },
  };
}
