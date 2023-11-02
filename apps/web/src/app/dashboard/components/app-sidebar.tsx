import React from "react";
import Sidebar from "@inteligir/ui/sidebar";
import AppSidebarNavigation from "./app-sidebar-navigation";

const AppSidebar: React.FC<{
  organizationUid: string;
}> = ({ organizationUid }) => {
  return (
    <Sidebar>
      <AppSidebarNavigation organization={organizationUid} />
    </Sidebar>
  );
};

export default AppSidebar;
