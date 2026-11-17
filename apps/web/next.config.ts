import type { NextConfig } from "next";

const config: NextConfig = {
  // Else `next dev` writes its own `apps/web/AGENTS.md`; the guidance is the root's.
  agentRules: false,
  reactCompiler: true,
};

export default config;
