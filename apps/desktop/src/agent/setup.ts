// Inteligir-specific composition over @repo/pi-driver and @repo/agent-runtime.

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { Type, type Static } from "@sinclair/typebox";
import {
  createAuthStorage,
  hasAuth,
  loginWithProvider,
  PiAgent,
  resolveModel,
  SessionManager,
  type ExtensionAPI,
  type ExtensionFactory,
} from "@repo/pi-driver";
import {
  installAgentBrowser as installAgentBrowserBootstrap,
  installGws as installGwsBootstrap,
  installPeekaboo as installPeekabooBootstrap,
  prependPath,
  seedDirectory,
  seedFile,
  seedGwsClientSecret,
} from "@repo/agent-runtime";
import open from "open";

import type { ExtensionToolInfo } from "@/shared/ipc";
import { inteligirPath } from "@/main/lib/json-store";
import { resetNotifications } from "@/main/notifications";
import { taskManager } from "@/main/tasks/task-singleton";
import { TaskScheduleSchema, type TaskSchedule } from "@/shared/task";
import { toErrorMessage } from "@/shared/ipc";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const AUTH_PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.5";
const GWS_VERSION = "0.22.5";
const AGENT_BROWSER_VERSION = "0.26.0";
const PEEKABOO_VERSION = "3.0.0";

/** ~/.inteligir — used as pi's agentDir so all discovery looks here */
const AGENT_DIR = inteligirPath();
const AUTH_PATH = inteligirPath("auth.json");
const SESSION_DIR = inteligirPath("sessions");
const WORKSPACE_DIR = inteligirPath("workspace");
const BIN_DIR = inteligirPath("bin");
const EXTENSIONS_DIR = inteligirPath("extensions");

// Override pi-coding-agent's default getAgentDir() (~/.pi/agent)
process.env["PI_CODING_AGENT_DIR"] = AGENT_DIR;

// ---------------------------------------------------------------------------
// Bundled resource discovery
// ---------------------------------------------------------------------------

declare const __PROJECT_ROOT__: string;

function getBundledResourcesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "resources", "agent");
  }
  return path.join(__PROJECT_ROOT__, "resources", "agent");
}

/**
 * Seed bundled skills + AGENTS.md into ~/.inteligir/ on first run, and
 * make sure the bundled CLI bin dir is on PATH so agent tools can find it.
 */
export function seedResources(): void {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

  prependPath(BIN_DIR);

  const src = getBundledResourcesDir();
  if (!fs.existsSync(src)) {
    console.warn("[agent] bundled resources not found at", src);
    return;
  }

  seedDirectory(path.join(src, "skills"), path.join(AGENT_DIR, "skills"));
  seedFile(path.join(src, "AGENTS.md"), path.join(AGENT_DIR, "AGENTS.md"));

  // Seed the gws OAuth client_secret unconditionally — independent of the
  // network-dependent gws binary install. An offline first-run should still
  // leave ~/.config/gws/client_secret.json on disk so OAuth works as soon
  // as gws is installed on a later launch.
  seedGwsClientSecret(src);
}

// ---------------------------------------------------------------------------
// CLI installs
// ---------------------------------------------------------------------------

export async function installGws(): Promise<void> {
  await installGwsBootstrap({
    version: GWS_VERSION,
    binDir: BIN_DIR,
  });
}

export async function installAgentBrowser(): Promise<void> {
  await installAgentBrowserBootstrap({
    version: AGENT_BROWSER_VERSION,
    binDir: BIN_DIR,
  });
}

export async function installPeekaboo(): Promise<void> {
  await installPeekabooBootstrap({
    version: PEEKABOO_VERSION,
    binDir: BIN_DIR,
  });
}

// ---------------------------------------------------------------------------
// Extension factories
// ---------------------------------------------------------------------------

async function getExtensionFactories(): Promise<ExtensionFactory[]> {
  const { registerBrowserExtension } = await import("@/agent/browser-tool");
  const { registerGwsExtension } = await import("@/agent/gws-tool");
  const { registerPeekabooExtension } = await import("@/agent/peekaboo-tool");
  return [
    registerTasksExtension,
    registerBrowserExtension,
    registerGwsExtension,
    registerPeekabooExtension,
  ];
}

