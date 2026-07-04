import { StrictMode } from "react";
import { RouterProvider } from "@tanstack/react-router";

import { ErrorBoundary } from "@renderer/components/error-boundary";
import { DesktopThemeProvider } from "@renderer/lib/use-theme";
import { createAppRouter } from "@renderer/router";
import "./styles/globals.css";

const router = createAppRouter();

/** The entire product UI. Hosts call `installBridge(...)` before rendering
 * this — the app itself never touches a transport. */
export function App() {
  return (
    <StrictMode>
      <ErrorBoundary>
        <DesktopThemeProvider>
          <RouterProvider router={router} />
        </DesktopThemeProvider>
      </ErrorBoundary>
    </StrictMode>
  );
}
