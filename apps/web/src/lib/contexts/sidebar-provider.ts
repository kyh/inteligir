import { createContext, useCallback, useState } from "react";
import { setCookie } from "@/lib/utils/cookies";

export const SidebarContext = createContext<{
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}>({
  collapsed: false,
  setCollapsed: (_) => _,
});

const SIDEBAR_COLLAPSED_STORAGE_KEY = "sidebarState";

export const useCollapsible = (initialValue?: boolean) => {
  const [isCollapsed, setIsCollapsed] = useState(initialValue);

  const onCollapseChange = useCallback((collapsed: boolean) => {
    setIsCollapsed(collapsed);
    storeCollapsibleState(collapsed);
  }, []);

  return [isCollapsed, onCollapseChange] as [boolean, typeof onCollapseChange];
};

const storeCollapsibleState = (collapsed: boolean) => {
  setCookie(
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    collapsed ? "collapsed" : "expanded",
  );
};
