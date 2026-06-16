import Constants from "expo-constants";
import { PRODUCTION_SERVER_HOST, SERVER_PORT } from "@repo/dispatch/room";

export const getServerHost = () => {
  if (process.env.EXPO_PUBLIC_SERVER_HOST) {
    return process.env.EXPO_PUBLIC_SERVER_HOST;
  }

  // Production builds connect to the deployed Worker.
  if (!__DEV__) {
    return PRODUCTION_SERVER_HOST;
  }

  // Dev: reach the local `wrangler dev` server via the Metro debugger host.
  const debuggerHost = Constants.expoConfig?.hostUri;
  const localhost = debuggerHost?.split(":")[0];

  if (!localhost) {
    throw new Error(
      "Failed to get localhost. Set EXPO_PUBLIC_SERVER_HOST or start the Expo dev server.",
    );
  }
  return `${localhost}:${SERVER_PORT}`;
};
