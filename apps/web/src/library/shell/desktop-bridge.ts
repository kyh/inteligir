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

const quickCaptureSchema = z.object({ clipboard: z.string() });

type QuickCapture = z.infer<typeof quickCaptureSchema>;

/**
 * Each command answers the state the shell moved to, or null when the page could not read its
 * answer, and a listener hears only the frames the page can read.
 */
export interface DesktopBridge {
  readonly checkForUpdates: () => Promise<DesktopUpdateState | null>;
  readonly downloadUpdate: () => Promise<DesktopUpdateState | null>;
  readonly installUpdate: () => Promise<DesktopUpdateState | null>;
  readonly onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
  readonly onQuickCapture: (listener: (capture: QuickCapture) => void) => () => void;
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
  readonly checkForUpdates: () => Promise<unknown>;
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- as above
  readonly downloadUpdate: () => Promise<unknown>;
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- as above
  readonly installUpdate: () => Promise<unknown>;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the preload's events arrive unparsed; the listener parses each one
  readonly onUpdateState: (listener: (payload: unknown) => void) => () => void;
}

interface CapturingBridge {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- as onUpdateState
  readonly onQuickCapture: (listener: (payload: unknown) => void) => () => void;
}

declare global {
  interface Window {
    desktopBridge?: unknown;
  }
}

const isNativeBridge = (value: unknown): value is NativeBridge =>
  typeof value === "object" &&
  value !== null &&
  "checkForUpdates" in value &&
  typeof value.checkForUpdates === "function" &&
  "downloadUpdate" in value &&
  typeof value.downloadUpdate === "function" &&
  "installUpdate" in value &&
  typeof value.installUpdate === "function" &&
  "onUpdateState" in value &&
  typeof value.onUpdateState === "function";

const capturesIn = (value: NativeBridge): value is NativeBridge & CapturingBridge =>
  "onQuickCapture" in value && typeof value.onQuickCapture === "function";

const NOTHING_TO_STOP = () => null;

// oxlint-disable-next-line anti-slop/no-unknown-returns -- the preload's answer arrives unparsed; ask parses it
const ask = async (command: string, call: () => Promise<unknown>) => {
  try {
    return read(command, updateStateSchema.safeParse(await call()));
  } catch (error) {
    console.warn(`[desktop] the shell refused ${command}`, error);

    return null;
  }
};

const bridgeOf = (native: NativeBridge) =>
  ({
    checkForUpdates: async () => await ask("check-for-updates", native.checkForUpdates),
    downloadUpdate: async () => await ask("download-update", native.downloadUpdate),
    installUpdate: async () => await ask("install-update", native.installUpdate),
    onUpdateState: (listener) =>
      native.onUpdateState((payload) => {
        const state = read("update-state", updateStateSchema.safeParse(payload));

        if (state !== null) {
          listener(state);
        }
      }),
    onQuickCapture: (listener) =>
      capturesIn(native)
        ? native.onQuickCapture((payload) => {
            const parsed = quickCaptureSchema.safeParse(payload);

            if (parsed.success) {
              listener(parsed.data);
            } else {
              console.warn(
                "[desktop] the page could not read the shell's quick-capture",
                parsed.error,
              );
            }
          })
        : NOTHING_TO_STOP,
  }) satisfies DesktopBridge;

/** The Mac app's shell (apps/desktop, its preload's `desktopBridge`), or null in a browser tab. */
export const desktopBridge = () => {
  const native = typeof window === "undefined" ? undefined : window.desktopBridge;

  return isNativeBridge(native) ? bridgeOf(native) : null;
};