// ---------------------------------------------------------------------------
// manage_tasks extension
// ---------------------------------------------------------------------------

function registerTasksExtension(pi: ExtensionAPI): void {
  const manageTasksSchema = Type.Object({
    action: Type.Union(
      [
        Type.Literal("create"),
        Type.Literal("list"),
        Type.Literal("toggle"),
        Type.Literal("delete"),
      ],
      { description: "Action to perform" },
    ),
    label: Type.Optional(Type.String({ description: "Task label (required for create)" })),
    prompt: Type.Optional(
      Type.String({ description: "Prompt to run when task fires (required for create)" }),
    ),
    schedule: Type.Optional(
      Type.Unsafe<TaskSchedule>({
        description:
          "Schedule: {type:'cron',cron:string} | {type:'interval',intervalMs:number} | {type:'once',runAt:number}",
      }),
    ),
    taskId: Type.Optional(Type.String({ description: "Task ID (required for toggle/delete)" })),
  });

  pi.registerTool({
    name: "manage_tasks",
    label: "manage_tasks",
    description:
      "Create, list, toggle, or delete scheduled tasks. " +
      "Tasks run automatically on a cron/interval/once schedule.",
    parameters: manageTasksSchema,
    execute: async (_toolCallId, params: Static<typeof manageTasksSchema>) => {
      const text = (s: string) => ({ content: [{ type: "text" as const, text: s }], details: {} });
      const p = params;

      switch (p.action) {
        case "list": {
          const tasks = taskManager.getTasks();
          if (tasks.length === 0) return text("No tasks configured.");
          const lines = tasks.map(
            (t) =>
              `- [${t.enabled ? "ON" : "OFF"}] ${t.label} (${t.id})\n  schedule: ${JSON.stringify(t.schedule)}\n  prompt: ${t.prompt.slice(0, 100)}${t.prompt.length > 100 ? "..." : ""}`,
          );
          return text(lines.join("\n\n"));
        }
        case "create": {
          if (!p.label) return text("Error: label is required for create");
          if (!p.prompt) return text("Error: prompt is required for create");
          if (!p.schedule) return text("Error: schedule is required for create");
          const schedule = TaskScheduleSchema.parse(p.schedule);
          const task = taskManager.createTask({ label: p.label, prompt: p.prompt, schedule });
          return text(`Created task "${task.label}" (${task.id})`);
        }
        case "toggle": {
          if (!p.taskId) return text("Error: taskId is required for toggle");
          try {
            const task = taskManager.toggleTask(p.taskId);
            return text(`Task "${task.label}" is now ${task.enabled ? "enabled" : "disabled"}`);
          } catch (err) {
            return text(`Error: ${toErrorMessage(err)}`);
          }
        }
        case "delete": {
          if (!p.taskId) return text("Error: taskId is required for delete");
          taskManager.deleteTask(p.taskId);
          return text(`Deleted task ${p.taskId}`);
        }
      }
    },
  });

  pi.on("before_agent_start", (_event, _ctx) => {
    const tasks = taskManager.getTasks().filter((t) => t.enabled);
    if (tasks.length === 0) return;

    const summary = tasks
      .map(
        (t) =>
          `- ${t.label}: ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? "..." : ""} (${t.schedule.type})`,
      )
      .join("\n");

    pi.sendMessage({
      customType: "scheduled-tasks",
      content: `[Active scheduled tasks]\n${summary}`,
      display: false,
    });
  });
}

// Lazy + reset on teardown so a logout flow doesn't carry the prior
// AuthStorage's cached credentials past auth.json being deleted.
let _authStorage: ReturnType<typeof createAuthStorage> | null = null;

function getAuthStorage(): ReturnType<typeof createAuthStorage> {
  if (!_authStorage) _authStorage = createAuthStorage(AUTH_PATH);
  return _authStorage;
}

export function isSetupComplete(): boolean {
  return fs.existsSync(WORKSPACE_DIR);
}

