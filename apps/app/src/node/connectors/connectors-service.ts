// The policy over `codex mcp` (codex-mcp.ts is the process seam). Three
// decisions live here and nowhere else:
//
// - THE READ NEVER REFUSES. A missing codex, or a codex that could not be
//   driven, is an ANSWER — `{ state: "unavailable", detail }` — because
//   "which connectors are configured" is a question with a true answer in
//   both cases. A write has no such answer and throws.
// - ADD REFUSES A NAME THAT EXISTS. `codex mcp add` overwrites silently and
//   exits 0, so without a read-then-refuse a user re-using a name would
//   replace a server they configured and be told it worked. The check is not
//   atomic and cannot be (the CLI has no such flag); what it buys is that the
//   ordinary mistake is refused rather than applied.
// - REMOVE REFUSES A NAME THAT DOES NOT EXIST. `codex mcp remove` prints
//   "No MCP server named …" and exits 0, so a typo would otherwise read as a
//   successful removal.

import type {
  Connector,
  ConnectorAddRequest,
  ConnectorsResponse,
} from "@repo/server-contract/connectors";
import { codexMcpArgs, CodexMcpError, parseCodexMcpList, type CodexMcpRunner } from "./codex-mcp";

/** The sentence a caller sees when codex is not installed. Shaped like the
 *  agent driver's own, because it is the same fact about the same machine. */
const NO_CODEX_DETAIL =
  "The codex binary was not found on PATH — connectors are the MCP servers Codex manages, so installing the Codex CLI is what adds them";

/** Raised by a WRITE when codex cannot be driven; the read answers instead. */
export class ConnectorsUnavailableError extends Error {}

/** A write refused because of what is (or is not) already configured. */
export class ConnectorConflictError extends Error {
  readonly kind: "already-exists" | "not-found";

  constructor(kind: "already-exists" | "not-found", message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface ConnectorsService {
  list(): Promise<ConnectorsResponse>;
  add(request: ConnectorAddRequest): Promise<Connector[]>;
  remove(name: string): Promise<Connector[]>;
}

export function createConnectorsService(runner: CodexMcpRunner): ConnectorsService {
  /** The listing, or a thrown reason — the shared half of every operation. */
  const readServers = async (binary: string): Promise<Connector[]> =>
    parseCodexMcpList(await runner.run(binary, codexMcpArgs.list()));

  const requireBinary = (): string => {
    const binary = runner.binaryPath();
    if (binary === null) {
      throw new ConnectorsUnavailableError(NO_CODEX_DETAIL);
    }
    return binary;
  };

  return {
    async list() {
      const binary = runner.binaryPath();
      if (binary === null) {
        return { state: "unavailable", detail: NO_CODEX_DETAIL };
      }
      try {
        return { state: "ready", servers: await readServers(binary) };
      } catch (error) {
        if (error instanceof CodexMcpError) {
          return { state: "unavailable", detail: error.message };
        }
        throw error;
      }
    },

    async add(request) {
      const binary = requireBinary();
      const existing = await readServers(binary);
      if (existing.some((server) => server.name === request.name)) {
        throw new ConnectorConflictError(
          "already-exists",
          `A connector named "${request.name}" is already configured.`,
        );
      }
      const args =
        request.transport.kind === "stdio"
          ? codexMcpArgs.addStdio(request.name, request.transport.command, request.transport.args)
          : codexMcpArgs.addHttp(request.name, request.transport.url);
      await runner.run(binary, args);
      return readServers(binary);
    },

    async remove(name) {
      const binary = requireBinary();
      const existing = await readServers(binary);
      if (!existing.some((server) => server.name === name)) {
        throw new ConnectorConflictError("not-found", `No connector named "${name}".`);
      }
      await runner.run(binary, codexMcpArgs.remove(name));
      return readServers(binary);
    },
  };
}
