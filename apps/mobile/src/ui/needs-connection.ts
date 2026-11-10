// What only the cloud can do needs a connection, and says so rather than wait for one.

import { onlineManager } from "@tanstack/react-query";
import { Alert } from "react-native";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";

// true while there is a connection; false once the person was told there is none
export const online = (): boolean => {
  if (!onlineManager.isOnline()) {
    Alert.alert(NEEDS_CONNECTION, "Try again once your library can be reached.");
    return false;
  }
  return true;
};
