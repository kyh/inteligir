import type { Config } from "drizzle-kit";

// drizzle-kit introspection stalls forever on Supabase's transaction pooler.
const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;

if (url === undefined || url === "") {
  throw new Error("Missing POSTGRES_URL");
}

// DDL blocked by a long or orphaned statement fails after 5 s instead of queueing every write.
const withLockTimeout = (connectionUrl: string) => {
  const parsed = new URL(connectionUrl);
  const options = parsed.searchParams.get("options");
  const kept = options === null || options === "" ? "" : `${options} `;
  parsed.searchParams.set("options", `${kept}-c lock_timeout=5s`);
  return parsed.toString();
};

export default {
  dbCredentials: {
    url: withLockTimeout(url),
  },
  dialect: "postgresql",
  schema: "./src/*-schema.ts",
  schemaFilter: ["public"],
} satisfies Config;
