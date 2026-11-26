import { vi } from "vitest";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- an event reaches the page unparsed, as the preload hands it on
type Listener = (payload: unknown) => void;

/**
 * Stands in for the Mac app's preload (`apps/desktop/src/preload/index.ts`), which vitest cannot
 * run: `answer` is what main replies to each command, a throw its refusal, and `push` sends an
 * event as main does.
 */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- main's answer reaches the page unparsed, which the bridge parses
export const underShell = (answer: (command: string) => unknown) => {
  const asked: string[] = [];
  const listeners = new Map<string, Set<Listener>>();

  const ask = async (command: string) => {
    asked.push(command);

    return await Promise.resolve().then(() => answer(command));
  };

  const listen = (event: string, listener: Listener) => {
    const heard = listeners.get(event) ?? new Set<Listener>();

    heard.add(listener);
    listeners.set(event, heard);

    return () => {
      heard.delete(listener);
    };
  };

  vi.stubGlobal("desktopBridge", {
    checkForUpdates: async () => await ask("check-for-updates"),
    downloadUpdate: async () => await ask("download-update"),
    installUpdate: async () => await ask("install-update"),
    onQuickCapture: (listener: Listener) => listen("quick-capture", listener),
    onUpdateState: (listener: Listener) => listen("update-state", listener),
  });

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a test sends what main might, malformed too
  const push = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(payload);
    }
  };

  return { asked, push };
};
