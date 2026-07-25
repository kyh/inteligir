import { useCallback, useEffect, useState } from "react";

import { cn } from "@repo/ui/lib/utils";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@renderer/lib/bridge";
import type { AccountCapabilities, SyncSignInResult, SyncState } from "@repo/bridge/sync";

const SOCIAL_LABELS: Record<string, string> = {
  github: "GitHub",
  google: "Google",
};

function socialLabel(provider: string): string {
  return SOCIAL_LABELS[provider] ?? provider;
}

/** How long the "finish in your browser…" pending state waits for the
 * inteligir://session deep link before giving up. The host keeps its pending
 * sign-in alive longer (10 min) — a late deep link still signs in; this only
 * un-sticks the UI. */
const SOCIAL_PENDING_TIMEOUT_MS = 2 * 60_000;

// Account — the first-class OPTIONAL login (#459). Guest is the default and
// the account gates ONLY cloud saves: Sync consumes the session this section
// establishes, nothing else may. Backed by the same Better Auth coordinator
// the sync engine talks to (email+password + env-gated social), through the
// existing sync:* Bridge channels. The server URL lives here because the URL
// identifies the service the account belongs to; the Sync section only
// consumes the resulting session.
export function AccountSection() {
  const [state, setState] = useState<SyncState | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "reset">("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Non-error outcome copy (the reset flow's neutral confirmation). */
  const [notice, setNotice] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AccountCapabilities | null>(null);
  /** Provider of the in-flight social sign-in ("finish in your browser…"),
   * null when none. Resolves on onSocialSignInResult / sign-in / timeout. */
  const [socialPending, setSocialPending] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    void bridge
      .getSyncState()
      .then((initial) => {
        setState(initial);
        setUrlInput(initial.coordinatorUrl);
        return undefined;
      })
      .catch(() => {});
    return bridge.onSyncStateChanged(setState);
  }, []);

  // The deep-link completion's verdict: ok resolves the pending state
  // (onSyncStateChanged flips signedIn), an error surfaces its message
  // (expired/replayed link, exchange failure).
  useEffect(
    () =>
      getBridge().onSocialSignInResult((result) => {
        setSocialPending(null);
        if (!result.ok) setError(result.error);
      }),
    [],
  );

  // Un-stick the pending state if the browser leg never comes back.
  useEffect(() => {
    if (socialPending === null) return;
    const timer = setTimeout(() => {
      setSocialPending(null);
      setError("Timed out waiting for the browser — try again.");
    }, SOCIAL_PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [socialPending]);

  // Social buttons are capability-driven: the coordinator reports exactly the
  // providers its env has credentials for. Re-probed when the URL changes.
  const coordinatorUrl = state?.coordinatorUrl ?? "";
  useEffect(() => {
    if (coordinatorUrl.trim() === "") {
      setCapabilities(null);
      return;
    }
    let stale = false;
    void getBridge()
      .getAccountCapabilities()
      .then((caps) => {
        if (!stale) setCapabilities(caps);
        return undefined;
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [coordinatorUrl]);

  const handleSaveUrl = useCallback(() => {
    setError(null);
    void getBridge()
      .setSyncConfig({ coordinatorUrl: urlInput.trim() })
      .then(setState)
      .catch(() => setError("Failed to save the server URL."));
  }, [urlInput]);

  const runAuth = useCallback(async (run: () => Promise<SyncSignInResult>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await run();
      if (result.ok) {
        setPassword("");
      } else {
        setError(result.error);
      }
    } catch {
      setError("Authentication failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const bridge = getBridge();
    // Persist any pending URL edit first so auth hits the right coordinator.
    if (urlInput.trim() !== coordinatorUrl) {
      setState(await bridge.setSyncConfig({ coordinatorUrl: urlInput.trim() }));
    }
    await runAuth(() =>
      mode === "sign-up"
        ? bridge.syncSignUp({ email, password })
        : bridge.syncSignIn({ email, password }),
    );
  }, [mode, email, password, urlInput, coordinatorUrl, runAuth]);

  /** Switch between sign-in / sign-up / forgot-password, clearing outcome
   * copy so a stale error or confirmation never bleeds across modes. */
  const switchMode = useCallback((next: "sign-in" | "sign-up" | "reset") => {
    setMode(next);
    setError(null);
    setNotice(null);
  }, []);

  const handleRequestReset = useCallback(async () => {
    const bridge = getBridge();
    // Persist any pending URL edit first so the request hits the right coordinator.
    if (urlInput.trim() !== coordinatorUrl) {
      setState(await bridge.setSyncConfig({ coordinatorUrl: urlInput.trim() }));
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.syncRequestPasswordReset({ email });
      if (result.ok) {
        // NEUTRAL by contract (registry entry): fixed local copy, identical
        // whether or not the email has an account — never server text.
        setNotice("If that email has an account, a reset link is on its way — check your inbox.");
      } else {
        // Transport/config failures only; reveals nothing about any account.
        setError(result.error);
      }
    } catch {
      setError("Password-reset request failed.");
    } finally {
      setBusy(false);
    }
  }, [email, urlInput, coordinatorUrl]);

  const handleSocial = useCallback(
    async (provider: string) => {
      setError(null);
      const bridge = getBridge();
      // Persist any pending URL edit first so auth hits the right coordinator.
      if (urlInput.trim() !== coordinatorUrl) {
        setState(await bridge.setSyncConfig({ coordinatorUrl: urlInput.trim() }));
      }
      setSocialPending(provider);
      try {
        // ok = browser opened; the session lands via the inteligir://session
        // deep link, resolved by the onSocialSignInResult subscription above.
        const result = await bridge.syncSocialSignIn({ provider });
        if (!result.ok) {
          setSocialPending(null);
          setError(result.error);
        }
      } catch {
        setSocialPending(null);
        setError("Social sign-in failed.");
      }
    },
    [urlInput, coordinatorUrl],
  );

  const handleSignOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Clears ONLY the account session (sync-auth.json) — provider
      // credentials and every local note stay untouched; the app remains in
      // the workspace as a guest (#459 teardown decouple).
      await getBridge().syncSignOut();
    } finally {
      setBusy(false);
    }
  }, []);

  const loading = state === null;
  const signedIn = state?.signedIn === true;
  const socialProviders = capabilities?.socialProviders ?? [];

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Account</Label>
      <div className="rounded-[12px] bg-muted">
        <div className="flex flex-col gap-2 px-3 py-2">
          <p className="text-[10px] text-muted-foreground">
            Optional — an account unlocks cloud saves (vault sync) and nothing else. Everything
            except sync works without one, and signing in keeps your local vault as is.
          </p>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground">Server</span>
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onBlur={handleSaveUrl}
              placeholder="https://sync.inteligir.app"
              className="h-7 text-xs"
              disabled={loading}
            />
          </div>

          {signedIn ? (
            <div className="flex items-center justify-between rounded-[8px] bg-card px-2.5 py-1.5">
              <span className="flex flex-col">
                <span className="text-xs text-foreground">Signed in</span>
                <span className="text-[10px] text-muted-foreground">{state?.email ?? ""}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleSignOut()}
                disabled={busy}
                className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                Sign out
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                type="email"
                autoComplete="username"
                className="h-7 text-xs"
                disabled={loading}
              />
              {mode !== "reset" && (
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  type="password"
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                  className="h-7 text-xs"
                  disabled={loading}
                />
              )}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void (mode === "reset" ? handleRequestReset() : handleSubmit())}
                  disabled={
                    busy || loading || email.trim() === "" || (mode !== "reset" && password === "")
                  }
                  className="h-7 px-3 text-[10px]"
                >
                  {busy
                    ? "Working…"
                    : mode === "sign-up"
                      ? "Create account"
                      : mode === "reset"
                        ? "Send reset link"
                        : "Sign in"}
                </Button>
                {/* These two stay MOUNTED across every mode change, swapping
                    label/handler in place (#473). A button that unmounts itself
                    on click detaches the press target before Base UI's
                    outside-press check resolves, so the whole Settings dialog
                    reads it as an outside click and closes. Same reason
                    "Forgot password?" hides with a class instead of a guard. */}
                <button
                  type="button"
                  onClick={() =>
                    switchMode(mode === "reset" || mode === "sign-up" ? "sign-in" : "sign-up")
                  }
                  className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {mode === "reset"
                    ? "Back to sign in"
                    : mode === "sign-up"
                      ? "Have an account? Sign in"
                      : "New here? Create account"}
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("reset")}
                  className={cn(
                    "text-[10px] text-muted-foreground transition-colors hover:text-foreground",
                    mode !== "sign-in" && "hidden",
                  )}
                >
                  Forgot password?
                </button>
              </div>

              {/* Social sign-in, live end to end: the button opens the system
                  browser at the coordinator's authorization URL; consent
                  redirects to the coordinator's interstitial, whose
                  inteligir://session deep link (single-use code + this
                  device's state nonce — never a token) completes the sign-in
                  host-side. Providers are env-gated via /v1/capabilities. */}
              {mode !== "reset" && socialProviders.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                  {socialPending === null ? (
                    <>
                      <span className="text-[10px] text-muted-foreground">Or continue with</span>
                      {socialProviders.map((provider) => (
                        <Button
                          key={provider}
                          variant="outline"
                          size="sm"
                          onClick={() => void handleSocial(provider)}
                          disabled={busy || loading}
                          className="h-6 px-2 text-[10px]"
                        >
                          {socialLabel(provider)}
                        </Button>
                      ))}
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] text-muted-foreground">
                        Complete the {socialLabel(socialPending)} sign-in in your browser…
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSocialPending(null)}
                        className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {error && <span className="text-[10px] text-destructive">{error}</span>}
          {notice && <span className="text-[10px] text-muted-foreground">{notice}</span>}
        </div>
      </div>
    </div>
  );
}
