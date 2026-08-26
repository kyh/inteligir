import {
  VAULT_API_PATHS,
  VAULT_FILE_MAX_BYTES,
  vaultFileResponseSchema,
  vaultTreeResponseSchema,
} from "@repo/api/cloud/vault/vault-schema";
import { cloudErrorSchema } from "@repo/api/cloud/errors";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deviceHeaders, ORIGIN, pairDevice, signUpUser } from "./cloud-helpers";
import { pushVaultFiles, ZERO_OID } from "./git-pack";

// The vault READ rows over content a real push put there: paging, the pinned
// ref, the ceilings, and the two refusals that keep this wire text-only.

const TREE = `${ORIGIN}${VAULT_API_PATHS.tree}`;
const FILE = `${ORIGIN}${VAULT_API_PATHS.file}`;

async function errorCode(response: Response): Promise<string> {
  return cloudErrorSchema.parse(await response.json()).error.code;
}

async function pairAndPush(email: string, files: Parameters<typeof pushVaultFiles>[2]) {
  const { bearer } = await signUpUser(email);
  const { credential } = await pairDevice(bearer, "Laptop");
  const pushed = await pushVaultFiles(credential, "vault: initialize", files, ZERO_OID);
  expect(pushed.response.status).toBe(200);
  expect(await pushed.response.text()).toContain("unpack ok");
  return { credential, commit: pushed.commit };
}

describe("vault read rows", () => {
  it("refuses the wire without a credential", async () => {
    const tree = await SELF.fetch(TREE);
    expect(tree.status).toBe(401);
    expect(await errorCode(tree)).toBe("unauthorized");
  });

  it("answers not-found for an account with no hosted vault — without creating one", async () => {
    const { bearer } = await signUpUser("vault-read-none@example.test");
    const { credential } = await pairDevice(bearer, "Laptop");
    const tree = await SELF.fetch(TREE, { headers: deviceHeaders(credential) });
    expect(tree.status).toBe(404);
    expect(await errorCode(tree)).toBe("not-found");
  });

  it("lists the pushed tree flat, and pages it by path cursor at one commit", async () => {
    const { credential, commit } = await pairAndPush("vault-read-tree@example.test", [
      { path: "a.md", content: "# a\n" },
      { path: "notes/b.md", content: "# b\n" },
      { path: "notes/deep/c.md", content: "# c\n" },
    ]);

    const first = await SELF.fetch(`${TREE}?limit=2`, { headers: deviceHeaders(credential) });
    expect(first.status).toBe(200);
    const pageOne = vaultTreeResponseSchema.parse(await first.json());
    expect(pageOne.commit).toBe(commit);
    expect(pageOne.entries.map((entry) => entry.path)).toEqual(["a.md", "notes/b.md"]);
    expect(pageOne.next).toBe("notes/b.md");

    const second = await SELF.fetch(
      `${TREE}?limit=2&ref=${pageOne.commit}&after=${encodeURIComponent(pageOne.next ?? "")}`,
      { headers: deviceHeaders(credential) },
    );
    const pageTwo = vaultTreeResponseSchema.parse(await second.json());
    expect(pageTwo.commit).toBe(commit);
    expect(pageTwo.entries.map((entry) => entry.path)).toEqual(["notes/deep/c.md"]);
    expect(pageTwo.next).toBeNull();
  });

  it("answers a file's text with the commit and blob oid", async () => {
    const { credential, commit } = await pairAndPush("vault-read-file@example.test", [
      { path: "notes/hello.md", content: "# hello\n\nfrom the vault\n" },
    ]);
    const response = await SELF.fetch(`${FILE}?path=${encodeURIComponent("notes/hello.md")}`, {
      headers: deviceHeaders(credential),
    });
    expect(response.status).toBe(200);
    const file = vaultFileResponseSchema.parse(await response.json());
    expect(file.commit).toBe(commit);
    expect(file.path).toBe("notes/hello.md");
    expect(file.content).toBe("# hello\n\nfrom the vault\n");
    expect(file.oid).toMatch(/^[0-9a-f]{40}$/);
  });

  it("serves a filename holding a percent sign — git allows it, the cell decodes", async () => {
    const { credential } = await pairAndPush("vault-read-percent@example.test", [
      { path: "100%done.md", content: "# done\n" },
    ]);
    const response = await SELF.fetch(`${FILE}?path=${encodeURIComponent("100%done.md")}`, {
      headers: deviceHeaders(credential),
    });
    expect(response.status).toBe(200);
    expect(vaultFileResponseSchema.parse(await response.json()).content).toBe("# done\n");
    const tree = await SELF.fetch(TREE, { headers: deviceHeaders(credential) });
    expect(
      vaultTreeResponseSchema.parse(await tree.json()).entries.map((entry) => entry.path),
    ).toContain("100%done.md");
  });

  it("answers not-found for a path the revision does not carry", async () => {
    const { credential } = await pairAndPush("vault-read-miss@example.test", [
      { path: "a.md", content: "# a\n" },
    ]);
    const response = await SELF.fetch(`${FILE}?path=gone.md`, {
      headers: deviceHeaders(credential),
    });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("not-found");
  });

  it("keeps the wire text-only: binary refuses, and so does the byte ceiling", async () => {
    const invalidUtf8 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]);
    const huge = new Uint8Array(VAULT_FILE_MAX_BYTES + 1).fill(0x61);
    const { credential } = await pairAndPush("vault-read-binary@example.test", [
      { path: "image.png", content: invalidUtf8 },
      { path: "huge.md", content: huge },
    ]);

    const binary = await SELF.fetch(`${FILE}?path=image.png`, {
      headers: deviceHeaders(credential),
    });
    expect(binary.status).toBe(400);
    expect(await errorCode(binary)).toBe("bad-request");

    const oversize = await SELF.fetch(`${FILE}?path=huge.md`, {
      headers: deviceHeaders(credential),
    });
    expect(oversize.status).toBe(413);
    expect(await errorCode(oversize)).toBe("file-too-large");
  });

  it("keeps two users' vaults apart on the read wire too", async () => {
    const alpha = await pairAndPush("vault-read-alpha@example.test", [
      { path: "secret.md", content: "alpha's note\n" },
    ]);
    const beta = await signUpUser("vault-read-beta@example.test");
    const betaDevice = await pairDevice(beta.bearer, "Laptop");

    const asBeta = await SELF.fetch(`${FILE}?path=secret.md&ref=${alpha.commit}`, {
      headers: deviceHeaders(betaDevice.credential),
    });
    // Beta has no hosted vault at all; alpha's commit sha buys nothing.
    expect(asBeta.status).toBe(404);
  });

  it("refuses a malformed path at parse", async () => {
    const { credential } = await pairAndPush("vault-read-path@example.test", [
      { path: "a.md", content: "# a\n" },
    ]);
    for (const bad of ["../escape.md", "/rooted.md", "a//b.md"]) {
      const response = await SELF.fetch(`${FILE}?path=${encodeURIComponent(bad)}`, {
        headers: deviceHeaders(credential),
      });
      expect(response.status).toBe(400);
    }
  });
});
