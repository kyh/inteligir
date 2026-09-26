import { Alert } from "react-native";
import { docStem } from "@repo/notes/knowledge/doc-file";

// asks before a note is deleted, in the words the list's long press and the open note's menu share
export const confirmDeleteNote = (path: string, onDelete: () => void): void => {
  Alert.alert(`Delete ${docStem(path)}?`, "You can restore it from Deleted on your Mac.", [
    { style: "cancel", text: "Cancel" },
    { onPress: onDelete, style: "destructive", text: "Delete" },
  ]);
};
