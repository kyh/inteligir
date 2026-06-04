import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";

import { AppLayout } from "@/renderer/app";
import { ShellPage } from "@/renderer/shell/shell-page";
import { LoginPage } from "@/renderer/login/login-page";
import { OnboardingPage } from "@/renderer/onboarding/onboarding-page";
import { ErrorBoundary } from "@/renderer/components/error-boundary";
import { initFlushBridge } from "@/renderer/shell/instance-state-flush";
import "./styles.css";

// Wire the flush-ack handler as soon as the bridge is available — every
// window with this renderer must reply to SHELL_FLUSH_REQUEST or main's
// per-window handshake will time out. Deferring this to PanelGrid mount
// left non-shell pages (login, onboarding) unable to ack at all.
initFlushBridge();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <MemoryRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<ShellPage />} />
              <Route path="login" element={<LoginPage />} />
              <Route path="onboarding" element={<OnboardingPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
}
