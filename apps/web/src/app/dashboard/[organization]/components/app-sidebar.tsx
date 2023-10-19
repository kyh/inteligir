import React from "react";
import AppSidebarNavigation from "./app-sidebar-navigation";
import Sidebar from "ui/components/sidebar";

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
