import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { z } from "zod";

const updateStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["idle", "checking", "not-available"]) }),
  z.object({ status: z.literal("available"), version: z.string() }),
  z.object({ downloadPercent: z.number(), status: z.literal("downloading") }),
  z.object({ status: z.literal("downloaded"), version: z.string() }),
  z.object({ message: z.string(), status: z.enum(["check-failed", "error"]) }),
]);

export type DesktopUpdateState = z.infer<typeof updateStateSchema>;

export interface DesktopBridge {
  readonly checkForUpdates: () => Promise<DesktopUpdateState>;
  readonly downloadUpdate: () => Promise<DesktopUpdateState>;
  readonly installUpdate: () => Promise<DesktopUpdateState>;
  readonly onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

const register = async (listener: (state: DesktopUpdateState) => void) => {
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

const detach = async (registration: Promise<UnlistenFn | null>) => {
  const stop = await registration;
  stop?.();
};

const ask = async (command: string) => updateStateSchema.parse(await invoke<unknown>(command));

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
export const desktopBridge = () => (isTauri() ? tauriBridge : null);
