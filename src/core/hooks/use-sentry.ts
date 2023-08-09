import { useEffect } from "react";
import initializeBrowserSentry from "~/core/sentry/initialize-browser-sentry";

const useSentry = () => {
  useEffect(() => {
    void initializeBrowserSentry();
  }, []);
};

export default useSentry;
