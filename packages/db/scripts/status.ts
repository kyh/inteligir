import postgres from "postgres";

const report = async (url: string) => {
  const { host, pathname } = new URL(url);
  const sql = postgres(url, { connect_timeout: 2, max: 1 });

  try {
    const [row] = await sql<{ server_version: string }[]>`show server_version`;
    console.log(`Postgres ${row?.server_version ?? ""} answers at ${host}${pathname}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `Nothing answers at ${host}${pathname} (${reason}): \`pnpm db:start\` starts one.`,
    );
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
};

const url = process.env.POSTGRES_URL;

if (url === undefined || url === "") {
  console.error("No POSTGRES_URL in the shell, .env.local or .env: run `pnpm bootstrap`.");
  process.exitCode = 1;
} else {
  await report(url);
}
