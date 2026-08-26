// ---------------------------------------------------------------------------
// The hosted vault git remote's path — the one spelling both ends read. The
// Worker mounts its smart-HTTP wrapper here, and the CLI's remote provider
// composes `<cloudUrl>` + this to derive a paired install's remote. The URL
// is deliberately IDENTITY-FREE: every device dials `vault.git`, and the
// Worker rewrites to the verified user's own repo — no path ever names one.
//
// Not a procedure table: git smart HTTP is its own wire (a stock git client
// speaks it), so unlike the zod routes beside this there are no
// request/response schemas to carry. /cloud's never-break rule still applies
// to the PATH — a deployed install's git config points here for as long as
// it stays paired.
// ---------------------------------------------------------------------------

export const VAULT_GIT_PATH = "/v1/git/vault.git";
