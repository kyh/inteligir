// a markdown file imported as its text, which Vite's `?raw` hands the suites, Next's rule the app
// and eve's bundler the agent: the agent's prompt reads its files so
declare module "*.md?raw" {
  const text: string;
  export default text;
}
