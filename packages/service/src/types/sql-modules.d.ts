// drizzle-kit's migrations.js (`@repo/db/cell/migrations`) imports each migration.sql, which the
// Cloudflare vite plugin bundles and the suites' config loads as a Text module: the file's text.
// `cf workers types` declares none.
declare module "*.sql" {
  const text: string;
  export default text;
}
