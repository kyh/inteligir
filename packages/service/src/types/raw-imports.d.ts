// Vite's `?raw` suffix, which Next's build and the suites resolve: a file's text, as the string it
// holds. The guide reads its files so.
declare module "*.md?raw" {
  const text: string;
  export default text;
}

// a page of the reader's corpus, which the fill's suites serve
declare module "*.html?raw" {
  const html: string;
  export default html;
}
