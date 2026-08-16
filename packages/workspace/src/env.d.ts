// Ambient module declarations for the workspace UI: css side-effect imports
// and ?url / ?raw asset imports.
declare module "*.css";
declare module "*?url" {
  const url: string;
  export default url;
}
declare module "*?raw" {
  const content: string;
  export default content;
}
