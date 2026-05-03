// ---------------------------------------------------------------------------
// Shutdown registry — LIFO (reverse of registration). Best-effort: a failing
// hook is logged and the next one still runs, so we always finish teardown.
// ---------------------------------------------------------------------------

export type ShutdownHook = {
  name: string;
  run: () => void | Promise<void>;
  /** Per-hook timeout in ms. Default 5s. */
  timeoutMs?: number;
};

const hooks: ShutdownHook[] = [];

export function registerShutdown(hook: ShutdownHook): void {
  hooks.push(hook);
}

export async function runShutdown(): Promise<void> {
  for (let i = hooks.length - 1; i >= 0; i--) {
    const hook = hooks[i];
    if (!hook) continue;
    const timeoutMs = hook.timeoutMs ?? 5_000;
    console.log(`[shutdown] ${hook.name}`);
    try {
      await withTimeout(hook.run(), timeoutMs, hook.name);
    } catch (err) {
      console.error(`[shutdown] ${hook.name} failed:`, err);
    }
  }
}

/** Test-only — clear between cases. */
export function resetShutdown(): void {
  hooks.length = 0;
}

function withTimeout<T>(
  value: T | Promise<T>,
  timeoutMs: number,
  name: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs);
    Promise.resolve(value).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
