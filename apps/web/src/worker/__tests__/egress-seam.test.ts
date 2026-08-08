// ---------------------------------------------------------------------------
// The credential seam's installation, which nothing else in this deployment
// ever reads.
//
// `AgentSandbox.outboundByHost` is a static ACCESSOR on the SDK's base class,
// backed by a registry keyed on the class's own name. Assigning it is the whole
// installation: nothing here calls the handlers, and the Worker never asks
// whether they are there. So an assignment that missed the setter leaves a
// container whose provider requests still leave (the firewall allows those
// hosts) carrying the PLACEHOLDER key — a seam that disappeared rather than
// failed, whose only symptom is a model that will not answer.
//
// The module refuses to load if the readback fails, which is what makes it
// loud. This suite is the other half: it pins WHICH hosts must be covered — the
// providers whose requests carry a token this Worker owns — and that the entry
// exports the class the SDK looks up by name. `tools/repo-guards` checks the
// deployed entry, which this pool cannot import.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import * as entry from "../index";
import { AgentSandbox } from "../agent/sandbox-class";
import { allProviders } from "../agent/provider-catalog";

/** Every provider the interceptor stands in front of. A provider needing no
 * auth has no credential to inject and is deliberately absent. */
function intercepted(): string[] {
  return allProviders()
    .filter((provider) => provider.requiresAuth)
    .map((provider) => provider.apiHost);
}

describe("the sandbox's outbound credential seam", () => {
  it("installs a handler for every provider whose requests carry a credential", () => {
    const installed = AgentSandbox.outboundByHost;
    expect(installed, "the static accessor did not take the assignment").toBeDefined();
    expect(Object.keys(installed ?? {}).toSorted()).toEqual(intercepted().toSorted());
  });

  it("keeps the class name the registry is keyed on", () => {
    // The SDK stores the handlers under the class's own `name` and looks them
    // up again by the instance's — and wrangler.jsonc binds the same string.
    // A renamed class is a lookup that finds nothing.
    expect(AgentSandbox.name).toBe("AgentSandbox");
  });

  it("exports what the SDK resolves out of the entry", () => {
    // `ContainerProxy` is the WorkerEntrypoint the SDK constructs interception
    // fetchers from, by name, off `ctx.exports`.
    expect(typeof entry.ContainerProxy).toBe("function");
    expect(entry.AgentSandbox).toBe(AgentSandbox);
  });
});
