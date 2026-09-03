// identity-free: every device dials vault.git and the worker rewrites to the verified user's
// repo. the never-break rule covers this path: a signed-in install's git config points here.
export const VAULT_GIT_PATH = "/v1/git/vault.git";
