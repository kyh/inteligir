import fs from "node:fs";
import path from "node:path";

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { AgentSession, AgentSessionEvent, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { shell } from "electron";
import { getModel } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";

import type {
  GetStateResult,
  InterruptResult,
  SendMessageResult,
  SessionStatus,
  SteerResult,
} from "@/shared/agent";

import { inteligirPath } from "@/main/lib/json-store";
import { createTask, deleteTask, getTasks, toggleTask } from "@/main/tasks/task-store";
import { TaskScheduleSchema, type TaskSchedule } from "@/shared/task";
import { toErrorMessage } from "@/shared/ipc";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const AUTH_PROVIDER = "openai-codex";

/** ~/.inteligir — used as pi's agentDir so all discovery looks here */
const AGENT_DIR = inteligirPath();
const AUTH_PATH = inteligirPath("auth.json");
const SESSION_DIR = inteligirPath("sessions");

const DEFAULT_MODEL: Model<Api> | undefined = getModel(AUTH_PROVIDER, "gpt-5.4" as never);
if (!DEFAULT_MODEL) {
  throw new Error('Model "openai-codex/gpt-5.4" not found in pi-ai model registry');
}

/**
 * Bundled resources shipped inside the app (resources/agent/).
 * In production these are unpacked via asarUnpack and live at
 * process.resourcesPath/app.asar.unpacked/resources/agent/.
 * In dev they're at the repo's resources/agent/ directory.
 */
function getBundledResourcesDir(): string {
  // In packaged app, use the unpacked resources path
  if (process.resourcesPath) {
    const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "resources", "agent");
    if (fs.existsSync(unpacked)) return unpacked;
  }
  // Dev: electron-vite builds to .output/app/main/ — resources/ is two levels up
  return path.resolve(__dirname, "../../resources/agent");
}

/**
 * Seed bundled skills and AGENTS.md into ~/.inteligir/ on first run
 * or when the bundled version is newer.
 */
function seedResources(): void {
  const src = getBundledResourcesDir();
  if (!fs.existsSync(src)) {
    console.warn("[agent] bundled resources not found at", src);
    return;
  }

  // Seed skills
  const skillsSrc = path.join(src, "skills");
  const skillsDest = path.join(AGENT_DIR, "skills");
  if (fs.existsSync(skillsSrc)) {
    copyDirRecursive(skillsSrc, skillsDest);
  }

  // Seed AGENTS.md (only on first run — don't overwrite user edits)
  const agentsMdSrc = path.join(src, "AGENTS.md");
  const agentsMdDest = path.join(AGENT_DIR, "AGENTS.md");
  if (fs.existsSync(agentsMdSrc) && !fs.existsSync(agentsMdDest)) {
    fs.mkdirSync(path.dirname(agentsMdDest), { recursive: true });
    fs.copyFileSync(agentsMdSrc, agentsMdDest);
  }
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// manage_tasks extension — registered via extensionFactories
// ---------------------------------------------------------------------------

function registerTasksExtension(pi: ExtensionAPI): void {
  const manageTasksSchema = Type.Object({
    action: Type.Union([
      Type.Literal("create"),
      Type.Literal("list"),
      Type.Literal("toggle"),
      Type.Literal("delete"),
    ], { description: "Action to perform" }),
    label: Type.Optional(Type.String({ description: "Task label (required for create)" })),
    prompt: Type.Optional(Type.String({ description: "Prompt to run when task fires (required for create)" })),
    schedule: Type.Optional(Type.Unsafe<TaskSchedule>({
      description: "Schedule: {type:'cron',cron:string} | {type:'interval',intervalMs:number} | {type:'once',runAt:number}",
    })),
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
          const tasks = getTasks();
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
          const task = createTask({ label: p.label, prompt: p.prompt, schedule });
          return text(`Created task "${task.label}" (${task.id})`);
        }
        case "toggle": {
          if (!p.taskId) return text("Error: taskId is required for toggle");
          try {
            const task = toggleTask(p.taskId);
            return text(`Task "${task.label}" is now ${task.enabled ? "enabled" : "disabled"}`);
          } catch (err) {
            return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        case "delete": {
          if (!p.taskId) return text("Error: taskId is required for delete");
          deleteTask(p.taskId);
          return text(`Deleted task ${p.taskId}`);
        }
      }
    },
  });

  // Inject active tasks into context before each agent turn
  pi.on("before_agent_start", async (_event, _ctx) => {
    const tasks = getTasks().filter((t) => t.enabled);
    if (tasks.length === 0) return;

    const summary = tasks
      .map((t) => `- ${t.label}: ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? "..." : ""} (${t.schedule.type})`)
      .join("\n");

    pi.sendMessage({
      customType: "scheduled-tasks",
      content: `[Active scheduled tasks]\n${summary}`,
      display: false,
    });
  });
}

