import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";

import { AppLayout } from "@/renderer/app";
import { ChatPage } from "@/renderer/chat/chat-page";
import { LoginPage } from "@/renderer/login/login-page";
import { OnboardingPage } from "@/renderer/onboarding/onboarding-page";
import { SettingsPage } from "@/renderer/settings/settings-page";
import { ErrorBoundary } from "@/renderer/components/error-boundary";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <MemoryRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<ChatPage />} />
              <Route path="login" element={<LoginPage />} />
              <Route path="onboarding" element={<OnboardingPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
}
