import React from "react";
import AppSidebarNavigation from "./AppSidebarNavigation";
import Sidebar from "ui/components/Sidebar";

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
