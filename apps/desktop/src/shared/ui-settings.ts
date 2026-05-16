// ---------------------------------------------------------------------------
// Shared types and defaults for the JSON-driven settings UI.
//
// The spec format mirrors json-render's flat tree (`{ root, elements }`).
// Kept untyped at the structural level so both main (Node) and renderer
// (browser) can read it without pulling json-render's full d.ts graph into
// the preload bundle.
// ---------------------------------------------------------------------------

export type UiSpecElement = {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
  visible?: unknown;
  on?: Record<string, unknown>;
  watch?: Record<string, unknown>;
};

export type UiSpec = {
  root: string;
  elements: Record<string, UiSpecElement>;
  state?: Record<string, unknown>;
};

export type UiSettingsConfig = {
  spec: UiSpec;
  state: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Default spec — replicates the current OpenAI / Session / Notifications panel.
// Components and actions referenced here are defined in the renderer's
// settings-registry. The LLM may rewrite this entire spec freely; the "Reset"
// button in the panel restores it from this constant.
// ---------------------------------------------------------------------------

export const DEFAULT_UI_SETTINGS_SPEC: UiSpec = {
  root: "panel",
  elements: {
    panel: {
      type: "Stack",
      props: { gap: "lg" },
      children: ["openai", "session", "notifications"],
    },

    openai: {
      type: "Section",
      props: { title: "OpenAI Account" },
      children: ["openai-row"],
    },
    "openai-row": {
      type: "Row",
      props: {},
      children: ["openai-status", "openai-logout"],
    },
    "openai-status": {
      type: "Text",
      props: {
        text: {
          $cond: { $state: "/app/connected" },
          $then: "Connected",
          $else: "Not connected",
        },
        muted: {
          $cond: { $state: "/app/connected" },
          $then: false,
          $else: true,
        },
      },
    },
    "openai-logout": {
      type: "Button",
      props: { label: "Log out", variant: "ghost", size: "sm" },
      visible: { $state: "/app/connected" },
      on: { press: { action: "logout" } },
    },

    session: {
      type: "Section",
      props: { title: "Session" },
      children: ["session-row"],
    },
    "session-row": {
      type: "Row",
      props: {},
      children: ["session-text", "session-button"],
    },
    "session-text": {
      type: "TextBlock",
      props: {
        title: "Start new session",
        description: "Replaces the current session. Chat history is cleared.",
      },
    },
    "session-button": {
      type: "Button",
      props: {
        label: "New session",
        variant: "ghost",
        size: "sm",
        disabled: {
          $cond: { $state: "/app/canStartSession" },
          $then: false,
          $else: true,
        },
      },
      on: { press: { action: "newSession" } },
    },

    notifications: {
      type: "Section",
      props: { title: "Notifications" },
      children: ["notif-row"],
    },
    "notif-row": {
      type: "Checkbox",
      props: {
        label: "Notify when idle",
        description:
          "Show an OS notification when the agent finishes a turn while Inteligir is in the background.",
        checked: { $bindState: "/notifications/enabled" },
      },
      watch: {
        "/notifications/enabled": {
          action: "setNotifications",
          params: { enabled: { $state: "/notifications/enabled" } },
        },
      },
    },
  },
};