export function teardownResources(): void {
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
  // Drop singletons that hold JsonStore caches pointing at files inside
  // AGENT_DIR — otherwise a re-login would serve stale settings until the
  // process restarts.
  _authStorage = null;
  resetNotifications();
}

export function isLoggedIn(): boolean {
  if (!fs.existsSync(AUTH_PATH)) return false;
  return hasAuth(getAuthStorage(), AUTH_PROVIDER);
}

export async function login(): Promise<void> {
  await loginWithProvider(getAuthStorage(), AUTH_PROVIDER, {
    onAuth: (info) => {
      void open(info.url);
    },
  });
}

// ---------------------------------------------------------------------------
// Agent — Inteligir wrapper around PiAgent that fixes paths + extensions and
// keeps the legacy public surface app code expects (sendMessage returning
// SendMessageResult, listTools returning ExtensionToolInfo[]).
// ---------------------------------------------------------------------------

import type {
  InterruptResult,
  SendMessageResult,
  SteerResult,
  SessionStatus,
} from "@/shared/agent";
import type { ImageContent, AgentSessionEvent } from "@repo/pi-driver";

function resolveSessionManager(): SessionManager {
  const sessionFile = process.env["INTELIGIR_SESSION_FILE"];
  if (sessionFile) {
    try {
      return SessionManager.open(sessionFile, SESSION_DIR);
    } catch (err) {
      console.warn("[agent] failed to open session file, falling back to continueRecent:", err);
    }
  }
  return SessionManager.continueRecent(WORKSPACE_DIR, SESSION_DIR);
}

export type AgentOptions = {
  /** If true, start a fresh session instead of resuming the most recent one. */
  newSession?: boolean;
};

export class Agent {
  // Lazy so synchronous resolveModel/resolveSessionManager throws surface
  // through the async start() path rather than out of `new Agent()`.
  private pi: PiAgent | null = null;

  constructor(private readonly opts: AgentOptions = {}) {}

  async start(): Promise<void> {
    if (!this.pi) {
      const sessionManager = this.opts.newSession
        ? SessionManager.create(WORKSPACE_DIR, SESSION_DIR)
        : resolveSessionManager();
      this.pi = new PiAgent({
        cwd: WORKSPACE_DIR,
        agentDir: AGENT_DIR,
        authStorage: getAuthStorage(),
        model: resolveModel(AUTH_PROVIDER, MODEL_ID),
        sessionManager,
        // Defer extension imports until start so tool registration failures
        // surface through the normal agent startup path.
        extensionFactories: () => getExtensionFactories(),
      });
    }
    await this.pi.start();
  }

  async stop(): Promise<void> {
    await this.pi?.stop();
  }

  waitForIdle(timeoutMs: number): Promise<boolean> {
    return this.pi?.waitForIdle(timeoutMs) ?? Promise.resolve(true);
  }

  async sendMessage(message: string, images?: ImageContent[]): Promise<SendMessageResult> {
    await this.ensurePi().sendMessage(message, images);
    return { accepted: true };
  }

  async steer(message: string, images?: ImageContent[]): Promise<SteerResult> {
    await this.ensurePi().steer(message, images);
    return { accepted: true };
  }

  async followUp(message: string, images?: ImageContent[]): Promise<SendMessageResult> {
    await this.ensurePi().followUp(message, images);
    return { accepted: true };
  }

  async interrupt(): Promise<InterruptResult> {
    if (!this.pi) return { interrupted: false };
    const interrupted = await this.pi.interrupt();
    return { interrupted };
  }

  getState(): { status: SessionStatus; error: string | null } {
    return this.pi?.getState() ?? { status: "starting", error: null };
  }

  getLastAssistantText(): string | undefined {
    return this.pi?.getLastAssistantText();
  }

  listTools(): ExtensionToolInfo[] {
    return this.pi?.listTools() ?? [];
  }

  setActiveTools(toolNames: string[]): void {
    this.pi?.setActiveTools(toolNames);
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    // Throw — silently dropping the listener would mean no agent events
    // ever reach the renderer.
    return this.ensurePi().subscribe(listener);
  }

  private ensurePi(): PiAgent {
    if (!this.pi) throw new Error("Agent not started — call start() first");
    return this.pi;
  }
}
