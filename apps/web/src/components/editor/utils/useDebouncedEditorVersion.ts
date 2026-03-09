import { useEditorVersion, useValueVersion } from "platejs/react";

import { useDebounce } from "@/registry/hooks/use-debounce";

export const useDebouncedEditorVersion = (delay = 500) => {
  const version = useEditorVersion();

  return useDebounce(version, delay);
};

export const useDebouncedValueVersion = (delay = 500) => {
  const version = useValueVersion();

  return useDebounce(version, delay);
};
