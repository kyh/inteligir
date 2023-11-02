"use client";

import Link from "next/link";
import { EllipsisVertical } from "@inteligir/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@inteligir/ui";
import { If } from "@/components/if";
import Button from "@inteligir/ui/button";

const UserActionsDropdown = ({
  uid,
  isBanned,
}: React.PropsWithChildren<{
  uid: string;
  isBanned: boolean;
}>) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">
          <span className="flex items-center space-x-2.5">
            <span>Manage User</span>
            <EllipsisVertical className="w-4" />
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <Link href={`/admin/users/${uid}/impersonate`}>Impersonate</Link>
        </DropdownMenuItem>

        <If condition={!isBanned}>
          <DropdownMenuItem asChild>
            <Link className="text-red-500" href={`/admin/users/${uid}/ban`}>
              Ban
            </Link>
          </DropdownMenuItem>
        </If>

        <If condition={isBanned}>
          <DropdownMenuItem asChild>
            <Link href={`/admin/users/${uid}/reactivate`}>Reactivate</Link>
          </DropdownMenuItem>
        </If>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserActionsDropdown;
