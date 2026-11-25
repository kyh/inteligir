import { z } from "zod";

const updateStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["idle", "checking", "not-available"]) }),
  z.object({ status: z.literal("available"), version: z.string() }),
  z.object({ downloadPercent: z.number(), status: z.literal("downloading") }),
  z.object({ status: z.literal("downloaded"), version: z.string() }),
  z.object({ message: z.string(), status: z.literal("check-failed") }),
  z.object({
    message: z.string(),
    status: z.enum(["download-failed", "install-failed"]),
    version: z.string(),
  }),
]);

export type DesktopUpdateState = z.infer<typeof updateStateSchema>;

/**
 * Each command answers the state the shell moved to, or null when the page could not read its
 * answer, and a listener hears only the frames the page can read.
 */
export interface DesktopBridge {
  readonly checkForUpdates: () => Promise<DesktopUpdateState | null>;
  readonly downloadUpdate: () => Promise<DesktopUpdateState | null>;
  readonly installUpdate: () => Promise<DesktopUpdateState | null>;
  readonly onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

const read = (from: string, parsed: z.ZodSafeParseResult<DesktopUpdateState>) => {
  if (parsed.success) {
    return parsed.data;
  }

  console.warn(`[desktop] the page could not read the shell's ${from}`, parsed.error);

  return null;
};

interface NativeBridge {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the preload's answers arrive unparsed; ask parses each one
  readonly invoke: (command: string) => Promise<unknown>;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the preload's events arrive unparsed; the listener parses each one
  readonly on: (event: string, listener: (payload: unknown) => void) => () => void;
}

declare global {
  interface Window {
    desktopBridge?: unknown;
  }
}

const isNativeBridge = (value: unknown): value is NativeBridge =>
  typeof value === "object" &&
  value !== null &&
  "invoke" in value &&
  typeof value.invoke === "function" &&
  "on" in value &&
  typeof value.on === "function";

const bridgeOf = (native: NativeBridge) => {
  const ask = async (command: string) => {
    try {
      return read(command, updateStateSchema.safeParse(await native.invoke(command)));
    } catch (error) {
      console.warn(`[desktop] the shell refused ${command}`, error);

      return null;
    }
  };

  return {
    checkForUpdates: async () => await ask("check-for-updates"),
    downloadUpdate: async () => await ask("download-update"),
    installUpdate: async () => await ask("install-update"),
    onUpdateState: (listener) =>
      native.on("update-state", (payload) => {
        const state = read("update-state", updateStateSchema.safeParse(payload));

        if (state !== null) {
          listener(state);
        }
      }),
  } satisfies DesktopBridge;
};

/** The Mac app's shell (apps/desktop, its preload's `desktopBridge`), or null in a browser tab. */
export const desktopBridge = () => {
  const native = typeof window === "undefined" ? undefined : window.desktopBridge;

  return isNativeBridge(native) ? bridgeOf(native) : null;
};
