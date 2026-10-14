// The first-run window's page: no router, no query client and no socket, because no server exists
// yet. It asks the shell for the vault choice through its own commands, and the shell replaces it
// with the app window once that vault's server is up.

import { MotionPolicy } from "@repo/ui/lib/motion-policy";
import { SizeProvider } from "@repo/ui/lib/size-context";
import { ThemeProvider } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { FirstRunState } from "../shell/first-run-state";
import { shellFirstRun, underShell } from "../shell/shell-commands";
import "../styles/globals.css";
import { VaultStep } from "./vault-step";
import { WelcomeStep } from "./welcome-step";

type Loaded = { kind: "loading" } | { kind: "failed" } | { kind: "state"; state: FirstRunState };

const FirstRun = () => {
  const [step, setStep] = useState<"welcome" | "vault">("welcome");
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        setLoaded({ kind: "state", state: await shellFirstRun.getState() });
      } catch (error) {
        console.warn("[first-run] the shell did not answer", error);
        setLoaded({ kind: "failed" });
      }
    };
    void load();
  }, []);

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
      return <VaultStep proposal={loaded.state.newVault} />;
    }
    default: {
      const exhaustive: never = loaded;
      return exhaustive;
    }
  }
};

// a browser that reaches this page has no shell: nothing here is a tab's to choose
const FirstRunPage = () => {
  const [theme, setTheme] = useState<Theme>("system");
  return (
    <ThemeProvider theme={theme} setTheme={setTheme}>
      <MotionPolicy>
        <SizeProvider size="compact">
          <main className="flex min-h-dvh items-center justify-center bg-surface p-8 text-ink">
            {underShell() ? (
              <FirstRun />
            ) : (
              <p className="text-body text-muted-foreground">
                Open the Inteligir app to set up your notes.
              </p>
            )}
          </main>
        </SizeProvider>
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