// ---------------------------------------------------------------------------
// Auth — delegates to pi's AuthStorage with Electron browser login
// ---------------------------------------------------------------------------

let authStorage: AuthStorage | null = null;

function getAuthStorage(): AuthStorage {
  if (!authStorage) {
    authStorage = AuthStorage.create(AUTH_PATH);
  }
  return authStorage;
}

export function isLoggedIn(): boolean {
  return getAuthStorage().hasAuth(AUTH_PROVIDER);
}

export async function login(): Promise<void> {
  const auth = getAuthStorage();
  await auth.login(AUTH_PROVIDER, {
    onAuth: (info) => {
      void shell.openExternal(info.url);
    },
    onPrompt: () => {
      return Promise.reject(new Error("Interactive prompt not supported"));
    },
  });
}

export function logout(): void {
  getAuthStorage().logout(AUTH_PROVIDER);
}

// ---------------------------------------------------------------------------
// Agent — thin wrapper around pi-coding-agent's AgentSession
// ---------------------------------------------------------------------------

type EventListener = (event: AgentSessionEvent) => void;

export class Agent {
  private session: AgentSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<EventListener>();
  private status: SessionStatus = "starting";
  private error: string | null = null;

  // ---- lifecycle -----------------------------------------------------------

  async start(): Promise<void> {
    if (this.session) return;

    // Seed bundled skills/AGENTS.md into ~/.inteligir/
    seedResources();

    const auth = getAuthStorage();
    const modelRegistry = new ModelRegistry(auth);

    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: AGENT_DIR,
      extensionFactories: [registerTasksExtension],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: process.cwd(),
      agentDir: AGENT_DIR,
      authStorage: auth,
      modelRegistry,
      resourceLoader,
      model: DEFAULT_MODEL,
      thinkingLevel: "off",
      sessionManager: SessionManager.create(process.cwd(), SESSION_DIR),
      settingsManager: SettingsManager.create(process.cwd(), AGENT_DIR),
    });

    this.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.handleEvent(event);
    });

    this.session = session;
    this.status = "idle";
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;

    if (this.session) {
      await this.session.abort();
      this.session.dispose();
      this.session = null;
    }

    this.status = "starting";
    this.error = null;
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!this.session) return true;
    // Subscribe before checking status to avoid race where agent_end fires
    // between the check and the subscribe call.
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve(value);
      };
      const unsub = this.session!.subscribe((event) => {
        if (event.type === "agent_end") settle(true);
      });
      // Now safe to check — if already idle, the subscription hasn't missed anything
      if (this.status !== "busy") {
        settle(true);
        return;
      }
      const timer = setTimeout(() => settle(false), timeoutMs);
    });
  }

  // ---- public API ----------------------------------------------------------

  async sendMessage(message: string): Promise<SendMessageResult> {
    const session = this.ensureSession();

    if (this.status === "busy") {
      await session.followUp(message);
      return { accepted: true };
    }

    this.status = "busy";

    void session.prompt(message).catch((err: unknown) => {
      this.status = "error";
      this.error = toErrorMessage(err);
      console.error("[agent] prompt error:", this.error);
    });

    return { accepted: true };
  }

  async steer(message: string): Promise<SteerResult> {
    const session = this.ensureSession();
    await session.steer(message);
    return { accepted: true };
  }

  async interrupt(): Promise<InterruptResult> {
    if (!this.session) return { interrupted: false };
    await this.session.abort();
    return { interrupted: true };
  }

  getState(): GetStateResult {
    return { status: this.status, error: this.error };
  }

  getLastAssistantText(): string | undefined {
    return this.session?.getLastAssistantText();
  }

  clear(): void {
    if (this.session) {
      void this.session.newSession();
    }
  }

  // ---- subscriptions -------------------------------------------------------

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ---- internals -----------------------------------------------------------

  private handleEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case "agent_start":
        this.status = "busy";
        break;
      case "agent_end":
        this.status = "idle";
        break;
    }

    this.broadcast(event);
  }

  private broadcast(event: AgentSessionEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* */ }
    }
  }

  private ensureSession(): AgentSession {
    if (!this.session) throw new Error("Agent not started — call start() first");
    return this.session;
  }
}
