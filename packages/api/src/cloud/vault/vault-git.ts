// identity-free: every device dials vault.git and the worker rewrites to the verified user's
// repo. the never-break rule covers this path: a signed-in install's git config points here.
export const VAULT_GIT_PATH = "/v1/git/vault.git";

// the most one push may carry, whole request body counted. under the 100 MB body the edge takes
// on the Free and Pro plans, so the refusal is always the Worker's own 413 and never whatever the
// edge does to a body past its limit; far under durable-git's 512 MiB.
export const VAULT_GIT_MAX_PUSH_BYTES = 90 * 1024 * 1024;

// The app's commit vocabulary, which a desktop engine and the Worker both write into the one history
// every device reads back: History tells whose edit a version was from its author, so a spelling
// here names every commit already made and never changes.

const COMMIT_EMAIL_DOMAIN = "@inteligir.local";

const DEVICE_EMAIL_PREFIX = "device-";

// a desktop engine's own edits: the user's, from whichever Mac committed them
export const ENGINE_COMMIT_EMAIL = `vault${COMMIT_EMAIL_DOMAIN}`;

export const AGENT_COMMIT_EMAIL = `agent${COMMIT_EMAIL_DOMAIN}`;

// the committer of a phone's change set, which the Worker commits for it; the committer's name is
// still the device's, since a conflict copy names the other device from the committer
export const WORKER_COMMITTER_EMAIL = `cloud${COMMIT_EMAIL_DOMAIN}`;

// the author of a phone's change set: the device, by the id its credential verified
export const deviceCommitEmail = (deviceId: string): string =>
  `${DEVICE_EMAIL_PREFIX}${deviceId}${COMMIT_EMAIL_DOMAIN}`;

export const isDeviceCommitEmail = (email: string): boolean =>
  email.length > DEVICE_EMAIL_PREFIX.length + COMMIT_EMAIL_DOMAIN.length &&
  email.startsWith(DEVICE_EMAIL_PREFIX) &&
  email.endsWith(COMMIT_EMAIL_DOMAIN);

// an edit's subject, spelled once so the history reads one way whichever device wrote it
export const vaultCommitSubject = (paths: readonly string[]): string => {
  const [only] = paths;
  return paths.length === 1 && only !== undefined
    ? `vault: update ${only}`
    : `vault: update ${String(paths.length)} files`;
};
