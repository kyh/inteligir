import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";

import { AppLayout } from "@renderer/app";
import { WorkspacePage } from "@renderer/workspace/workspace-page";
import { LoginPage } from "@renderer/login/login-page";
import { OnboardingPage } from "@renderer/onboarding/onboarding-page";
import { ErrorBoundary } from "@renderer/components/error-boundary";
import { DesktopThemeProvider } from "@renderer/lib/use-theme";
import "./styles.css";

/** The entire portable UI. Hosts call `installBridge(...)` before rendering
 * this — the app itself never touches a transport. */
export function App() {
  return (
    <StrictMode>
      <ErrorBoundary>
        <DesktopThemeProvider>
          <MemoryRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route index element={<WorkspacePage />} />
                <Route path="login" element={<LoginPage />} />
                <Route path="onboarding" element={<OnboardingPage />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </DesktopThemeProvider>
      </ErrorBoundary>
    </StrictMode>
  );
}
