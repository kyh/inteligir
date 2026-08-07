// ---------------------------------------------------------------------------
// The agent's twelve Bridge handlers, over this object's own runner.
//
// Everything here is a thin await around ./agent-runner, ./chat-store and
// ./provider-credentials — the composition that could differ between hosts is
// theirs. What this module owns is the SHAPE the registry promises: which
// refusals are values and which are throws, and what a client sees when a
// capability this deployment cannot offer is asked for.
//
// `connectAiProvider` is the one channel whose meaning genuinely differs from
// the desktop's, and the registry now says so: a host with no screen in common
// with its user cannot open a browser, so it answers with the URL the client
// must send them to. The desktop opens the browser itself and omits it.
// ---------------------------------------------------------------------------

import type { AiProviderSettings } from "@repo/bridge/ai-provider";
import type { HandlerRegistrar } from "../host/handler-registry";
import { unavailable } from "../host/handler-registry";

import type { AgentLane, AgentRunner } from "./agent-runner";
import type { ChatStore } from "./chat-store";
import type { FakeSandbox } from "./fake-sandbox";
import {
  effectiveSelection,
  offeredProviders,
  providerEntry,
  providerInfo,
  resolveModelId,
} from "./provider-catalog";
import type { ProviderCredentials } from "./provider-credentials";
import { startAuthorization } from "./provider-oauth";

export type AgentServices = {
  readonly env: Env;
  readonly userId: string;
  readonly runner: AgentRunner;
  readonly chat: ChatStore;
  readonly credentials: ProviderCredentials;
  /** The origin this object is reached on, for building a redirect URI. Read
   * off the socket that authenticated, because a Durable Object has no notion
   * of the hostname its Worker was called at. */
  readonly origin: () => string;
  /** A lane's scripted container, where one is running. `null` on the real
   * runtime, which is what makes the script channel fail closed. */
  readonly scripted: (lane: AgentLane) => FakeSandbox | null;
};

export function registerAgentHandlers(handle: HandlerRegistrar, services: AgentServices): void {
  // Rejections surface in the composer inline (the desktop's
  // sendCommandSurfacingFailure), so the promise is returned rather than
  // swallowed — a message the host could not run must not render as sent.
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
    const selection = services.credentials.selection();
    const entry = selection === null ? null : providerEntry(selection.provider);
    if (entry === null) return { ok: false as const, error: "No AI provider is selected." };
    const minted = await services.credentials.mintAccessToken(entry);
    if (minted.ok) return { ok: true as const };
    return {
      ok: false as const,
      error: `${entry.label} could not be refreshed (${minted.error}). Connect it again in Settings → AI.`,
    };
  });

  // The scripted runtime's response queue — the cloud twin of the desktop's
  // faux-agent script channel, and fail-closed the same way: a deployment
  // running a real container has no queue to script.
  //
  // BOTH lanes take the script. A drive that delegates a checkbox needs the
  // unattended container to answer too, and the caller has no way to name a
  // lane — nor should it, since the lane is a fact of how a turn was started.
  handle("setFauxAgentScript", (script) => {
    const chat = services.scripted("chat");
    if (chat === null) throw new Error("setFauxAgentScript requires AGENT_RUNTIME=scripted");
    chat.setScript(script);
    services.scripted("background")?.setScript(script);
  });

  handle("getAgentSystemPrompt", () => services.runner.systemPrompt());

  handle("resolveAgentConfirmation", ({ id, confirmed }) => {
    services.runner.resolveConfirmation(id, confirmed);
  });

  // ---- the AI provider ------------------------------------------------------

  handle("getAiProviderSettings", () => providerSettings(services));

  handle("setAiProviderConfig", (patch) => {
    const current = currentSelection(services);
    const providerId = patch.provider ?? current.provider;
    const entry = providerEntry(providerId);
    if (entry === null) throw new Error(`There is no provider called ${providerId}.`);
    // A provider SWITCH defaults the model: the model ids are per-provider, so
    // carrying the old one over would name a model the new provider has never
    // heard of.
    const requested =
      patch.provider === undefined ? (patch.modelId ?? current.modelId) : patch.modelId;
    services.credentials.setSelection({
      provider: entry.id,
      modelId: resolveModelId(entry, requested),
    });
    return providerSettings(services);
  });

  handle("connectAiProvider", async ({ provider }) => {
    const entry = providerEntry(provider);
    if (entry === null)
      return { ok: false as const, error: `There is no provider called ${provider}.` };
    if (!entry.requiresAuth) return { ok: true as const };
    const started = await startAuthorization(
      services.env,
      services.userId,
      provider,
      services.origin(),
    );
    if ("error" in started) return { ok: false as const, error: started.error };
    services.credentials.putPending(started.pending);
    // Not connected YET: the client sends the user here, and the callback
    // completes the exchange inside this object.
    return { ok: true as const, authorizeUrl: started.authorizeUrl };
  });

  handle("disconnectAiProvider", ({ provider }) => {
    services.credentials.disconnect(provider);
    return providerSettings(services);
  });
}

/** The Settings AI section renders exclusively from this snapshot. */
function providerSettings(services: AgentServices): AiProviderSettings {
  return {
    selected: currentSelection(services),
    providers: offeredProviders(services.env).map((entry) =>
      providerInfo(entry, services.credentials.connected(entry.id)),
    ),
  };
}

/**
 * The selection this host will actually run — `effectiveSelection`, which is
 * the same resolution a turn goes through, so what Settings shows and what a
 * message runs on can never disagree.
 *
 * A deployment that configured no OAuth app and runs the real container offers
 * NOTHING, and that is where the refusal belongs — an empty menu with a
 * selection pointing at a provider that is not in it would render as a broken
 * Settings page rather than an unconfigured one.
 */
function currentSelection(services: AgentServices): { provider: string; modelId: string } {
  const selected = effectiveSelection(services.env, services.credentials.selection());
  if (selected === null) {
    unavailable("any AI provider (none is configured on this deployment)");
  }
  return { provider: selected.provider, modelId: selected.modelId };
}
