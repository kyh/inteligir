// ---------------------------------------------------------------------------
// The agent's Bridge handlers, over this object's own runner.
//
// Everything here is a thin await around ./agent-runner, ./chat-store and
// ./provider-credentials — the composition that could differ between hosts is
// theirs. What this module owns is the SHAPE the registry promises: which
// refusals are values and which are throws, and what a client sees when a
// capability this deployment cannot offer is asked for.
//
// `connectAiProvider` is the one channel that does not finish what it starts.
// A host with no screen in common with its user cannot open a browser, so it
// parks a PKCE verifier and answers with the URL the client must send them to;
// the exchange lands later on ../host/agent-endpoints, and the resulting
// snapshot is pushed as `onAiProviderChanged`.
// ---------------------------------------------------------------------------

import type { HandlerRegistrar } from "../host/handler-registry";

import type { AgentRunner } from "./agent-runner";
import type { ChatStore } from "./chat-store";
import type { ProviderCredentials } from "./provider-credentials";
import type { ProviderService } from "./provider-service";
import { startAuthorization } from "./provider-oauth";

export type AgentServices = {
  readonly env: Env;
  readonly userId: string;
  readonly runner: AgentRunner;
  readonly chat: ChatStore;
  /** Which provider runs, and the selection behind it (./provider-service). */
  readonly providers: ProviderService;
  /** The OAuth round trip only — parking a verifier and redeeming it later
   * reads no selection, so it stays off the resolution seam. */
  readonly credentials: ProviderCredentials;
  /** The origin this object is reached on, for building a redirect URI. Read
   * off the socket that authenticated, because a Durable Object has no notion
   * of the hostname its Worker was called at. */
  readonly origin: () => string;
  /** Push the provider snapshot to every socket. A selection is per ACCOUNT,
   * not per tab, so returning it only to the caller leaves a second tab
   * rendering a provider the next turn will not run on. */
  readonly announce: () => void;
};

export function registerAgentHandlers(handle: HandlerRegistrar, services: AgentServices): void {
  // Rejections surface inline in the composer, so the promise is returned
  // rather than swallowed — a message the host could not run must not render
  // as sent.
  handle("sendAgentCommand", (command) => services.runner.send(command));

  handle("getAgentHistory", () => services.chat.history());
  handle("listChatSessions", () => services.chat.sessions());
  handle("readChatSession", ({ id }) => services.chat.read(id));

  /**
   * The chat's inline "Re-authenticate" link.
   *
   * There is no interactive login to re-run from here: the credential is sealed
   * in this object and the user is on the other side of a socket. So this
   * FORCES a token refresh, which is the failure this link actually recovers
   * from — an access token the provider revoked or expired past its cached
   * lifetime. A refresh that fails says to reconnect, which is the only thing
   * left to do.
   */
  handle("reauthenticate", async () => {
    const choice = services.providers.choose();
    if (!choice.ok) return { ok: false as const, error: choice.error };
    const minted = await services.providers.mintAccessToken(choice.entry);
    if (minted.ok) return { ok: true as const };
    return {
      ok: false as const,
      error: `${choice.entry.label} could not be refreshed (${minted.error}). Connect it again in Settings → AI.`,
    };
  });

  handle("resolveAgentConfirmation", ({ id, confirmed }) => {
    services.runner.resolveConfirmation(id, confirmed);
  });

  // ---- the AI provider ------------------------------------------------------

  handle("getAiProviderSettings", () => services.providers.settings());

  handle("setAiProviderConfig", (patch) => {
    const settings = services.providers.setSelection(patch);
    services.announce();
    return settings;
  });

  // Every refusal `startAuthorization` can reach — an unknown provider, one
  // that has nothing to connect to, one this deployment configured no OAuth app
  // for — comes back as a VALUE the client renders. `ok: true` therefore means
  // exactly one thing: a verifier is parked and the user has somewhere to go.
  handle("connectAiProvider", async ({ provider }) => {
    const started = await startAuthorization(
      services.env,
      services.userId,
      provider,
      services.origin(),
    );
    if ("error" in started) return { ok: false as const, error: started.error };
    services.credentials.putPending(started.pending);
    return { ok: true as const, authorizeUrl: started.authorizeUrl };
  });

  handle("disconnectAiProvider", ({ provider }) => {
    const settings = services.providers.disconnect(provider);
    services.announce();
    return settings;
  });
}
