// vite's `?raw` suffix, which the Worker's suites resolve: a file's text, as the string it holds. A
// suite reads its HTML fixtures so.
declare module "*.html?raw" {
  const text: string;
  export default text;
}
