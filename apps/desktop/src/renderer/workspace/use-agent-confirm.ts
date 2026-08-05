// The human half of the agent's destructive-confirmed tier
// (@repo/bridge/agent-grants): the host raises a proposal, this shows it, and
// the answer goes back on the reply channel.
//
// Every word on screen comes from the host's request — the renderer adds none
// of its own, so a note's contents can never write the dialog the user is
// agreeing to. Anything that goes wrong (a closed window, a thrown reply)
// leaves the proposal unanswered, and the host expires it as a decline.
//
// One shared dialog with the user's own deletes (confirm-vault-delete.ts):
// "the assistant wants to delete this" and "you clicked delete" deserve the
// same weight, and a second style of confirmation would teach the user that
// one of them matters less.

import { useEffect } from "react";

import { confirm } from "@repo/ui/components/confirm-dialog";

import { getBridge } from "@renderer/lib/bridge";

/** Mounted once inside the workspace. */
export function useAgentConfirm(): void {
  useEffect(() => {
    const bridge = getBridge();
    return bridge.onAgentConfirmationRequested((request) => {
      void (async () => {
        const confirmed = await confirm({
          title: request.title,
          body: request.detail,
          confirmLabel: request.confirmLabel,
          destructive: true,
        });
        try {
          await bridge.resolveAgentConfirmation({ id: request.id, confirmed });
        } catch (err) {
          console.error("[agent-confirm] reply failed:", err);
        }
      })();
    });
  }, []);
}
