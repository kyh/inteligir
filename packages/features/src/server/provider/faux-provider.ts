// ---------------------------------------------------------------------------
// Faux provider — pi-ai's deterministic, login-free stub provider, registered
// behind the INTELIGIR_FAUX_AGENT dev flag. With the flag set the host FORCES
// the selection to faux (provider-service), so a headless session can drive a
// full agent turn with zero OAuth and zero network. `setFauxResponses` is the
// scripting seam the E2E harness uses to stage exact assistant messages
// (including tool calls, via pi-ai's fauxToolCall/fauxAssistantMessage
// helpers). Production never sees any of this unless the flag is set.
// ---------------------------------------------------------------------------

import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import type {
  AssistantMessage,
  Context,
  FauxContentBlock,
  FauxProviderRegistration,
  FauxResponseFactory,
  FauxResponseStep,
} from "@mariozechner/pi-ai";
import type { FauxAgentScript } from "@repo/features/ipc-registry";

export const FAUX_PROVIDER_ID = "faux";

/** Dev flag gating everything faux. Read live (not cached) so tests can flip
 * it per case. */
export function isFauxAgentEnabled(): boolean {
  return process.env["INTELIGIR_FAUX_AGENT"] === "1";
}

let registration: FauxProviderRegistration | null = null;

/** Last user text in the context, for the default echo response. */
function lastUserText(context: Context): string {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (!message || message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    return message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

// The registration's response list is a consumed QUEUE (one shift per turn),
// so the default echo re-appends itself before answering — every unscripted
// turn gets a deterministic reply instead of draining into pi-ai's "No more
// faux responses queued" error. setFauxResponses replaces the whole queue,
// which drops the loop — exactly what a scripted E2E run wants.
function selfRefillingEcho(reg: FauxProviderRegistration): FauxResponseFactory {
  const echo: FauxResponseFactory = (context) => {
    reg.appendResponses([echo]);
    const text = lastUserText(context);
    return fauxAssistantMessage(text === "" ? "[faux] ok" : `[faux] ${text}`);
  };
  return echo;
}

/** Register the faux provider (idempotent) with a fixed `api`/`provider` id
 * and the default self-refilling echo script. Faux models resolve through the
 * returned registration, never pi-ai's static registry (see pi/model.ts
 * resolveModelSelection and the catalog's listProviderModels). */
export function ensureFauxProvider(): FauxProviderRegistration {
  if (!registration) {
    const next = registerFauxProvider({ api: FAUX_PROVIDER_ID, provider: FAUX_PROVIDER_ID });
    next.setResponses([selfRefillingEcho(next)]);
    registration = next;
  }
  return registration;
}

/** THE response-scripting seam (the E2E harness depends on it): replace the
 * pending queue with an exact sequence of steps — `fauxAssistantMessage`
 * values or factories, one consumed per turn. Once the script drains, further
 * turns surface pi-ai's queue-empty error (a scripted run should never
 * over-run its script silently). */
export function setFauxResponses(steps: FauxResponseStep[]): void {
  ensureFauxProvider().setResponses([...steps]);
}

/** Restore the default self-refilling echo (e.g. between scripted E2E cases). */
export function resetFauxResponses(): void {
  const reg = ensureFauxProvider();
  reg.setResponses([selfRefillingEcho(reg)]);
}

/** The setFauxAgentScript Bridge channel's application (#461 Phase 4b): map
 * wire steps onto pi-ai faux messages — text plus tool calls, with stopReason
 * "toolUse" when calls are present so the agent loop executes them and then
 * consumes the NEXT step for its follow-up turn. Empty steps = back to the
 * echo, so a drive can restore the default without restarting the host. */
export function applyFauxAgentScript(script: FauxAgentScript): void {
  if (script.steps.length === 0) {
    resetFauxResponses();
    return;
  }
  setFauxResponses(script.steps.map(scriptStepMessage));
}

function scriptStepMessage(step: FauxAgentScript["steps"][number]): AssistantMessage {
  const blocks: FauxContentBlock[] = [];
  if (step.text !== undefined && step.text !== "") blocks.push(fauxText(step.text));
  const calls = step.toolCalls ?? [];
  for (const call of calls) blocks.push(fauxToolCall(call.name, call.arguments));
  return fauxAssistantMessage(blocks, calls.length > 0 ? { stopReason: "toolUse" } : {});
}
