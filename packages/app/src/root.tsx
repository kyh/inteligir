import { MemoryRouter, Route, Routes } from "react-router";

import { AppLayout } from "./app";
import { ErrorBoundary } from "./components/error-boundary";
import { LoginPage } from "./login/login-page";
import { OnboardingPage } from "./onboarding/onboarding-page";
import { WorkspacePage } from "./workspace/workspace-page";

/** The routed app tree. Host-agnostic: the host (Electron shell or web
 * server) mounts this and installs the transport-specific Bridge via
 * setBridge before first render. */
export function App() {
  return (
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
  );
}
