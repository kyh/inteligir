import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type EditorProfile = "desktop" | "touch";

const EditorProfileContext = createContext<EditorProfile>("desktop");

export const EditorProfileProvider = ({
  children,
  profile,
}: {
  children: ReactNode;
  profile: EditorProfile;
}) => <EditorProfileContext value={profile}>{children}</EditorProfileContext>;

export const useEditorProfile = () => useContext(EditorProfileContext);
