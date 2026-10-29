// vite's `?raw` suffix, which the Worker's build and its suites resolve alike: a file's text, as the
// string it holds. A suite reads its HTML fixtures so; the Worker reads the agent's definition
// (`../agent/session-agent.ts`)
declare module "*.html?raw" {
  const text: string;
  export default text;
}

declare module "*.md?raw" {
  const text: string;
  export default text;
}
