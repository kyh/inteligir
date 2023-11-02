"use client";

import { useState } from "react";
import { SidebarContext } from "@/lib/contexts/sidebar-provider";
import { CsrfTokenContext } from "@/lib/csrf/csrf-provider";
import { Toaster } from "@inteligir/ui";

type AdminProvidersProps = {
  collapsed: boolean;
  csrfToken: string | null;
  language: string | undefined;
  children: React.ReactNode;
};

const AdminProviders = (props: AdminProvidersProps) => {
  const [collapsed, setCollapsed] = useState(props.collapsed);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      <CsrfTokenContext.Provider value={props.csrfToken}>
        <Toaster />
        {props.children}
      </CsrfTokenContext.Provider>
    </SidebarContext.Provider>
  );
};

export default AdminProviders;
