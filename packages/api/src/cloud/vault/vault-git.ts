// identity-free: every device dials vault.git and the worker rewrites to the verified user's
// repo. the never-break rule covers this path: a signed-in install's git config points here.
export const VAULT_GIT_PATH = "/v1/git/vault.git";

// the most one push may carry, whole request body counted. under the 100 MB body the edge takes
// on the Free and Pro plans, so the refusal is always the Worker's own 413 and never whatever the
// edge does to a body past its limit; far under durable-git's 512 MiB.
export const VAULT_GIT_MAX_PUSH_BYTES = 90 * 1024 * 1024;
