// no middleware ladder: the token is checked at the http boundary (three of the
// four surfaces it guards are not procedures) and containment is the vault
// service's alone — a resolveVaultPath middleware would be a second answer to it.

import { localContract } from "@repo/api/local";
import type { AgentStatus, DataDirScope } from "@repo/api/local/system/system-schema";
import type { ORPCError } from "@orpc/server";
import { implement } from "@orpc/server";
import type { RecordAgentWrites } from "./agents/agent-driver";
import type { AgentsService } from "./agents/agents-service";
import type { ListTurnChanges, UndoTurnChanges } from "./agents/turn-changes";
import type { BrowserSession } from "./browser-session";
import type { CommentsService } from "./comments/comments-service";
import type { CloudPrefsStore } from "./cloud/cloud-prefs-store";
import type { CloudRuntime } from "./cloud/sync-runtime";
import type { ConnectorsService } from "./connectors/connectors-service";
import type { ConnectorOauthFlow } from "./connectors/oauth-flow";
import type { OpenExternalUrl } from "./browser-opener";
import type { FoldersService } from "./folders/folders-service";
import type { RenameTag } from "./knowledge/knowledge-router";
import type { KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import type { ThreadService } from "./threads/service";
import type { VaultPrefsStore } from "./vault/vault-prefs-store";
import type { VaultRuntime } from "./vault/vault-runtime";
import type { RenameNote } from "./vault/vault-router";

interface SystemFacts {
  version: string;
  dataDir: string;
  dataDirScope: DataDirScope;
  vaultDir: string;
  schemaVersion: number;
  startedAt: number;
  // false in a checkout whose UI was never built: no page answers a browser.
  servesUi: boolean;
  // read per request: a bundled runtime removed from under a running app is the next answer.
  agent: () => AgentStatus;
}

export interface AppContext {
  // per request: the thread whose agent shell sent it (`agent-thread-header.ts`), else null.
  agentThreadId: string | null;
  agents: AgentsService;
  browserSession: BrowserSession;
  cloud: CloudRuntime;
  cloudPrefs: CloudPrefsStore;
  comments: CommentsService;
  connectors: ConnectorsService;
  connectorsOauth: ConnectorOauthFlow;
  folders: FoldersService;
  knowledge: KnowledgeRuntime;
  // injected so a suite can watch an authorization begin without opening a window.
  openExternalUrl: OpenExternalUrl;
  // per request: a callback url must name the port the caller reached, since
  // listen may have probed past the configured one. null when no request reached this context.
  requestOrigin: string | null;
  recordAgentWrites: RecordAgentWrites;
  renameNote: RenameNote;
  renameTag: RenameTag;
  system: SystemFacts;
  threads: ThreadService;
  turnChanges: ListTurnChanges;
  undoTurn: UndoTurnChanges;
  vault: VaultRuntime;
  vaultPrefs: VaultPrefsStore;
}

export type AppServices = Omit<AppContext, "agentThreadId" | "requestOrigin">;

export const base = implement(localContract).$context<AppContext>();

// a write an agent's shell asked for joins that turn's commit; anyone else's is the auto-commit's.
export const attributeWrites = (context: AppContext, paths: readonly string[]): void => {
  if (context.agentThreadId !== null) {
    context.recordAgentWrites(context.agentThreadId, paths);
  }
};

// an unnamed refusal is rethrown as it came — a 500, rather than a class the contract row does not declare.
export const refusals =
  (translate: (cause: unknown) => ORPCError<string, unknown> | null) =>
  async <T>(work: () => T | Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw translate(error) ?? error;
    }
  };
