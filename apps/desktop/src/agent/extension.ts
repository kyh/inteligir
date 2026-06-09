// The extension-bundle framework now lives in @repo/agent-host so the same
// machinery can drive headless (cloud) runs. This barrel keeps the existing
// `@/agent/extension` import path stable for the desktop bundles, setup.ts,
// and tests — nothing else needs to change.

export {
  runBundleSetups,
  validateToolParametersSchema,
  buildValidatedFactories,
  type ExtensionRegisterContext,
  type ExtensionSetupContext,
  type PiExtensionBundle,
} from "@repo/agent-host/extension";

// SetupProgress is intentionally NOT re-exported here. Desktop code consumes
// the IPC-facing SetupProgress from @/shared/ipc-registry; the host has its own
// structurally-identical copy for ExtensionSetupContext. The two only meet in
// setup.ts (desktop's onProgress flowing into the host's ExtensionSetupContext),
// where any drift between them is a compile error — so there's no silent
// dual-source risk to guard against.
