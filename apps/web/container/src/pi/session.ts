// ---------------------------------------------------------------------------
// The agent session: one pi session per boot, one turn at a time.
//
// This is the desktop's `packages/agent/src/pi/agent.ts` with almost everything
// taken away, and the differences are all consequences of where it runs:
//
//   • THE SESSION IS IN MEMORY. The container's filesystem is deleted when it
//     sleeps, so a session file would be a resumable thread that never survives
//     to be resumed. The transcript of record lives in the Durable Object; this
//     session is a projection of it, rebuilt on every wake.
//   • THE SESSION IS SEEDED, NOT RESTORED. A fresh session knows nothing, so
//     the first turn after a wake carries the prior conversation as a block of
//     context ahead of the user's message. Once a session has run a turn it is
//     seeded, and the object stops sending the seed — replaying it would be the
//     user saying everything twice.
//   • NO EXTENSIONS, NO SKILLS, NO DISCOVERED CONTEXT FILES. Everything the
//     model is told comes from the boot payload, which the Worker composed. A
//     file discovered on this filesystem would be a system prompt nobody wrote.
//   • THE TOOL SET IS A HARD ALLOWLIST: pi's four file/shell built-ins plus
//     exactly the tools the boot declared. Not a default that extensions add
//     to — a container image that could widen its own tool surface would be a
//     second grant table.
//
// Events are forwarded RAW. The object parses them with the same parser the
// desktop host uses (`@repo/bridge/agent-event-parser`), which is the one place
// that mapping should live, so translating here would be a second copy of it.
// ---------------------------------------------------------------------------

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { mkdir } from "node:fs/promises";

import { CONTAINER_WORKSPACE_DIR, type ContainerBoot, type ContainerTurn } from "../protocol";
import type { ContainerTool } from "../tools";
import { createProviderRuntime } from "./provider";

/**
 * Where pi keeps its own state — settings, the placeholder auth file, its
 * model config. Outside `/workspace` on purpose: the agent's file tools are
 * pointed at the workspace, and pi's own files sitting beside `./vault` would
 * be things the model lists, reads and reasons about as if they were the
 * user's.
 */
const AGENT_DIR = "/agent";

/** pi's built-in coding tools, named explicitly rather than left to pi's
 * default so the raw system-access surface is a decision this file makes. */
const BUILTIN_TOOLS = ["read", "bash", "edit", "write"];

export type ContainerSessionDeps = {
  readonly boot: ContainerBoot;
  /** Tools the model may call: the boot's relays plus anything the image
   * implements locally. */
  readonly tools: readonly ContainerTool[];
  /** Every pi session event, unmodified. */
  readonly onEvent: (event: { type: string }) => void;
};

export type ContainerSession = {
  /** Run one turn and resolve when the agent loop has ended. Rejects with
   * whatever pi refused on — a missing model, a provider error, an abort. */
  run(turn: ContainerTurn): Promise<void>;
  /** Fold a message into the turn already in flight. Resolves as soon as it is
   * queued; the running turn still owns the loop. */
  queue(kind: "steer" | "follow_up", turn: ContainerTurn): Promise<void>;
  /**
   * Fold a message from the DAEMON — not from the person — into the running
   * turn. The vault's refusals arrive this way: the agent's own file tools
   * already answered "written", and only the object knows they did not land,
   * so the correction has to reach the model while the turn can still act on
   * it. Steered rather than queued as a follow-up for the same reason.
   */
  notify(text: string): Promise<void>;
  /** Whether this session has taken a prompt. Read after a turn — including a
   * failed one — to decide whether the prior conversation still has to be
   * replayed into it. */
  isSeeded(): boolean;
  abort(): Promise<void>;
  dispose(): void;
};

