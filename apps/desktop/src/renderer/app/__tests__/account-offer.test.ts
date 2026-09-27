import type { VaultStatusResponse } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { accountOffer } from "../account-offer";

const NO_REMOTE: VaultStatusResponse = {
  conflicts: [],
  device: "Kai's MacBook",
  externalSync: null,
  lastError: null,
  lastSyncAt: null,
  state: "no-remote",
};

const withRemote = (remoteSource: "account" | "explicit" | "pinned"): VaultStatusResponse => ({
  ...NO_REMOTE,
  remote: "https://example.com/vault.git",
  remoteSource,
  state: "clean",
});

const BACK_UP =
  "An account backs up your notes and brings them to your other Macs and your iPhone.";
const KEEP_SYNCING =
  "These notes keep syncing where they already do. An account carries your conversations with the agent to your other devices.";

describe("what an account offers these notes", () => {
  it.each<[string, VaultStatusResponse, string, string]>([
    ["syncing nowhere yet", NO_REMOTE, "Back up your notes", BACK_UP],
    ["syncing through the account", withRemote("account"), "Back up your notes", BACK_UP],
    [
      "syncing to a server of their own",
      withRemote("explicit"),
      "Create your account",
      KEEP_SYNCING,
    ],
    ["pinned to a server", withRemote("pinned"), "Create your account", KEEP_SYNCING],
  ])("for notes %s", (_where, vault, title, lead) => {
    expect(accountOffer(vault)).toEqual({ lead, title });
  });

  it("says the service that already syncs the folder, and what the account still carries", () => {
    const offer = accountOffer({ ...NO_REMOTE, externalSync: { kind: "dropbox" } });
    expect(offer.title).toBe("Create your account");
    expect(offer.lead).toBe(
      "Dropbox already syncs these notes, and your phone won't show them. An account still carries your conversations with the agent to your other Macs.",
    );
  });
});
