// Declaration-merged into the generated Env. Hand-declared rather than named in wrangler.jsonc's
// `secrets` field: that field also filters .dev.vars down to the names it lists, so declaring
// one there silently drops the others in `vite dev`.

interface Env {
  readonly BETTER_AUTH_SECRET: string;
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string;
  // must belong to a domain onboarded with `wrangler email sending enable`
  readonly RESET_FROM_ADDRESS?: string;
  // "true" only in tests: the in-process Worker serves every request from one IP
  readonly RATE_LIMIT_DISABLED?: string;
}
