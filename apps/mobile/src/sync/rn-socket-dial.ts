import type { DialledSocket, SocketDial } from "@repo/api/cloud/sync/cloud-socket";

// the program types the global with the DOM's constructor, which takes no headers; React Native's
// takes them third, and the bearer has to ride the upgrade.
const ReactNativeWebSocket: new (
  url: string,
  protocols: undefined,
  options: { headers: Record<string, string> },
) => DialledSocket = WebSocket;

export const rnSocketDial: SocketDial = (url, headers) =>
  new ReactNativeWebSocket(url, undefined, { headers });
