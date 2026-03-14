import { useCallback, useEffect, useState } from "react";

import type { DesktopBridge, UpdateState } from "../types";

const bridge = (window as unknown as { desktopBridge: DesktopBridge }).desktopBridge;

const initial: UpdateState = {
  status: "idle",
  version: null,
  downloadPercent: null,
  message: null,
};

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>(initial);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!bridge?.onUpdateState) return;
    const unsubscribe = bridge.onUpdateState((next) => {
      setState(next);
      // Re-show banner whenever a new update becomes available or downloaded
      if (next.status === "available" || next.status === "downloaded") {
        setDismissed(false);
      }
    });
    return unsubscribe;
  }, []);

  const handleDownload = useCallback(() => {
    void bridge.downloadUpdate();
  }, []);

  const handleInstall = useCallback(() => {
    void bridge.installUpdate();
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Nothing to show
  if (dismissed) return null;
  if (
    state.status === "idle" ||
    state.status === "checking" ||
    state.status === "not-available"
  ) {
    return null;
  }

  return (
    <div style={styles.banner}>
      <div style={styles.content}>
        {state.status === "available" && (
          <>
            <span style={styles.text}>
              Version {state.version} is available.
            </span>
            <button type="button" style={styles.button} onClick={handleDownload}>
              Download
            </button>
          </>
        )}

        {state.status === "downloading" && (
          <>
            <span style={styles.text}>
              Downloading update… {state.downloadPercent ?? 0}%
            </span>
            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressBar,
                  width: `${state.downloadPercent ?? 0}%`,
                }}
              />
            </div>
          </>
        )}

        {state.status === "downloaded" && (
          <>
            <span style={styles.text}>
              Update ready — restart to apply v{state.version}.
            </span>
            <button type="button" style={styles.button} onClick={handleInstall}>
              Restart Now
            </button>
          </>
        )}

        {state.status === "error" && (
          <span style={styles.text}>
            Update failed: {state.message ?? "Unknown error"}
          </span>
        )}
      </div>

      <button
        type="button"
        style={styles.close}
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: "fixed",
    bottom: 16,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "rgba(24, 24, 27, 0.92)",
    backdropFilter: "blur(12px)",
    color: "#fafafa",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 13,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
    zIndex: 9999,
    maxWidth: "90vw",
  },
  content: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap" as const,
  },
  text: {
    whiteSpace: "nowrap",
  },
  button: {
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "4px 12px",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 500,
  },
  close: {
    background: "transparent",
    border: "none",
    color: "#a1a1aa",
    cursor: "pointer",
    fontSize: 14,
    padding: "0 4px",
    lineHeight: 1,
  },
  progressTrack: {
    width: 120,
    height: 4,
    background: "rgba(255,255,255,0.15)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    background: "#3b82f6",
    borderRadius: 2,
    transition: "width 0.3s ease",
  },
};
