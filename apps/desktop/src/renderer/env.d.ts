declare module "*.css";
declare module "*?url" {
  const url: string;
  export default url;
}

interface Window {
  desktopBridge?: import("@repo/core/ipc").DesktopBridge;
}
