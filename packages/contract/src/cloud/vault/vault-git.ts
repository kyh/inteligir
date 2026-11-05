// identity-free: every device dials vault.git and the worker rewrites to the verified user's
// repo. moving it is a /cloud break, which raises the client build floor: a signed-in install's
// git config points here.
export const VAULT_GIT_PATH = "/v1/git/vault.git";

// the most one push may carry, whole request body counted. under the 100 MB body the edge takes
// on the Free and Pro plans, so the refusal is always the Worker's own 413 and never whatever the
// edge does to a body past its limit; far under durable-git's 512 MiB.
export const VAULT_GIT_MAX_PUSH_BYTES = 90 * 1024 * 1024;

// The app's commit vocabulary, which a desktop engine writes into the one history every Mac reads
// back: History tells whose edit a version was from its author.

const COMMIT_EMAIL_DOMAIN = "@inteligir.local";

// a desktop engine's own edits: the user's, from whichever Mac committed them
export const ENGINE_COMMIT_EMAIL = `vault${COMMIT_EMAIL_DOMAIN}`;

export const AGENT_COMMIT_EMAIL = `agent${COMMIT_EMAIL_DOMAIN}`;

// an edit's subject, spelled once so the history reads one way whichever device wrote it
export const vaultCommitSubject = (paths: readonly string[]): string => {
  const [only] = paths;
  return paths.length === 1 && only !== undefined
    ? `vault: update ${only}`
    : `vault: update ${String(paths.length)} files`;
};
