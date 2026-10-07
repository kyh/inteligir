// The git remote a vault may sync with, as the env pin, `vault.setRemote` and the Settings field
// all accept it. git remotes include scp-like `git@host:path`, which no url parser accepts, so this
// is an allowlist of the shapes git dials; a leading "-" is refused outright, since git would parse
// it as an option, and `ext::` (a command git runs) is none of them.

import { z } from "zod";

// the variable that pins a vault's remote over its own origin, which only its environment changes
export const VAULT_REMOTE_PIN_ENV_VAR = "INTELIGIR_VAULT_REMOTE";

// each reason completes a sentence its caller starts with the value's name
export type RemoteUrlVerdict = { ok: true; url: string } | { ok: false; reason: string };

export const parseRemoteUrl = (rawValue: string): RemoteUrlVerdict => {
  const url = rawValue.trim();
  if (url.length === 0) {
    return { ok: false, reason: "must not be empty" };
  }
  if (/\s/u.test(url)) {
    return { ok: false, reason: "must not contain whitespace" };
  }
  if (url.startsWith("-")) {
    return { ok: false, reason: `must not start with "-" (got "${url}")` };
  }
  const hasAllowedScheme = /^(?:https|ssh|git|file):\/\/./u.test(url);
  const isScpLike = /^[\w.-]+@[\w.-]+:.+$/u.test(url);
  if (!hasAllowedScheme && !isScpLike) {
    return {
      ok: false,
      reason: `must be an https://, ssh://, git://, file:// URL or user@host:path (got "${url}")`,
    };
  }
  return { ok: true, url };
};

export const remoteUrlSchema = z.string().transform((value, ctx) => {
  const verdict = parseRemoteUrl(value);
  if (!verdict.ok) {
    ctx.addIssue({ code: "custom", message: `the remote URL ${verdict.reason}` });
    return z.NEVER;
  }
  return verdict.url;
});
