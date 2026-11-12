// vite's `?raw` suffix, which the Worker's build and its suites resolve: a file's text, as the string
// it holds. The agent's prompt reads @repo/agent-skills so, and a suite its HTML fixtures.
declare module "*.md?raw" {
  const text: string;
  export default text;
}

declare module "*.html?raw" {
  const text: string;
  export default text;
}
