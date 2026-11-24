import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { Alert } from "react-native";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";

export const online = () => {
  if (!onlineManager.isOnline()) {
    Alert.alert(NEEDS_CONNECTION, "Try again once your library can be reached.");

    return false;
  }

  return true;
};

export const useOnline = () =>
  useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
  );
