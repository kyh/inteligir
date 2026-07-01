import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";

import { AppLayout } from "@repo/app/app";
import { WorkspacePage } from "@repo/app/workspace/workspace-page";
import { LoginPage } from "@repo/app/login/login-page";
import { OnboardingPage } from "@repo/app/onboarding/onboarding-page";
import { ErrorBoundary } from "@repo/app/components/error-boundary";
import "./styles.css";

/** The entire portable UI. Hosts call `installBridge(...)` before rendering
 * this — the app itself never touches a transport. */
export function App() {
  return (
    <StrictMode>
      <ErrorBoundary>
        <MemoryRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<WorkspacePage />} />
              <Route path="login" element={<LoginPage />} />
              <Route path="onboarding" element={<OnboardingPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ErrorBoundary>
    </StrictMode>
  );
}
