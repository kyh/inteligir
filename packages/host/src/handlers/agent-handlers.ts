import { dispatchAgentCommand } from "../app/agent-gateway";
import { reauthenticate } from "../app/app-machine";
import { readSessionHistory } from "../app/session-history";
import type { HandlerRegistrar } from "../lib/handler-registry";

export function registerAgentHandlers(handle: HandlerRegistrar): void {
  // All interactive agent commands funnel through the gateway, which defers
  // them while an external chat turn owns the session (see agent-gateway.ts).
  // Return the submission promise so renderer-side failure surfacing
  // (agent-store's sendCommandSurfacingFailure) sees rejections — e.g.
  // "Agent unavailable" mid-newSession — instead of a silently dropped send.
  handle("sendAgentCommand", (command) => dispatchAgentCommand(command));

  handle("getAgentHistory", () => readSessionHistory());
  handle("reauthenticate", () => reauthenticate());
}
