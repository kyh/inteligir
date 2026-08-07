// ---------------------------------------------------------------------------
// Socket tickets — the credential a Bridge socket authenticates with.
//
// What a ticket replaces is a Better Auth SESSION TOKEN in the socket's first
// frame, which meant the page had to hold one: `getSession()` handed the raw
// token to JavaScript, and anything that could read it held the account for as
// long as the session lasted. A ticket is worth one socket, for one minute,
// once.
//
// It lives HERE, in the object it opens, and that placement is the design:
//
//   • VALIDATION IS LOCAL. Admitting a socket is one synchronous SQLite read in
//     the object that already has to wake — no D1 round trip, no Better Auth
//     construction, nothing that makes a hibernation wake more expensive than
//     it needs to be.
//   • SINGLE USE IS ATOMIC. The consume is a DELETE … RETURNING inside one
//     synchronous JS turn, so two sockets racing the same ticket cannot both
//     win. A store outside the object could only approximate that.
//   • THE OBJECT IS THE BINDING. A ticket is only ever minted by the object
//     that verified the session, so a ticket that validates here was minted for
//     the user this object serves. There is no userId to compare and none to
//     forge.
//
// Expiry rides the host's ONE alarm (see ./user-host) as a SWEEP and nothing
// more: this concern contributes no `nextDueAt`, because an outstanding ticket
// never needs the object woken. It is refused the moment it is stale, the set
// is capped, and minting sweeps first — so waking a minute later to drop one
// bounded row would buy nothing and cost a wake the object would not otherwise
// take. A second alarm for it would be worse still: a Durable Object has ONE,
// and a concern that calls `setAlarm` for itself silently cancels whatever was
// already armed.
// ---------------------------------------------------------------------------

import type { ClientClass } from "./client-class";

/**
 * How long a minted ticket stays valid.
 *
 * It covers exactly one hop: the page mints and immediately dials. Long enough
 * to absorb a slow network and a cold Durable Object, short enough that a
 * ticket found in a log or a heap dump is already dead.
 */
const TICKET_TTL_MS = 60_000;

/** 32 random bytes → a 43-char base64url ticket (~256 bits of entropy). */
const TICKET_BYTES = 32;

/**
 * Tickets one caller may hold unspent at once.
 *
 * A ticket is spent the moment its socket connects, so a backlog is a client
 * that keeps minting without dialling. The cap bounds what that can cost the
 * object's storage; the oldest go first, because the newest is the one someone
 * is about to use.
 */
const MAX_OUTSTANDING = 16;

type TicketRow = {
  readonly ticket: string;
  readonly client_class: string;
  readonly expires_at: number;
};

/** A minted ticket, as the mint route answers with it. */
export type MintedTicket = { readonly ticket: string; readonly expiresAt: number };

export class SocketTickets {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    // Synchronous, so the table exists before anything else in the object's
    // construction can reach it. `host_` prefixed because this object's SQLite
    // is shared with the vault manifest, the knowledge index and the agent.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS host_socket_tickets (
         ticket TEXT PRIMARY KEY,
         client_class TEXT NOT NULL,
         expires_at INTEGER NOT NULL
       )`,
    );
  }

  /** Mint a ticket for `clientClass`, valid for one socket until it expires. */
  mint(clientClass: ClientClass, now: number): MintedTicket {
    this.sweep(now);
    this.trim();
    const ticket = base64Url(crypto.getRandomValues(new Uint8Array(TICKET_BYTES)));
    const expiresAt = now + TICKET_TTL_MS;
    this.sql.exec(
      "INSERT INTO host_socket_tickets (ticket, client_class, expires_at) VALUES (?, ?, ?)",
      ticket,
      clientClass,
      expiresAt,
    );
    return { ticket, expiresAt };
  }

  /**
   * Spend `ticket` and answer the class it was minted for, or `null` when it is
   * unknown, already spent, or stale.
   *
   * The delete comes FIRST and returns what it removed, so the read and the
   * spend cannot be interleaved — a second socket presenting the same ticket
   * removes nothing and is refused.
   */
  consume(ticket: string, now: number): ClientClass | null {
    const row = this.sql
      .exec<TicketRow>(
        "DELETE FROM host_socket_tickets WHERE ticket = ? RETURNING ticket, client_class, expires_at",
        ticket,
      )
      .toArray()[0];
    if (row === undefined || row.expires_at <= now) return null;
    return row.client_class === "mobile" ? "mobile" : "web";
  }

  /** Drop every ticket past its expiry. */
  sweep(now: number): void {
    this.sql.exec("DELETE FROM host_socket_tickets WHERE expires_at <= ?", now);
  }

  /** Keep the outstanding set under `MAX_OUTSTANDING`, oldest first. */
  private trim(): void {
    this.sql.exec(
      `DELETE FROM host_socket_tickets WHERE ticket IN (
         SELECT ticket FROM host_socket_tickets ORDER BY expires_at DESC LIMIT -1 OFFSET ?
       )`,
      MAX_OUTSTANDING - 1,
    );
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
