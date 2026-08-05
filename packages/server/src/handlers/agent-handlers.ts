import { dispatchAgentCommand } from "../app/agent-gateway";
import { getConfirmationBroker } from "../agent-confirm/confirmation-broker";
import { getAgent, reauthenticate } from "../app/app-machine";
import { listChatSessions, readChatSessionById, readSessionHistory } from "../app/session-history";
import type { HandlerRegistrar } from "./handler-registry";
import { applyFauxAgentScript, isFauxAgentEnabled } from "@repo/agent/provider/faux-provider";

export function registerAgentHandlers(handle: HandlerRegistrar): void {
  // All interactive agent commands funnel through the gateway, which defers
  // them while an external chat turn owns the session (see agent-gateway.ts).
  // Return the submission promise so renderer-side failure surfacing
  // (agent-store's sendCommandSurfacingFailure) sees rejections — e.g.
  // "Agent unavailable" mid-newSession — instead of a silently dropped send.
  handle("sendAgentCommand", (command) => dispatchAgentCommand(command));

  handle("getAgentHistory", () => readSessionHistory());
  // The read-only past-chat browser: list + read, nothing else. The live
  // agent's session id keeps the active thread out of the listing.
  handle("listChatSessions", () => listChatSessions(getAgent()?.getSessionId() ?? null));
  handle("readChatSession", ({ id }) => readChatSessionById(id));
  handle("reauthenticate", () => reauthenticate());

  // Dev-only E2E scripting seam — fails closed in production.
  handle("setFauxAgentScript", (script) => {
    if (!isFauxAgentEnabled()) {
      throw new Error("setFauxAgentScript requires INTELIGIR_FAUX_AGENT=1");
    }
    applyFauxAgentScript(script);
  });

  // The human's answer to a destructive proposal the agent raised. The broker
  // owns expiry, so an unknown or already-settled id is ignored rather than
  // rejected — a late click must not resurrect a proposal that timed out.
  handle("resolveAgentConfirmation", ({ id, confirmed }) => {
    getConfirmationBroker().resolve(id, confirmed);
  });

  // Dev-only E2E assertion seam — fails closed in production like the above.
  handle("getAgentSystemPrompt", () => {
    if (!isFauxAgentEnabled()) {
      throw new Error("getAgentSystemPrompt requires INTELIGIR_FAUX_AGENT=1");
    }
    return getAgent()?.getSystemPrompt() ?? null;
  });
}
