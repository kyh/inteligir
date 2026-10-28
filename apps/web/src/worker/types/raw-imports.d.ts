// a suite's text fixture read through vite's `?raw` suffix, as the string the file holds
declare module "*.html?raw" {
  const text: string;
  export default text;
}
