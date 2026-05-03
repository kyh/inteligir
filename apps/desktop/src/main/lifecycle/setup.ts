// ---------------------------------------------------------------------------
// Setup registry — first-sign-in steps. FIFO, aborts on first failure. Each
// step carries a name so the UI can show "Installing gws… failed".
// ---------------------------------------------------------------------------

export type SetupStep = {
  name: string;
  run: () => void | Promise<void>;
};

export type SetupResult =
  | { ok: true }
  | { ok: false; step: string; message: string };

const steps: SetupStep[] = [];

export function registerSetup(step: SetupStep): void {
  steps.push(step);
}

export async function runSetup(): Promise<SetupResult> {
  for (const step of steps) {
    console.log(`[setup] ${step.name}`);
    try {
      await step.run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, step: step.name, message };
    }
  }
  return { ok: true };
}

/** Test-only — clear between cases. */
export function resetSetup(): void {
  steps.length = 0;
}
