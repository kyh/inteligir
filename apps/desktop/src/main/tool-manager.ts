import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Tool definition — a CLI tool that Inteligir auto-installs for the user
// ---------------------------------------------------------------------------

type ToolDefinition = {
  id: string;
  /** Command to check if installed (e.g. ["agent-browser", "--version"]) */
  checkCommand: [string, ...string[]];
  /** Steps to install, executed in order */
  installSteps: { command: string; args: string[]; description: string }[];
};

const TOOL_REGISTRY: ToolDefinition[] = [
  {
    id: "agent-browser",
    checkCommand: ["agent-browser", "--version"],
    installSteps: [
      {
        command: "npm",
        args: ["install", "-g", "agent-browser"],
        description: "Installing agent-browser via npm",
      },
      {
        command: "agent-browser",
        args: ["install"],
        description: "Downloading Chrome for Testing",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// ToolManager — auto-installs CLI tools and tracks availability
// ---------------------------------------------------------------------------

export class ToolManager {
  private installed = new Set<string>();

  /** Check all tools; install any that are missing. */
  async ensureAll(): Promise<void> {
    await Promise.all(TOOL_REGISTRY.map((def) => this.ensure(def)));
  }

  /** Returns true if the tool is available for use. */
  isInstalled(id: string): boolean {
    return this.installed.has(id);
  }

  // ---- internals -----------------------------------------------------------

  private async ensure(def: ToolDefinition): Promise<void> {
    if (await this.isAvailable(def)) {
      this.installed.add(def.id);
      console.log(`[tool-manager] ${def.id} already installed`);
      return;
    }

    console.log(`[tool-manager] ${def.id} not found, installing...`);

    for (const step of def.installSteps) {
      try {
        console.log(`[tool-manager] ${step.description}`);
        await exec(step.command, step.args, {
          timeout: 5 * 60 * 1000,
          env: { ...process.env, PATH: extendedPath() },
        });
      } catch (err) {
        console.error(
          `[tool-manager] failed to install ${def.id}:`,
          err instanceof Error ? err.message : err,
        );
        return;
      }
    }

    if (await this.isAvailable(def)) {
      this.installed.add(def.id);
      console.log(`[tool-manager] ${def.id} installed successfully`);
    } else {
      console.error(
        `[tool-manager] ${def.id} install completed but binary not found in PATH`,
      );
    }
  }

  private async isAvailable(def: ToolDefinition): Promise<boolean> {
    try {
      const [cmd, ...args] = def.checkCommand;
      await exec(cmd, args, {
        timeout: 10_000,
        env: { ...process.env, PATH: extendedPath() },
      });
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Ensure npm global bin dirs are on PATH
// ---------------------------------------------------------------------------

function extendedPath(): string {
  const existing = process.env["PATH"] ?? "";
  const extras = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    `${process.env["HOME"]}/.npm-global/bin`,
  ];
  const parts = existing.split(path.delimiter);
  for (const extra of extras) {
    if (!parts.includes(extra)) {
      parts.push(extra);
    }
  }
  return parts.join(path.delimiter);
}
