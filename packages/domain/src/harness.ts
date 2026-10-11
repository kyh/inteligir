import { z } from "zod";

// claude first: every list of harnesses reads in this order.
export const HARNESS_IDS = ["claude", "codex"] as const;
export const harnessIdSchema = z.enum(HARNESS_IDS);
export type HarnessId = z.infer<typeof harnessIdSchema>;

// what a person reads of a harness. vendorApp is the vendor's own app on this Mac, which keeps its
// sign-in in the same store, so a sign-out here signs it out too.
interface HarnessNames {
  displayName: string;
  vendorApp: string;
}

export const HARNESS_NAMES = {
  claude: { displayName: "Claude", vendorApp: "Claude Code" },
  codex: { displayName: "ChatGPT", vendorApp: "Codex" },
} as const satisfies Record<HarnessId, HarnessNames>;

// a thread's provider id as its row and its log hold it: those stay open, since another device's
// newer build can start a thread on a harness this build does not ship.
export type ThreadHarness = { kind: "known"; id: HarnessId } | { kind: "unknown"; id: string };

export const parseHarnessId = (id: string): ThreadHarness => {
  const parsed = harnessIdSchema.safeParse(id);
  return parsed.success ? { id: parsed.data, kind: "known" } : { id, kind: "unknown" };
};
