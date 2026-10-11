import Constants from "expo-constants";

export const defaultDeviceName = (): string => {
  const named = Constants.deviceName;
  if (named !== undefined && named !== null && named.trim() !== "") {
    return named;
  }
  return "iPhone";
};
