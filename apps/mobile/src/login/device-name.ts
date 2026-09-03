import Constants from "expo-constants";
import { Platform } from "react-native";

export function defaultDeviceName(): string {
  const named = Constants.deviceName;
  if (named !== undefined && named !== null && named.trim() !== "") return named;
  return Platform.OS === "ios" ? "iPhone" : "Android phone";
}
