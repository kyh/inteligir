// Settings → Agents: detect + guide (issue #588). Per harness — is the vendor
// CLI on PATH, does a login credential exist, and the exact command that logs
// in. Nothing here installs anything: the ACP adapters ship WITH the app, and
// the vendor CLIs (and their logins) are the user's own.

import type { AgentsStatusResponse, HarnessProbe } from "@repo/server-contract/agents";
import { useQuery } from "@tanstack/react-query";
import { unwrap } from "../api";
import { useWorkspace } from "../workspace-context";
import { SectionHeading } from "./settings-chrome";

function credentialSentence(probe: HarnessProbe): string {
  switch (probe.credentials) {
    case "present":
      return "Signed in.";
    case "unknown":
      return "Sign-in state unknown on this platform.";
    case "absent":
      return probe.cliPath === null
        ? "Not signed in."
        : `Not signed in — run: ${probe.loginCommand}`;
  }
}

function HarnessRow({ probe }: { probe: HarnessProbe }) {
  const ready = probe.cliPath !== null && probe.credentials === "present";
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{probe.displayName}</p>
        <p className="text-xs text-muted-foreground">
          {probe.cliPath === null
            ? `The ${probe.displayName} CLI was not found on PATH — install it, then sign in with: ${probe.loginCommand}`
            : credentialSentence(probe)}
        </p>
      </div>
      <span
        className={
          ready
            ? "shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600"
            : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        }
      >
        {ready ? "ready" : probe.cliPath === null ? "not installed" : "needs sign-in"}
      </span>
    </div>
  );
}

export function AgentsSection() {
  const { api } = useWorkspace();
  const statusQuery = useQuery<AgentsStatusResponse>({
    queryKey: ["agents-status"],
    queryFn: async () => unwrap(await api.agents.status.$get()),
    // Login state changes outside this app; a dialog mount re-probes.
    staleTime: 0,
  });

  return (
    <section>
      <SectionHeading>Agents</SectionHeading>
      <p className="text-xs text-muted-foreground">
        Actions run on your own agent subscriptions. The protocol adapters ship with the app; the
        CLIs and their sign-ins are yours.
      </p>
      <div className="mt-2 divide-y divide-line">
        {(statusQuery.data?.harnesses ?? []).map((probe) => (
          <HarnessRow key={probe.id} probe={probe} />
        ))}
      </div>
    </section>
  );
}
