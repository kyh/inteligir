// ---------------------------------------------------------------------------
// Typed IPC handler registration — replaces ad-hoc ipcMain.handle + as-casts
// ---------------------------------------------------------------------------

import { ipcMain } from "electron";
import type { ZodType } from "zod";

/**
 * Register a validated IPC handler. The schema parses the raw input before
 * passing it to `fn`. ZodErrors propagate as rejected promises to the renderer.
 */
export function createIpcHandler<T>(
  channel: string,
  schema: ZodType<T>,
  fn: (input: T) => unknown,
): void {
  ipcMain.handle(channel, (_event, raw: unknown) => fn(schema.parse(raw)));
}

/** Register an IPC handler that takes no input. */
export function createVoidIpcHandler(
  channel: string,
  fn: () => unknown,
): void {
  ipcMain.handle(channel, () => fn());
}
