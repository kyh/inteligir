import { base64FromBytes } from "@repo/contract/cloud/bytes";
import { describe, expect, it } from "vitest";

import { mintSocketTicket, readSocketTicket, SOCKET_TICKET_TTL_MS } from "./socket-ticket";

const SECRET = "a secret only the Worker holds";
const NOW = Date.UTC(2026, 9, 1);
const CLAIM = { accountId: "account-1", holder: { id: "device-1", kind: "device" } } as const;

const base64Url = (text: string): string =>
  base64FromBytes(new TextEncoder().encode(text))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

describe("the socket's ticket", () => {
  it("names the account and the credential that asked, for a minute", async () => {
    const { expiresAt, ticket } = await mintSocketTicket(SECRET, CLAIM, NOW);
    expect(expiresAt).toBe(NOW + SOCKET_TICKET_TTL_MS);
    expect(await readSocketTicket(SECRET, ticket, NOW + 59_999)).toEqual({ ...CLAIM, expiresAt });
    expect(await readSocketTicket(SECRET, ticket, expiresAt)).toBeNull();
  });

  it("is refused once anything in it changed, or under another secret", async () => {
    const { ticket } = await mintSocketTicket(SECRET, CLAIM, NOW);
    const [, signature] = ticket.split(".");
    const forged = base64Url(
      JSON.stringify({ ...CLAIM, accountId: "account-2", expiresAt: NOW + SOCKET_TICKET_TTL_MS }),
    );
    expect(await readSocketTicket(SECRET, `${forged}.${signature ?? ""}`, NOW)).toBeNull();
    expect(await readSocketTicket("another secret", ticket, NOW)).toBeNull();
    for (const mangled of ["", "nodot", `${ticket}.extra`, `${ticket}x`, "a.b", "!!.??"]) {
      expect(await readSocketTicket(SECRET, mangled, NOW)).toBeNull();
    }
  });
});
