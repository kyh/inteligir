"use client";

import { BuildingStorefront, UserGroup, User } from "@inteligir/icons";
import Sidebar, { SidebarItem } from "ui/components/Sidebar";

const AdminSidebar = () => {
  return (
    <Sidebar>
      <SidebarItem
        Icon={() => <BuildingStorefront className="h-6" />}
        end
        path="/admin"
      >
        Admin
      </SidebarItem>
      <SidebarItem Icon={() => <User className="h-6" />} path="/admin/users">
        Users
      </SidebarItem>
      <SidebarItem
        Icon={() => <UserGroup className="h-6" />}
        path="/admin/organizations"
      >
        Organizations
      </SidebarItem>
    </Sidebar>
  );
};

export default AdminSidebar;
