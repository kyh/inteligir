// ---------------------------------------------------------------------------
// The Sandbox subclass — one container per user, with its egress nailed shut.
//
// Confinement is `enableInternet = false` plus an allowlist, and it is worth
// being exact about which layer does what, because the two are often conflated:
//
//   • `allowedHosts` is the FIREWALL. It is what decides whether a packet
//     leaves at all, on any port.
//   • `outboundByHost` is the CREDENTIAL SEAM. It intercepts HTTP and HTTPS on
//     ports 80 and 443 only, and its job is to put a real provider token on a
//     request the container sent with a placeholder (./egress). Traffic on any
//     other port is never routed through it, so it is not, and must not be
//     described as, a security boundary.
//
// The allowlist is deliberately short: the provider APIs, and the Worker the
// container reports to. Everything the agent needs from the outside world it
// asks the Worker for. A `bash curl` to anywhere else does not leave.
//
// The two exceptions are named rather than hidden. `browser` reaches Cloudflare
// Browser Run, and `bash` may want a package registry; both are opt-in through
// `AGENT_EXTRA_ALLOWED_HOSTS` so a deployment that wants them says so.
//
// BOTH HALVES OF THE SEAM ARE RESOLVED BY NAME, and both are checked rather
// than trusted. `ContainerProxy` is re-exported from the Worker entry beside
// this class because the SDK constructs outbound-interception fetchers that
// reference it there — `tools/repo-guards/src/container-exports.test.ts` reads
// every entry for it, including the deployed one the Workers suite cannot load.
// The handler table below is read back after it is assigned. Either failure is
// silent otherwise: the firewall still allows the provider hosts, the requests
// still leave, and the only symptom is a container spending a placeholder key.
// ---------------------------------------------------------------------------

import { Sandbox } from "@cloudflare/sandbox";

import { verifiedTokenAddress } from "./agent-crypto";
import { userHostName } from "../host/host-address";
import { injectProviderCredential } from "./egress";
import { allProviders } from "./provider-catalog";

/**
 * How long an idle container survives before the platform reclaims it.
 *
 * The default, and left there on purpose. `keepAlive` would bill provisioned
 * memory and disk for the container's whole wall-clock life and make an
 * explicit `destroy()` mandatory; a wake is cheap here because the image
 * carries everything and the vault is re-materialized from the manifest.
 */
const SLEEP_AFTER = "10m";

/** Hosts every deployment allows: the provider APIs the interceptor stands in
 * front of, plus whatever host this Worker is reached on. */
function baseAllowedHosts(env: Env): string[] {
  const hosts = allProviders()
    .filter((entry) => entry.requiresAuth)
    .map((entry) => entry.apiHost);
  if (env.PUBLIC_HOST !== undefined && env.PUBLIC_HOST !== "") {
    hosts.push(env.PUBLIC_HOST);
  }
  const extra = env.AGENT_EXTRA_ALLOWED_HOSTS;
  if (extra !== undefined) {
    for (const host of extra.split(",").map((value) => value.trim())) {
      if (host !== "") hosts.push(host);
    }
  }
  return [...new Set(hosts)];
}

export class AgentSandbox extends Sandbox<Env> {
  override sleepAfter = SLEEP_AFTER;
  override enableInternet = false;
  override allowedHosts = baseAllowedHosts(this.env);
}

/**
 * Put a live provider credential on one outbound request.
 *
 * The Worker half of the seam: it runs HERE, where the sealed refresh token is,
 * and forwards to the provider with a token the container never held. The
 * identity check and the mint both happen inside the user's own Durable Object,
 * so a token can only ever be minted for the account that owns the container
 * that asked.
 */
async function providerEgress(request: Request, env: Env): Promise<Response> {
  const rewritten = await injectProviderCredential(request, async (identity, provider) => {
    // The token NAMES the object to ask, and it has to be one this deployment
    // signed before it may name anything: an object comes into existence the
    // moment it is addressed. That object then re-verifies against its own name
    // and its own live boot before it mints. The Worker addresses, the object
    // decides — the same split the socket and asset routes use.
    const address = await verifiedTokenAddress(env.BETTER_AUTH_SECRET, "report", identity);
    if (address === null)
      return { error: "the sandbox identity is not a token this Worker minted" };
    const host = env.UserHost.getByName(userHostName(address));
    const minted = await host.mintProviderAccessToken(identity, provider.id);
    return minted.ok ? { token: minted.token } : { error: minted.error };
  });
  if (rewritten instanceof Response) return rewritten;
  return fetch(rewritten);
}

/** The hosts the credential seam must stand in front of: every provider whose
 * requests carry a token this Worker owns. */
function interceptedHosts(): string[] {
  return allProviders()
    .filter((entry) => entry.requiresAuth)
    .map((entry) => entry.apiHost);
}

// Assigned rather than declared as `static override outboundByHost = …`: the
// base class exposes it as a static ACCESSOR, and a static field declaration
// under `useDefineForClassFields` defines an own property instead of calling
// the setter — the interception would never install, and nothing would say so.
AgentSandbox.outboundByHost = Object.fromEntries(
  interceptedHosts().map((host) => [host, providerEgress]),
);

// READ IT BACK, at module scope, and refuse to be a Worker if it did not take.
//
// The SDK keeps these handlers in a registry the setter writes and a getter
// reads; nothing else in this deployment ever asks for them, so an assignment
// that missed the setter — the field-declaration hazard above, a base class
// that stops exposing the accessor — leaves a container whose provider requests
// go out carrying the PLACEHOLDER key. That failure is silent by construction:
// the firewall still allows the host, the request still leaves, and the only
// symptom is a model that will not answer. Throwing here makes it a boot error
// on a code path every test loads, which is the loudest place a fact the type
// system cannot express can be checked.
for (const host of interceptedHosts()) {
  if (AgentSandbox.outboundByHost?.[host] !== providerEgress) {
    throw new Error(
      `the sandbox's outbound interception did not install for ${host} — ` +
        "the provider credential seam is not in place",
    );
  }
}
