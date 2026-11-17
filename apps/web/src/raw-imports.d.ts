// a markdown file imported as its text, which Vitest's `?raw` hands the suites
declare module "*.md?raw" {
  const text: string;
  export default text;
}
