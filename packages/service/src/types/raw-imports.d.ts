declare module "*.md?raw" {
  const text: string;
  export default text;
}

declare module "*.html?raw" {
  const html: string;
  export default html;
}
