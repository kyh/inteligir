import { db } from "@repo/db/drizzle-client";
import { connection } from "next/server";

const NO_STORE = { "cache-control": "no-store" };

export const GET = async () => {
  await connection();

  try {
    await db.execute("select 1");

    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error("health: the database did not answer", error);

    return Response.json({ ok: false }, { headers: NO_STORE, status: 503 });
  }
};
