// ---------------------------------------------------------------------------
// Startup registry — hooks run every launch, in registration order.
// Errors propagate: the caller decides whether to show a fatal dialog + quit.
// ---------------------------------------------------------------------------

export type StartupHook = {
  name: string;
  run: () => void | Promise<void>;
};

const hooks: StartupHook[] = [];

export function registerStartup(hook: StartupHook): void {
  hooks.push(hook);
}

export async function runStartup(): Promise<void> {
  for (const hook of hooks) {
    console.log(`[startup] ${hook.name}`);
    await hook.run();
  }
}

/** Test-only — clear between cases. */
export function resetStartup(): void {
  hooks.length = 0;
}
