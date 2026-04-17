// ---------------------------------------------------------------------------
// Agent setup — manages agent lifecycle in the main process
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { app } from "electron";

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
import { getModel } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import open from "open";

import type {
  InterruptResult,
  SendMessageResult,
  SessionStatus,
  SteerResult,
} from "@/shared/agent";

type ExtensionFactory = (pi: import("@mariozechner/pi-coding-agent").ExtensionAPI) => void;
import { inteligirPath } from "@/main/lib/json-store";
import { taskManager } from "@/main/tasks/task-singleton";
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
const WORKSPACE_DIR = inteligirPath("workspace");
const BIN_DIR = inteligirPath("bin");

// Override pi-coding-agent's default getAgentDir() (~/.pi/agent)
process.env["PI_CODING_AGENT_DIR"] = AGENT_DIR;

/**
 * Resolve the SessionManager for the agent. If the main process already
 * identified a session file (via INTELIGIR_SESSION_FILE env), open that
 * exact file so the agent continues the same session the UI loaded.
 * Otherwise fall back to continueRecent.
 */
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

let _defaultModel: Model<Api> | null = null;

function getDefaultModel(): Model<Api> {
  if (!_defaultModel) {
    const model = getModel(AUTH_PROVIDER, "gpt-5.4");
    if (!model) {
      throw new Error('Model "openai-codex/gpt-5.4" not found in pi-ai model registry');
    }
    _defaultModel = model;
  }
  return _defaultModel;
}

/**
 * Bundled resources shipped inside the app (resources/agent/).
 * In production these are unpacked via asarUnpack.
 * In dev they're at the repo's resources/agent/ directory.
 */
declare const __PROJECT_ROOT__: string;

function getBundledResourcesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "resources", "agent");
  }
  return path.join(__PROJECT_ROOT__, "resources", "agent");
}

/**
 * Seed bundled skills and AGENTS.md into ~/.inteligir/ on first run
 * or when the bundled version is newer.
 */
export function seedResources(): void {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });

  // Prepend ~/.inteligir/bin to PATH so the agent's bash tool can find gws
  const currentPath = process.env["PATH"] ?? "";
  const pathEntries = currentPath.split(path.delimiter).filter(Boolean);
  if (!pathEntries.includes(BIN_DIR)) {
    process.env["PATH"] = currentPath ? `${BIN_DIR}${path.delimiter}${currentPath}` : BIN_DIR;
  }

  const src = getBundledResourcesDir();
  if (!fs.existsSync(src)) {
    console.warn("[agent] bundled resources not found at", src);
    return;
  }

  const skillsSrc = path.join(src, "skills");
  const skillsDest = path.join(AGENT_DIR, "skills");
  if (fs.existsSync(skillsSrc) && !fs.existsSync(skillsDest)) {
    fs.cpSync(skillsSrc, skillsDest, { recursive: true });
  }

  const agentsMdSrc = path.join(src, "AGENTS.md");
  const agentsMdDest = path.join(AGENT_DIR, "AGENTS.md");
  if (fs.existsSync(agentsMdSrc) && !fs.existsSync(agentsMdDest)) {
    fs.mkdirSync(path.dirname(agentsMdDest), { recursive: true });
    fs.copyFileSync(agentsMdSrc, agentsMdDest);
  }

  seedGwsClientSecret(src);
}

// ---------------------------------------------------------------------------
// Google Workspace CLI (gws) — binary install + client secret seeding
// ---------------------------------------------------------------------------

const GWS_VERSION = "0.22.5";
const GWS_CONFIG_DIR = path.join(os.homedir(), ".config", "gws");

/**
 * Map (process.platform, process.arch) to the gws release artifact name.
 * Returns null for unsupported platform/arch combinations.
 * Currently only macOS is supported — inteligir is a macOS-only desktop app.
 */
