import { useEffect } from "react";
import { initializeBrowserSentry } from "@/lib/sentry/initialize-browser-sentry";

export const useSentry = () => {
  useEffect(() => {
    void initializeBrowserSentry();
  }, []);
};
