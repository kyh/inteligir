import { describe, expect, it } from "vitest";

import { newTokenBucket, takeToken, type TokenBucketConfig } from "./token-bucket";

const config: TokenBucketConfig = { capacity: 3, refillPerSecond: 1 };

describe("token bucket", () => {
  it("allows bursts up to capacity, then denies", () => {
    let state = newTokenBucket(config, 0);
    for (let i = 0; i < config.capacity; i += 1) {
      const result = takeToken(config, state, 0);
      expect(result.allowed).toBe(true);
      state = result.state;
    }
    expect(takeToken(config, state, 0).allowed).toBe(false);
  });

  it("refills at refillPerSecond", () => {
    let state = newTokenBucket(config, 0);
    for (let i = 0; i < config.capacity; i += 1) {
      state = takeToken(config, state, 0).state;
    }
    expect(takeToken(config, state, 999).allowed).toBe(false);
    expect(takeToken(config, state, 1000).allowed).toBe(true);
  });

  it("caps refill at capacity", () => {
    let state = newTokenBucket(config, 0);
    state = takeToken(config, state, 0).state;
    const result = takeToken(config, state, 100_000);
    expect(result.allowed).toBe(true);
    expect(result.state.tokens).toBe(config.capacity - 1);
  });

  it("tolerates clock skew without going negative", () => {
    const state = newTokenBucket(config, 1000);
    const result = takeToken(config, state, 0);
    expect(result.allowed).toBe(true);
    expect(result.state.tokens).toBe(config.capacity - 1);
  });
});
