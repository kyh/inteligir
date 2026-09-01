import { defineConfig } from "vitest/config";

// Node-only tests for the PURE modules: the sync client (outbox freezing +
// per-device counter, pull-apply by global seq, capture idempotency, the
// session-fenced runtime), the credential codec, and the PKCE + pairing
// handshake. Every test drives an injected storage/crypto/fetch port with an
// in-memory or Node-crypto fake — nothing here imports the `expo-*` /
// react-native wiring, so no device or native module is needed.
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    maxWorkers: 1,
  },
});
