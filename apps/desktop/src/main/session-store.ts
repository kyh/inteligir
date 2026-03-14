import { z } from "zod";
import { inteligirPath, readJson, writeJson, clearFile } from "./json-store";

// ---------------------------------------------------------------------------
// Session persistence — ~/.inteligir/session.json
// Stores raw PiAgent messages for context resume across restarts.
// ---------------------------------------------------------------------------

const SESSION_PATH = inteligirPath("session.json");

const SessionSchema = z.array(z.unknown());

export function saveSession(messages: unknown[]): void {
  // structuredClone strips class instances (e.g. `api` on AssistantMessage)
  writeJson(SESSION_PATH, structuredClone(messages));
}

export function loadSession(): unknown[] | null {
  return readJson(SESSION_PATH, SessionSchema);
}

export function clearSession(): void {
  clearFile(SESSION_PATH);
}
