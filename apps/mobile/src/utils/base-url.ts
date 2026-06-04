import Constants from "expo-constants";
import { DEFAULT_PARTY_HOST } from "@repo/dispatch";

export const getPartyHost = () => {
  if (process.env.EXPO_PUBLIC_PARTY_HOST) {
    return process.env.EXPO_PUBLIC_PARTY_HOST;
  }

  const debuggerHost = Constants.expoConfig?.hostUri;
  const localhost = debuggerHost?.split(":")[0];

  if (!localhost) {
    throw new Error(
      "Failed to get localhost. Set EXPO_PUBLIC_PARTY_HOST or start the Expo dev server.",
    );
  }
  return `${localhost}:${DEFAULT_PARTY_HOST.split(":")[1]}`;
};
