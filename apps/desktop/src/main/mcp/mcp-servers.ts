// ---------------------------------------------------------------------------
// MCP server config store. Backs ~/.inteligir/mcp.json and is the single
// source of truth for both the Settings UI (CRUD over IPC) and the MCP
// extension bundle (reads enabled servers at agent start to connect).
// ---------------------------------------------------------------------------

import { JsonStore, inteligirPath, type FsAdapter } from "@/main/lib/json-store";
import {
  McpConfigSchema,
  type AddMcpServerParams,
  type McpConfig,
  type McpServer,
} from "@/shared/mcp";

const DEFAULT_CONFIG: McpConfig = { mcpServers: {} };

export class McpServersManager {
  private readonly store: JsonStore<McpConfig>;

  constructor(storePath?: string, fs?: FsAdapter) {
    this.store = new JsonStore(
      storePath ?? inteligirPath("mcp.json"),
      McpConfigSchema,
      DEFAULT_CONFIG,
      fs,
    );
  }

  /** Flattened, name-sorted projection for the UI. */
  list(): McpServer[] {
    const { mcpServers } = this.store.read();
    return Object.entries(mcpServers)
      .map(([name, cfg]) => ({
        name,
        url: cfg.url,
        headers: cfg.headers,
        enabled: cfg.enabled ?? true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Only the servers the extension should actually connect to. */
  listEnabled(): McpServer[] {
    return this.list().filter((s) => s.enabled);
  }

  /** Add or overwrite a server by name. New servers are enabled by default. */
  add(params: AddMcpServerParams): McpServer[] {
    this.store.update((current) => ({
      mcpServers: {
        ...current.mcpServers,
        [params.name]: {
          url: params.url,
          ...(params.headers && Object.keys(params.headers).length > 0
            ? { headers: params.headers }
            : {}),
          enabled: true,
        },
      },
    }));
    return this.list();
  }

  remove(name: string): McpServer[] {
    this.store.update((current) => {
      const next = { ...current.mcpServers };
      delete next[name];
      return { mcpServers: next };
    });
    return this.list();
  }

  setEnabled(name: string, enabled: boolean): McpServer[] {
    this.store.update((current) => {
      const existing = current.mcpServers[name];
      if (!existing) return current;
      return {
        mcpServers: { ...current.mcpServers, [name]: { ...existing, enabled } },
      };
    });
    return this.list();
  }

  /** Drop the cached config so the next read re-reads from disk (post-teardown). */
  invalidate(): void {
    this.store.invalidate();
  }
}

let _instance: McpServersManager | null = null;

export function getMcpServers(): McpServersManager {
  if (!_instance) _instance = new McpServersManager();
  return _instance;
}

export function resetMcpServers(): void {
  _instance?.invalidate();
}
