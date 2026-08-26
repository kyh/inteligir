import { type AccountResponse } from "@repo/api/cloud/account/account-schema";
import { eq } from "drizzle-orm";
import { refuse } from "../cloud-http";
import { createDb } from "../db/client";
import { user } from "../db/schema";
import { verifyDeviceCredential } from "./device-auth";

// `GET /v1/account` — whose account this device credential syncs as. The
// contract module states why this is its own route; what this handler owns is
// the same verified-credential-names-the-state rule as every device surface.

export async function handleAccountRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return refuse("not-found", "No such route.");
  const db = createDb(env.DB);
  const verified = await verifyDeviceCredential(db, request.headers.get("authorization"));
  if (verified === null) return refuse("unauthorized", "No valid device credential.");

  const row = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, verified.userId))
    .get();
  // A live credential whose user row is gone can only be the deletion race's
  // in-flight sliver; answer what the tombstone would.
  if (row === undefined) return refuse("account-deleted", "This account was deleted.");

  const response: AccountResponse = { id: row.id, email: row.email };
  return Response.json(response);
}
