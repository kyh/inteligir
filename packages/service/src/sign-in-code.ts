import { db } from "@repo/db/drizzle-client";

import { mintSignInCode } from "./auth/sign-in-code";

const email = process.argv[2] ?? "dev@inteligir.local";

try {
  console.log(await mintSignInCode(email));
} finally {
  await db.$client.end();
}
