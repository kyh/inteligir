// ---------------------------------------------------------------------------
// Tools, as this image understands them — a name, a schema and a promise.
//
// THE CONTAINER IMPLEMENTS NO GRANTED TOOL AND HOLDS NO POLICY. Every tool the
// Worker declares in the boot payload is a RELAY: the model calls it, the call
// is reported to the Durable Object, and the object's own executor answers.
// That is what keeps the grant table (@repo/bridge/agent-grants) the single
// authority over what the agent may do — an image that carried its own
// implementations could grant a capability the table never declared, and a
// destructive proposal's confirmation could be skipped by whoever built the
// image rather than by the user.
//
// `ContainerTool` is pi-free on purpose. The harness quarantine (./pi) is the
// only place allowed to name `@earendil-works/pi-*`, so this is the vocabulary
// the rest of the daemon composes tools in and `pi/session.ts` adapts into pi's
// registry. The browser tool (./browser-tool) is the one local implementation,
// and it reaches Cloudflare rather than the vault.
// ---------------------------------------------------------------------------

import type { ContainerToolSpec } from "./protocol";
import type { Reporter } from "./reporter";

/**
 * What a tool answers with.
 *
 * `isError` is a VALUE here and a throw at pi's boundary (pi signals a failed
 * tool by rejecting), so the adapter converts. Keeping it a value on this side
 * means a relayed error — which is an ordinary answer the object computed, not
 * an exception anything threw — never travels as one.
 */
export type ContainerToolResult = {
  readonly isError: boolean;
  readonly text: string;
  /** Base64 image the model should see alongside the text. Only the browser
   * tool's screenshot sets it; a relayed result is text by construction. */
  readonly image?: { readonly data: string; readonly mimeType: string };
};

export type ContainerTool = {
  readonly name: string;
  readonly description: string;
  /**
   * The tool's parameter schema as it arrived on the wire: a serialized
   * TypeBox schema, i.e. a plain JSON-schema object. It is handed to pi
   * unexamined — the object re-validates every call against the schema it
   * declared, so a container-side check would be a second opinion nobody
   * consults.
   */
  readonly parameters: Record<string, unknown>;
  execute(args: unknown, signal: AbortSignal | undefined): Promise<ContainerToolResult>;
};

export type RelayDeps = {
  readonly reporter: Reporter;
  /** The turn the call belongs to. A function because a tool outlives the turn
   * it was built for: the pi session is created once per boot and the same
   * registry serves every turn it runs. */
  readonly currentTurnId: () => string | null;
};

/**
 * Adapt the boot payload's declared tools into relays.
 *
 * A spec whose schema is not an object is refused rather than dropped: pi hands
 * the schema to the provider verbatim, and a tool that reaches the model with a
 * malformed schema fails at the provider with a message about neither the tool
 * nor the deployment.
 */
export function hostRelayTools(
  specs: readonly ContainerToolSpec[],
  deps: RelayDeps,
): { ok: true; tools: ContainerTool[] } | { ok: false; error: string } {
  const tools: ContainerTool[] = [];
  for (const spec of specs) {
    const parameters = spec.parameters;
    if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
      return {
        ok: false,
        error: `tool "${spec.name}" declared a parameter schema that is not an object`,
      };
    }
    tools.push({
      name: spec.name,
      description: spec.description,
      parameters: { ...parameters },
      execute: (args, signal) => relay(deps, spec.name, args, signal),
    });
  }
  return { ok: true, tools };
}

async function relay(
  deps: RelayDeps,
  name: string,
  args: unknown,
  signal: AbortSignal | undefined,
): Promise<ContainerToolResult> {
  const turnId = deps.currentTurnId();
  if (turnId === null) {
    // Unreachable through pi — tools only execute inside a turn — but a tool
    // that answered with a report addressed to no turn would be silently
    // dropped by the object, and silence is the worst result a tool can give.
    return { isError: true, text: `${name} was called outside a turn` };
  }
  const reply = await deps.reporter.send({ kind: "tool", turnId, name, args }, signal);
  if (reply === null) {
    return {
      isError: true,
      text: `${name} could not reach the host. The result is unknown — do not assume it did or did not happen.`,
    };
  }
  if (reply.kind !== "tool") {
    return { isError: true, text: `${name} got a ${reply.kind} answer from the host` };
  }
  return { isError: reply.isError, text: reply.text };
}
