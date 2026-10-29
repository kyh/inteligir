// the origin the suites address the Worker at, which the restated bindings name as the
// deployment's own (vitest.config.ts), so the connector's issuer and resource are under it
export const ORIGIN = "https://inteligir-web.workers.dev";

// where the suites' cells reach the fake Managed Agents API, which a suite serves in process
// (`./managed-agents-api`); the loopback address a deployed Worker never takes
export const FAKE_MANAGED_AGENTS_ORIGIN = "http://127.0.0.1:5177";

// the Standard Webhooks key the suites sign Anthropic's deliveries with: `whsec_` and the base64
// of 32 bytes, as the Console mints one
export const TEST_WEBHOOK_SIGNING_KEY = "whsec_dGVzdC13ZWJob29rLXNpZ25pbmcta2V5LTAwMDAwMDA=";
