// Types the `env` the vitest Workers pool injects into `cloudflare:test`,
// derived from the same bindings as the generated `Env` (wrangler.jsonc).
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
