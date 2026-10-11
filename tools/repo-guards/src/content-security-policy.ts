// `name value; name value` as a map from each directive to its sources, so two policies compare
// by directive rather than by spelling
export const policyDirectives = (policy: string): Record<string, string> =>
  Object.fromEntries(
    policy.split("; ").map((entry) => {
      const space = entry.indexOf(" ");
      return [entry.slice(0, space), entry.slice(space + 1)];
    }),
  );
