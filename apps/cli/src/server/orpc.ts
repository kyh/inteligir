// no middleware ladder: the token is checked at the http boundary (three of the
// four surfaces it guards are not procedures) and containment is the vault
// service's alone — a resolveVaultPath middleware would be a second answer to it.
// the one middleware is a procedure's own refusal translation, `refusing`.

import { localContract } from "@repo/contract/local";
import type { AgentStatus } from "@repo/contract/local/system/system-schema";
import type { ORPCError } from "@orpc/server";
import { implement } from "@orpc/server";
import type { AgentsService } from "./agents/agents-service";
import type { BrowserSession } from "./browser-session";
import type { AnnotationsService } from "./annotations/annotations-service";
import type { CloudPrefsStore } from "./cloud/cloud-prefs-store";
import type { CloudRuntime } from "./cloud/sync-runtime";
import type { ConnectorsService } from "./connectors/connectors-service";
import type { FoldersService } from "./folders/folders-service";
import type { ImportService } from "./imports/import-service";
import type { ItemsService } from "./items/items-service";
import type { RenameTag } from "./knowledge/knowledge-router";
import type { KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import type { ImageDownscale } from "./media/image-downscale";
import type { ThreadService } from "./threads/service";
import type { RecordAgentWrites } from "./threads/turn-driver";
import type { TurnUndo } from "./threads/turn-undo";
import type { VaultPrefsStore } from "./vault/vault-prefs-store";
import type { VaultRuntime } from "./vault/vault-runtime";
import type { RenameNote } from "./vault/vault-router";

interface SystemFacts {
  version: string;
  dataDir: string;
  vaultDir: string;
  schemaVersion: number;
  startedAt: number;
  // this boot's media token (MEDIA_TOKEN_PARAM), which only the byte routes read
  mediaToken: string;
  // false in a checkout whose UI was never built: no page answers a browser.
  servesUi: boolean;
  // read per request: a bundled runtime removed from under a running app is the next answer.
  agent: () => AgentStatus;
}

export interface AppContext {
  // per request: the thread whose agent shell sent it (`agent-thread-header.ts`), else null.
  agentThreadId: string | null;
  agents: AgentsService;
  annotations: AnnotationsService;
  browserSession: BrowserSession;
  cloud: CloudRuntime;
  cloudPrefs: CloudPrefsStore;
  connectors: ConnectorsService;
  // the one downscaler, a grid thumbnail's and a cover's, so the system's image tool runs one queue
  downscale: ImageDownscale;
  folders: FoldersService;
  imports: ImportService;
  items: ItemsService;
  knowledge: KnowledgeRuntime;
  recordAgentWrites: RecordAgentWrites;
  renameNote: RenameNote;
  renameTag: RenameTag;
  system: SystemFacts;
  threads: ThreadService;
  turnUndo: TurnUndo;
  vault: VaultRuntime;
  vaultPrefs: VaultPrefsStore;
}

export type AppServices = Omit<AppContext, "agentThreadId">;

export const base = implement(localContract).$context<AppContext>();

// a write an agent's shell asked for joins that turn's commit; anyone else's is the auto-commit's.
export const attributeWrites = (context: AppContext, paths: readonly string[]): void => {
  if (context.agentThreadId !== null) {
    context.recordAgentWrites(context.agentThreadId, paths);
  }
};

// for a refusal class whose wire code is shared across routes and the HTTP surfaces that are not
// procedures (`vault-refusals.ts`); a refusal one route alone raises maps through that handler's
// own `errors`. an unnamed refusal is rethrown as it came — a 500, rather than a class the
// contract row does not declare.
export const refusing = (translate: (cause: unknown) => ORPCError<string, unknown> | null) =>
  base.middleware(async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      throw translate(error) ?? error;
    }
  });
