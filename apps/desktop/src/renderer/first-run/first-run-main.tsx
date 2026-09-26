// The first-run window's page: no router, no query client and no socket, because no server exists
// yet. It asks main for the vault choice over its own bridge, and main replaces it with the app
// window once that vault's server is up.

import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { RadiusProvider } from "@repo/ui/lib/radius-context";
import { SizeProvider } from "@repo/ui/lib/size-context";
import { ThemeProvider } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { FirstRunState } from "../../first-run-state";
import type { FirstRunBridge } from "../../types";
import "../styles/globals.css";
import { VaultStep } from "./vault-step";
import { WelcomeStep } from "./welcome-step";

declare global {
  interface Window {
    firstRunBridge?: FirstRunBridge;
  }
}

type Loaded = { kind: "loading" } | { kind: "failed" } | { kind: "state"; state: FirstRunState };

const FirstRun = ({ bridge }: { bridge: FirstRunBridge }) => {
  const [step, setStep] = useState<"welcome" | "vault">("welcome");
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        setLoaded({ kind: "state", state: await bridge.getState() });
      } catch (error) {
        console.warn("[first-run] the shell did not answer", error);
        setLoaded({ kind: "failed" });
      }
    };
    void load();
  }, [bridge]);

  if (step === "welcome") {
    return (
      <WelcomeStep
        onStart={() => {
          setStep("vault");
        }}
      />
    );
  }
  switch (loaded.kind) {
    case "loading": {
      return null;
    }
    case "failed": {
      return (
        <p className="text-body text-destructive">Inteligir did not answer. Quit and reopen it.</p>
      );
    }
    case "state": {
      return <VaultStep bridge={bridge} proposal={loaded.state.newVault} />;
    }
    default: {
      const exhaustive: never = loaded;
      return exhaustive;
    }
  }
};

// a browser tab can load this file from the bundle a server stages, and has no bridge: nothing
// here is a tab's to choose
const FirstRunPage = () => {
  const [theme, setTheme] = useState<Theme>("system");
  const bridge = window.firstRunBridge;
  return (
    <ThemeProvider theme={theme} setTheme={setTheme}>
      <MotionPolicy>
        <RadiusProvider radius="rounded">
          <SizeProvider size="compact">
            <main className="flex min-h-dvh items-center justify-center bg-surface p-8 text-ink">
              {bridge === undefined ? (
                <p className="text-body text-muted-foreground">
                  Open the Inteligir app to set up your notes.
                </p>
              ) : (
                <FirstRun bridge={bridge} />
              )}
            </main>
          </SizeProvider>
        </RadiusProvider>
      </MotionPolicy>
    </ThemeProvider>
  );
};

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("first-run.html has no #root to mount into");
}

createRoot(container).render(
  <StrictMode>
    <FirstRunPage />
  </StrictMode>,
);
