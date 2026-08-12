// ---------------------------------------------------------------------------
// The AI provider lifecycle, in one place.
//
// "Which provider runs" is ONE question, and before this module seven readers
// answered it by recombining the catalog, the stored selection and the
// connection state themselves — so a turn could resolve it three times per
// message and Settings could disagree with the link beside the message.
// CLAUDE.md § Decisions states the rule ("ONE resolution decides which AI
// provider runs"); this is where it is enforced rather than restated.
//
// The seam is deliberately narrow: `credentials.selection()` is read HERE and
// nowhere else, so a new reader has to come through `turnFacts()` or `refusal()`
// and inherits the normalization (a stored selection naming a provider this
// deployment stopped offering falls back rather than refusing).
//
// What is NOT folded in is the OAuth round trip. Parking a PKCE verifier and
// redeeming it later is a different concern with its own module
// (./provider-oauth) and it reads no selection, so pulling it in would buy
// indirection and no invariant. It stays on ./provider-credentials.
// ---------------------------------------------------------------------------

import type { AiProviderSettings } from "@repo/bridge/ai-provider";

import { unavailable } from "../host/handler-registry";
import {
  chooseProvider,
  providerEntry,
  providerSettings,
  resolveModelId,
  type ProviderChoice,
  type ProviderEntry,
} from "./provider-catalog";
import type { MintResult, ProviderCredentials } from "./provider-credentials";

export type ProviderServiceDeps = {
  readonly env: Env;
  readonly credentials: ProviderCredentials;
};

/** The provider facts a turn is dispatched with, resolved once. Carrying the
 * modelId with the entry is the point: `bootPins` used to recompute it from the
 * raw selection and discard the one the choice had already resolved. */
export type TurnProvider = {
  readonly entry: ProviderEntry;
  readonly modelId: string;
};

export class ProviderService {
  private readonly deps: ProviderServiceDeps;

  constructor(deps: ProviderServiceDeps) {
    this.deps = deps;
  }

  /**
   * The one resolution. Every surface that needs to know which provider runs —
   * a chat turn, a delegation, a routine tick, the editor's ⌘J, ghost text —
   * asks this and nothing else.
   */
  choose(): ProviderChoice {
    return chooseProvider(this.deps.env, this.deps.credentials.selection(), (provider) =>
      this.deps.credentials.connected(provider),
    );
  }

  /**
   * The provider facts for one turn, or the ONE sentence saying why none can
   * run. A caller resolves this once and threads the result down to the boot,
   * so the facts the container is configured with are the facts the turn was
   * admitted on.
   */
  turnFacts():
    | { readonly ok: true; readonly provider: TurnProvider }
    | {
        readonly ok: false;
        readonly error: string;
      } {
    const choice = this.choose();
    if (!choice.ok) return { ok: false, error: choice.error };
    return { ok: true, provider: { entry: choice.entry, modelId: choice.modelId } };
  }

  /** Why no turn can run right now, or null. */
  refusal(): string | null {
    const choice = this.choose();
    return choice.ok ? null : choice.error;
  }

  /**
   * The Settings snapshot, built from the same resolution a turn goes through,
   * so what Settings shows and what a message runs on can never disagree.
   *
   * A deployment that configured no OAuth app and runs the real container
   * offers NOTHING, and that is where the refusal belongs — an empty menu with
   * a selection pointing at a provider not in it renders as a broken Settings
   * page rather than an unconfigured one.
   */
  settings(): AiProviderSettings {
    const snapshot = this.settingsOrNull();
    if (snapshot === null) {
      unavailable("any AI provider (none is configured on this deployment)");
    }
    return snapshot;
  }

  /** The same snapshot, TOTAL. The OAuth callback pushes it to whatever sockets
   * are open and must not turn a browser redirect into a 500 on a deployment
   * that offers nothing. */
  settingsOrNull(): AiProviderSettings | null {
    return providerSettings(this.deps.env, this.deps.credentials.selection(), (provider) =>
      this.deps.credentials.connected(provider),
    );
  }

  /** Record a selection. A provider SWITCH defaults the model: model ids are
   * per-provider, so carrying the old one over would name a model the new
   * provider has never heard of. */
  setSelection(patch: {
    readonly provider?: string;
    readonly modelId?: string;
  }): AiProviderSettings {
    const current = this.settings().selected;
    const providerId = patch.provider ?? current.provider;
    const entry = providerEntry(providerId);
    if (entry === null) throw new Error(`There is no provider called ${providerId}.`);
    const requested =
      patch.provider === undefined ? (patch.modelId ?? current.modelId) : patch.modelId;
    this.deps.credentials.setSelection({
      provider: entry.id,
      modelId: resolveModelId(entry, requested),
    });
    return this.settings();
  }

  disconnect(provider: string): AiProviderSettings {
    this.deps.credentials.disconnect(provider);
    return this.settings();
  }

  /**
   * A short-lived access token for `entry`.
   *
   * `requiresAuth: false` short-circuits to a placeholder inside
   * ./provider-credentials — that is what the scripted runtime's whole
   * login-free capability hangs on, so it is preserved rather than special-cased
   * here.
   */
  mintAccessToken(entry: ProviderEntry): Promise<MintResult> {
    return this.deps.credentials.mintAccessToken(entry);
  }

  /** Mint for a provider named by id — the cross-class path the Sandbox's
   * outbound interception reaches through `UserHost.mintProviderAccessToken`,
   * which holds an id off a request rather than a resolved entry. */
  mintAccessTokenFor(providerId: string): Promise<MintResult> {
    const entry = providerEntry(providerId);
    if (entry === null) {
      return Promise.resolve({ ok: false, error: `There is no provider called ${providerId}.` });
    }
    return this.mintAccessToken(entry);
  }
}
