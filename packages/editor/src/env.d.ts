// Ambient module declarations for the editor: css side-effect imports (katex,
// react-lite-youtube-embed) and ?url / ?raw asset imports.
declare module "*.css";
declare module "*?url" {
  const url: string;
  export default url;
}
declare module "*?raw" {
  const content: string;
  export default content;
}