export async function createContainerSession(
  deps: ContainerSessionDeps,
): Promise<ContainerSession> {
  await mkdir(AGENT_DIR, { recursive: true });
  const { runtime, model } = await createProviderRuntime(deps.boot, AGENT_DIR);

  const instructions = deps.boot.instructions;
  const resourceLoader = new DefaultResourceLoader({
    cwd: CONTAINER_WORKSPACE_DIR,
    agentDir: AGENT_DIR,
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    agentsFilesOverride: () => ({
      agentsFiles: instructions === "" ? [] : [{ path: "AGENTS.md", content: instructions }],
    }),
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: CONTAINER_WORKSPACE_DIR,
    agentDir: AGENT_DIR,
    modelRuntime: runtime,
    resourceLoader,
    model,
    thinkingLevel: "off",
    sessionManager: SessionManager.inMemory(CONTAINER_WORKSPACE_DIR),
    settingsManager: SettingsManager.create(CONTAINER_WORKSPACE_DIR, AGENT_DIR),
    customTools: deps.tools.map(toToolDefinition),
    // `tools` is pi's hard allowlist and its initial active set at once: only
    // these names exist, and all of them start active.
    tools: [...BUILTIN_TOOLS, ...deps.tools.map((tool) => tool.name)],
  });

  const unsubscribe = session.subscribe(deps.onEvent);
  let seeded = false;

  return {
    async run(turn) {
      const prefix = seeded || turn.seed.length === 0 ? "" : `${renderSeed(turn.seed)}\n\n`;
      const images = toImages(turn.images);
      await session.prompt(`${prefix}${turn.text}`, {
        // A chat message is a message. With expansion on, a message that opens
        // with "/" is read as a pi slash command and never reaches the model.
        expandPromptTemplates: false,
        // Preflight acceptance — not the prompt resolving — is the moment the
        // message entered the conversation, and therefore the moment the seed
        // that rode in with it did too. A turn that fails afterwards must not
        // ask for the transcript again.
        preflightResult: (accepted) => {
          seeded ||= accepted;
        },
        ...(images.length === 0 ? {} : { images }),
      });
    },

    async queue(kind, turn) {
      const images = toImages(turn.images);
      const attachments = images.length === 0 ? undefined : images;
      await (kind === "steer"
        ? session.steer(turn.text, attachments)
        : session.followUp(turn.text, attachments));
    },

    notify: (text) => session.steer(text),

    isSeeded: () => seeded,

    abort: () => session.abort(),

    dispose() {
      unsubscribe();
      session.dispose();
    },
  };
}

/** Adapt one image-level tool into pi's registry.
 *
 * pi signals a failed tool by REJECTING, so a relayed `isError` becomes a throw
 * here — that is what puts `isError: true` on the `tool_execution_end` event
 * the object folds into the transcript. */
function toToolDefinition(tool: ContainerTool): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (_toolCallId, params, signal) => {
      const result = await tool.execute(params, signal);
      if (result.isError) throw new Error(result.text);
      const image = result.image;
      const content: AgentToolResult<unknown>["content"] =
        image === undefined
          ? [{ type: "text", text: result.text }]
          : [
              { type: "text", text: result.text },
              { type: "image", data: image.data, mimeType: image.mimeType },
            ];
      return { content, details: {} };
    },
  };
}

/**
 * The prior conversation, as a block of context ahead of the new message.
 *
 * pi has no "load these messages into a fresh session" seam that keeps their
 * roles: its injection points are custom messages, which arrive as a custom
 * role rather than as the user and assistant turns they were. Folding the
 * transcript into the first prompt is the honest alternative — the model sees
 * exactly what happened, labelled as history rather than as instruction, and
 * nothing pretends to be a message it is not.
 */
function renderSeed(seed: ContainerTurn["seed"]): string {
  const lines = seed.map((entry) => `${entry.role}: ${entry.text}`);
  return [
    "<prior_conversation>",
    "Earlier turns of this same conversation, oldest first. This is context, not a new instruction.",
    "",
    ...lines,
    "</prior_conversation>",
  ].join("\n");
}

function toImages(images: ContainerTurn["images"]): ImageContent[] {
  return images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
}
