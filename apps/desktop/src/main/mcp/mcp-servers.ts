// ---------------------------------------------------------------------------
// MCP server config store. Backs ~/.inteligir/mcp.json and is the single
// source of truth for both the Settings UI (CRUD over IPC) and the MCP
// extension bundle (reads enabled servers at agent start to connect).
// ---------------------------------------------------------------------------

import { JsonStore, inteligirPath, type FsAdapter } from "@/main/lib/json-store";
import {
  McpConfigSchema,
  mcpServerSlug,
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

  /**
   * Add or update a connector by name. Re-adding an existing name preserves its
   * enabled state (so editing a disabled connector's URL doesn't silently turn
   * it back on). Rejects a name whose executor namespace slug collides with a
   * different existing connector, since they'd otherwise map to one source.
   */
  add(params: AddMcpServerParams): McpServer[] {
    const current = this.store.read();
    const slug = mcpServerSlug(params.name);
    const collision = Object.keys(current.mcpServers).find(
      (name) => name !== params.name && mcpServerSlug(name) === slug,
    );
    if (collision) {
      throw new Error(
        `"${params.name}" conflicts with existing connector "${collision}" (same normalized name). Pick a more distinct name.`,
      );
    }

    const existing = current.mcpServers[params.name];
    this.store.write({
      mcpServers: {
        ...current.mcpServers,
        [params.name]: {
          url: params.url,
          ...(params.headers && Object.keys(params.headers).length > 0
            ? { headers: params.headers }
            : {}),
          enabled: existing?.enabled ?? true,
        },
      },
    });
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
