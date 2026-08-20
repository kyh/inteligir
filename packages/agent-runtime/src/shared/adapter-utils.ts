// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed to what the codex adapter consumes; the diff builders, cumulative
// text differs and result-text extractors served the bridge adapters and the
// raw-output recovery path, neither of which is carried.

import { z } from "zod";

const shellEnvironmentVariableKeySchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/i);

export function buildShellEnvironmentPolicyConfig(
  envVars?: Record<string, string>,
): Record<string, string> | undefined {
  if (!envVars) {
    return undefined;
  }

  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    if (!shellEnvironmentVariableKeySchema.safeParse(key).success) {
      continue;
    }
    config[`shell_environment_policy.set.${key}`] = value;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}
