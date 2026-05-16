import Constants from "expo-constants";

export const getBaseUrl = () => {
  // Production: use the configured API URL
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // Development: extract the dev server host from Expo config
  const debuggerHost = Constants.expoConfig?.hostUri;
  const localhost = debuggerHost?.split(":")[0];

  if (!localhost) {
    throw new Error(
      "Failed to get localhost. Set EXPO_PUBLIC_API_URL or start the Expo dev server.",
    );
  }
  return `http://${localhost}:3000`;
};

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
  return `${localhost}:1999`;
};