function gwsArchSuffix(): string | null {
  if (process.platform !== "darwin") return null;

  switch (process.arch) {
    case "arm64":
      return "aarch64-apple-darwin";
    case "x64":
      return "x86_64-apple-darwin";
    default:
      return null;
  }
}

/**
 * Download the gws binary, then install its built-in skills.
 * Binary goes to ~/.inteligir/bin/gws, skills to ~/.inteligir/skills/.
 * Skips each step if already present. Called during onboarding setup.
 */
export async function installGws(): Promise<void> {
  await installGwsBinary();
  await installGwsSkills();
}

async function installGwsBinary(): Promise<void> {
  const gwsPath = path.join(BIN_DIR, "gws");
  if (fs.existsSync(gwsPath)) return;

  const arch = gwsArchSuffix();
  if (!arch) {
    console.warn(`[gws] unsupported platform/arch: ${process.platform}/${process.arch}`);
    return;
  }

  const tarball = `google-workspace-cli-${arch}.tar.gz`;
  const baseUrl = `https://github.com/googleworkspace/cli/releases/download/v${GWS_VERSION}`;
  const tarballUrl = `${baseUrl}/${tarball}`;
  const shaUrl = `${tarballUrl}.sha256`;
  const tarGzPath = path.join(BIN_DIR, tarball);
  const tarPath = path.join(BIN_DIR, tarball.replace(/\.gz$/, ""));

  const cleanup = () => {
    for (const f of [tarGzPath, tarPath, gwsPath]) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  };

  try {
    console.log(`[gws] downloading binary from ${tarballUrl}`);

    // Fetch tarball and expected sha256 in parallel
    const [tarResp, shaResp] = await Promise.all([
      fetch(tarballUrl, { redirect: "follow" }),
      fetch(shaUrl, { redirect: "follow" }),
    ]);
    if (!tarResp.ok || !tarResp.body) {
      throw new Error(`tarball fetch failed: ${tarResp.status} ${tarResp.statusText}`);
    }
    if (!shaResp.ok) {
      throw new Error(`checksum fetch failed: ${shaResp.status} ${shaResp.statusText}`);
    }

    // `.sha256` file format: "<hex>  <filename>\n" — take the first token
    const shaText = await shaResp.text();
    const expectedSha = shaText.trim().split(/\s+/)[0]?.toLowerCase();
    if (!expectedSha || !/^[0-9a-f]{64}$/.test(expectedSha)) {
      throw new Error(`invalid checksum format: ${shaText.slice(0, 80)}`);
    }

    // Stream tarball to disk while computing sha256
    const hash = createHash("sha256");
    const dest = fs.createWriteStream(tarGzPath);
    await pipeline(tarResp.body, async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk as Uint8Array);
        yield chunk;
      }
    }, dest);

    const actualSha = hash.digest("hex");
    if (actualSha !== expectedSha) {
      throw new Error(`checksum mismatch: expected ${expectedSha}, got ${actualSha}`);
    }

    // Decompress .tar.gz → .tar, then extract gws binary
    await pipeline(fs.createReadStream(tarGzPath), createGunzip(), fs.createWriteStream(tarPath));
    fs.unlinkSync(tarGzPath);

    await new Promise<void>((resolve, reject) => {
      execFile("tar", ["xf", tarPath, "-C", BIN_DIR, "gws"], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    fs.unlinkSync(tarPath);

    fs.chmodSync(gwsPath, 0o755);
    console.log(`[gws] installed binary to ${gwsPath}`);
  } catch (err) {
    console.error("[gws] binary install failed:", err);
    cleanup();
  }
}

/**
 * Install gws built-in skills (95 skill directories) into ~/.inteligir/skills/.
 * Uses `gws skills install --all` which ships with the binary.
 *
 * A sentinel file (`.gws-install-complete`) records the version last installed.
 * Partial/failed installs leave no sentinel, so the next run retries. Version
 * bumps also trigger a re-install.
 */
async function installGwsSkills(): Promise<void> {
  const gwsPath = path.join(BIN_DIR, "gws");
  if (!fs.existsSync(gwsPath)) return;

  const skillsDir = path.join(AGENT_DIR, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  const sentinel = path.join(skillsDir, ".gws-install-complete");
  if (fs.existsSync(sentinel)) {
    const installedVersion = fs.readFileSync(sentinel, "utf8").trim();
    if (installedVersion === GWS_VERSION) return;
  }

  try {
    console.log("[gws] installing built-in skills");
    await new Promise<void>((resolve, reject) => {
      execFile(gwsPath, ["skills", "install", "--all", "--dir", skillsDir], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    fs.writeFileSync(sentinel, GWS_VERSION);
    console.log(`[gws] installed skills to ${skillsDir}`);
  } catch (err) {
    console.error("[gws] skills install failed:", err);
  }
}

/**
 * Copy bundled client_secret.json → ~/.config/gws/client_secret.json
 * if not already present. Required for gws OAuth flow.
 */
function seedGwsClientSecret(bundledResourcesDir: string): void {
  const secretSrc = path.join(bundledResourcesDir, "client_secret.json");
  const secretDest = path.join(GWS_CONFIG_DIR, "client_secret.json");

  if (!fs.existsSync(secretSrc)) return;
  if (fs.existsSync(secretDest)) return;

  fs.mkdirSync(GWS_CONFIG_DIR, { recursive: true });
  fs.copyFileSync(secretSrc, secretDest);
  console.log(`[gws] seeded client_secret.json → ${secretDest}`);
}

// ---------------------------------------------------------------------------
// Extension factories
// ---------------------------------------------------------------------------

async function getExtensionFactories(): Promise<ExtensionFactory[]> {
  const { registerBrowserExtension } = await import("@/agent/browser-tool");
  return [registerTasksExtension, registerBrowserExtension];
}

// ---------------------------------------------------------------------------
// manage_tasks extension
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
// Auth — delegates to pi's AuthStorage
// ---------------------------------------------------------------------------

let authStorage: AuthStorage | null = null;

function getAuthStorage(): AuthStorage {
  if (!authStorage) {
    authStorage = AuthStorage.create(AUTH_PATH);
  }
  return authStorage;
}

export function isSetupComplete(): boolean {
  return fs.existsSync(WORKSPACE_DIR);
}

export function teardownResources(): void {
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
  authStorage = null;
}

export function isLoggedIn(): boolean {
  if (!fs.existsSync(AUTH_PATH)) return false;
  return getAuthStorage().hasAuth(AUTH_PROVIDER);
}

export async function login(): Promise<void> {
  const auth = getAuthStorage();
  await auth.login(AUTH_PROVIDER, {
    onAuth: (info) => {
      void open(info.url);
    },
    onPrompt: () => {
      return Promise.reject(new Error("Interactive prompt not supported"));
    },
  });
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

    const auth = getAuthStorage();
    const modelRegistry = new ModelRegistry(auth);

    const resourceLoader = new DefaultResourceLoader({
      cwd: WORKSPACE_DIR,
      agentDir: AGENT_DIR,
      extensionFactories: await getExtensionFactories(),
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: WORKSPACE_DIR,
      agentDir: AGENT_DIR,
      authStorage: auth,
      modelRegistry,
      resourceLoader,
      model: getDefaultModel(),
      thinkingLevel: "off",
      sessionManager: resolveSessionManager(),
      settingsManager: SettingsManager.create(WORKSPACE_DIR, AGENT_DIR),
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
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve(value);
      };
      // Subscribe BEFORE checking this.status to avoid a race where
      // agent_end fires between the status check and the subscription.
      const unsub = this.subscribe((event) => {
        if (event.type === "agent_end") settle(true);
      });
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

  getState(): { status: SessionStatus; error: string | null } {
    return { status: this.status, error: this.error };
  }

  getLastAssistantText(): string | undefined {
    return this.session?.getLastAssistantText();
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
