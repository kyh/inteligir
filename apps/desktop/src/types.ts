// The bridge carries what the page cannot ask its server: the loopback origin
// (a browser WebSocket cannot set a header and dials a different origin than
// the page, so main hands it over and attaches the bearer to the upgrade
// itself) and the updater, which lives in main because it replaces the app.
// Everything else rides the protocol handler, so the renderer never holds the
// token.

import { z } from "zod";
import type { SpellcheckChoice, SpellcheckState } from "./spellcheck-state";
import type { UpdateState } from "./update-state";
import type { VaultsState } from "./vaults-state";

export const IPC_CHANNELS = {
  SOCKET_ORIGIN: "desktop:socket-origin",
  UPDATE_STATE: "desktop:update-state",
  UPDATE_GET_STATE: "desktop:update-get-state",
  UPDATE_CHECK: "desktop:update-check",
  UPDATE_DOWNLOAD: "desktop:update-download",
  UPDATE_INSTALL: "desktop:update-install",
  SPELLCHECK_GET_STATE: "desktop:spellcheck-get-state",
  SPELLCHECK_APPLY: "desktop:spellcheck-apply",
  VAULTS_GET_STATE: "desktop:vaults-get-state",
  VAULTS_PICK: "desktop:vaults-pick",
  VAULTS_OPEN: "desktop:vaults-open",
  VAULTS_FORGET: "desktop:vaults-forget",
} as const;

export const socketOriginSchema = z.string().url();

// the preload parses every frame against update-state.ts before it reaches the page
export interface DesktopUpdatesBridge {
  getState(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  onState(listener: (state: UpdateState) => void): () => void;
}

// the spell checker is the window session's, so only main can switch it; the page keeps the choice
export interface DesktopSpellcheckBridge {
  getState(): Promise<SpellcheckState>;
  apply(choice: SpellcheckChoice): Promise<SpellcheckState>;
}

// the vault is the server's, so a switch restarts the child and replaces this window: `pick`
// and `open` answer the state only when nothing changed (a cancelled picker, a refusal thrown)
export interface DesktopVaultsBridge {
  getState(): Promise<VaultsState>;
  pick(): Promise<VaultsState>;
  open(path: string): Promise<VaultsState>;
  forget(path: string): Promise<VaultsState>;
}

export interface DesktopBridge {
  socketOrigin: string;
  updates: DesktopUpdatesBridge;
  spellcheck: DesktopSpellcheckBridge;
  vaults: DesktopVaultsBridge;
}

export function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
