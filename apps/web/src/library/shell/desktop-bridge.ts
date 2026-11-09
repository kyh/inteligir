// The Mac app's door into this page: the page is deployed apart from the installed shell, so it
// speaks the shell's three update commands and its one event, never the updater plugin's own API.
// Everything else the window needs, the browser already does.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { z } from "zod";

/** Parses what `UpdateState` in apps/desktop/src-tauri/src/updater.rs serializes; keep the two in step. */
const updateStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["idle", "checking", "not-available"]) }),
  z.object({ status: z.literal("available"), version: z.string() }),
  z.object({ downloadPercent: z.number(), status: z.literal("downloading") }),
  z.object({ status: z.literal("downloaded"), version: z.string() }),
  z.object({ message: z.string(), status: z.literal("error") }),
]);

export type DesktopUpdateState = z.infer<typeof updateStateSchema>;

export interface DesktopBridge {
  readonly checkForUpdates: () => Promise<DesktopUpdateState>;
  readonly downloadUpdate: () => Promise<DesktopUpdateState>;
  readonly installUpdate: () => Promise<DesktopUpdateState>;
  readonly onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

// a frame the page does not know is dropped; a registration the shell refused delivers nothing
const register = async (
  listener: (state: DesktopUpdateState) => void,
): Promise<UnlistenFn | null> => {
  try {
    return await listen<unknown>("update-state", ({ payload }) => {
      const parsed = updateStateSchema.safeParse(payload);
      if (parsed.success) {
        listener(parsed.data);
      }
    });
  } catch (error) {
    console.warn("[desktop] the shell refused the update listener", error);
    return null;
  }
};

// `listen` resolves its stop function later, so an early unsubscribe still detaches
const detach = async (registration: Promise<UnlistenFn | null>): Promise<void> => {
  const stop = await registration;
  stop?.();
};

const ask = async (command: string): Promise<DesktopUpdateState> =>
  updateStateSchema.parse(await invoke<unknown>(command));

const tauriBridge: DesktopBridge = {
  checkForUpdates: async () => await ask("check_for_updates"),
  downloadUpdate: async () => await ask("download_update"),
  installUpdate: async () => await ask("install_update"),
  onUpdateState: (listener) => {
    const registration = register(listener);
    return () => {
      void detach(registration);
    };
  },
};

/** The Mac app's shell (apps/desktop), or null in a browser tab. */
export const desktopBridge = (): DesktopBridge | null => (isTauri() ? tauriBridge : null);
