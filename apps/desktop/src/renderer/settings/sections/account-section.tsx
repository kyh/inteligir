import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@renderer/lib/bridge";
import type { AccountCapabilities, SyncSignInResult, SyncState } from "@repo/features/sync";

const SOCIAL_LABELS: Record<string, string> = {
  github: "GitHub",
  google: "Google",
};

function socialLabel(provider: string): string {
  return SOCIAL_LABELS[provider] ?? provider;
}

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
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AccountCapabilities | null>(null);

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
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                type="password"
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                className="h-7 text-xs"
                disabled={loading}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleSubmit()}
                  disabled={busy || loading || email.trim() === "" || password === ""}
                  className="h-7 px-3 text-[10px]"
                >
                  {busy ? "Working…" : mode === "sign-up" ? "Create account" : "Sign in"}
                </Button>
                <button
                  type="button"
                  onClick={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}
                  className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {mode === "sign-up" ? "Have an account? Sign in" : "New here? Create account"}
                </button>
              </div>

              {/* Social sign-in seam is wired end to end (coordinator env →
                  /v1/capabilities → these provider chips), but capturing the
                  OAuth session ON THIS DEVICE needs the inteligir:// deep-link
                  callback, which lands in Phase 4. Until then the buttons
                  render (proving the env-gated capability path) but stay
                  DISABLED — never a clickable control that silently no-ops. */}
              {socialProviders.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                  <span className="text-[10px] text-muted-foreground">Or continue with</span>
                  {socialProviders.map((provider) => (
                    <Button
                      key={provider}
                      variant="outline"
                      size="sm"
                      disabled
                      title="Coming soon"
                      className="h-6 px-2 text-[10px]"
                    >
                      {socialLabel(provider)}
                    </Button>
                  ))}
                  <span className="text-[10px] text-muted-foreground/70">(coming soon)</span>
                </div>
              )}
            </div>
          )}

          {error && <span className="text-[10px] text-destructive">{error}</span>}
        </div>
      </div>
    </div>
  );
}
