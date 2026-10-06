// Declaration-merged into the generated Env: secrets, which cloudflare.config.ts does not name.

interface Env {
  readonly BETTER_AUTH_SECRET: string;
  readonly BETTER_AUTH_TRUSTED_ORIGINS?: string;
  // must belong to a domain onboarded for Email Sending
  readonly RESET_FROM_ADDRESS?: string;
  // "true" only in tests: the in-process Worker serves every request from one IP
  readonly RATE_LIMIT_DISABLED?: string;
}
