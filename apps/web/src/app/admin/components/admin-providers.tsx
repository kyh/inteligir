"use client";

import { useState } from "react";
import SidebarContext from "@/lib/contexts/sidebar-provider";
import CsrfTokenContext from "@/lib/csrf/csrf-provider";
import I18nProvider from "@/i18n/i18n-provider";
import Toaster from "@/components/toaster";

const AdminProviders = (
  props: React.PropsWithChildren<{
    collapsed: boolean;
    csrfToken: string | null;
    language: string | undefined;
  }>,
) => {
  const [collapsed, setCollapsed] = useState(props.collapsed);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      <I18nProvider lang={props.language}>
        <CsrfTokenContext.Provider value={props.csrfToken}>
          <Toaster />

          {props.children}
        </CsrfTokenContext.Provider>
      </I18nProvider>
    </SidebarContext.Provider>
  );
};

export default AdminProviders;
