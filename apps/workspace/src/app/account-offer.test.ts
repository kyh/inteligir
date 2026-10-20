import type { VaultStatusResponse } from "@repo/contract/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { accountOffer } from "./account-offer";

const NO_REMOTE: VaultStatusResponse = {
  conflicts: [],
  device: "Kai's MacBook",
  externalSync: null,
  lastError: null,
  lastSyncAt: null,
  tooLarge: { count: 0, files: [] },
  state: "no-remote",
};

const withRemote = (remoteSource: "account" | "explicit" | "pinned"): VaultStatusResponse => ({
  ...NO_REMOTE,
  remote: "https://example.com/vault.git",
  remoteSource,
  state: "clean",
});

const BACK_UP =
  "An account backs up your library and brings it to your other Macs and your iPhone.";
const OWN_SERVER =
  "This library syncs with a server of its own, so an account does nothing for it unless you switch it to your account in Settings › Advanced.";

describe("what an account offers these notes", () => {
  it.each<[string, VaultStatusResponse]>([
    ["syncing nowhere yet", NO_REMOTE],
    ["syncing through the account", withRemote("account")],
  ])("offers one for notes %s", (_where, vault) => {
    expect(accountOffer(vault)).toEqual({
      kind: "offer",
      lead: BACK_UP,
      title: "Back up your library",
    });
  });

  it.each<[string, VaultStatusResponse]>([
    ["syncing to a server of their own", withRemote("explicit")],
    ["pinned to a server", withRemote("pinned")],
  ])("offers none for notes %s, and says so", (_where, vault) => {
    expect(accountOffer(vault)).toEqual({ kind: "none", lead: OWN_SERVER });
  });

  it("says the service that already syncs the folder, and that an account does nothing for it", () => {
    expect(accountOffer({ ...NO_REMOTE, externalSync: { kind: "dropbox" } })).toEqual({
      kind: "none",
      lead: "Dropbox already syncs this library, so an account does nothing for it: the library stays there, and your iPhone can't show it.",
    });
  });
});
