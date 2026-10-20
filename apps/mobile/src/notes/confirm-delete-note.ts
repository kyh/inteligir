import { Alert } from "react-native";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { filesFreedBy } from "@/lib/app-runtime";
import { deleteQuestion } from "./delete-question";

// asks before an item is deleted, naming the files only it shows, which go with it, in the words
// the library's long press and the open item's menu share
export const confirmDeleteNote = (path: string, onDelete: () => void): void => {
  void (async () => {
    let freed = 0;
    try {
      const files = await filesFreedBy(path);
      freed = files.length;
    } catch {
      // the delete plans again when it runs; the question just names no file
    }
    Alert.alert(
      deleteQuestion(docStem(path), freed),
      "You can restore it from Deleted on your Mac.",
      [
        { style: "cancel", text: "Cancel" },
        { onPress: onDelete, style: "destructive", text: "Delete" },
      ],
    );
  })();
};
