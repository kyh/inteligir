// Which hand the editor is drawn for. A context rather than a prop: the host sets it once around
// the column, and the surface, its chrome and the column's inset all read it. Unset is the desktop.

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
}) => <EditorProfileContext.Provider value={profile}>{children}</EditorProfileContext.Provider>;

export const useEditorProfile = (): EditorProfile => useContext(EditorProfileContext);
