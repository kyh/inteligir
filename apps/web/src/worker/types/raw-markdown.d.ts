// vite's `?raw` suffix, which the Worker's build and its suites resolve alike: a file's text, bundled
declare module "*.md?raw" {
  const text: string;
  export default text;
}
