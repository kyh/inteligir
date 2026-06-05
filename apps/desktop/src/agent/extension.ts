// The extension-bundle framework now lives in @repo/agent-host so the same
// machinery can drive headless (cloud) runs. This barrel keeps the existing
// `@/agent/extension` import path stable for the desktop bundles, setup.ts,
// and tests — nothing else needs to change.

export {
  runBundleSetups,
  validateToolParametersSchema,
  buildValidatedFactories,
  type SetupProgress,
  type ExtensionRegisterContext,
  type ExtensionSetupContext,
  type PiExtensionBundle,
} from "@repo/agent-host/extension";
