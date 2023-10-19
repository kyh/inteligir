"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { EllipsisHorizontal } from "@inteligir/icons";
import DataTable from "ui/components/DataTable";
import { Avatar, AvatarFallback, AvatarImage } from "ui/components/Avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/components/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "ui/components/Dropdown";
import IconButton from "ui/components/IconButton";
import Badge from "ui/components/Badge";
import If from "ui/components/If";
import type UserData from "@/features/users/user-data";

type UserRow = {
  id: string;
  email: string | undefined;
  phone: string | undefined;
  createdAt: string;
  updatedAt: string | undefined;
  lastSignInAt: string | undefined;
  banDuration: string | undefined;
  data: UserData;
};

const columns: ColumnDef<UserRow>[] = [
  {
    header: "",
    id: "avatar",
    size: 10,
    cell: ({ row }) => {
      const user = row.original;
      const data = user.data;
      const displayName = data?.displayName;
      const photoUrl = data?.photoUrl;
      const displayText = displayName ?? user.email ?? user.phone ?? "";

      return (
        <Tooltip>
          <TooltipTrigger>
            <Avatar>
              {photoUrl ? <AvatarImage src={photoUrl} /> : null}
              <AvatarFallback>{displayText[0]}</AvatarFallback>
            </Avatar>
          </TooltipTrigger>

          <TooltipContent>{displayText}</TooltipContent>
        </Tooltip>
      );
    },
  },
  {
    header: "ID",
    id: "id",
    size: 30,
    cell: ({ row }) => {
      const id = row.original.id;

      return (
        <Link className="hover:underline" href={`/admin/users/${id}`}>
          {id}
        </Link>
      );
    },
  },
  {
    header: "Email",
    id: "email",
    cell: ({ row }) => {
      const email = row.original.email;

      return (
        <span className="block max-w-full truncate" title={email}>
          {email}
        </span>
      );
    },
  },
  {
    header: "Name",
    size: 50,
    id: "displayName",
    cell: ({ row }) => {
      return row.original.data?.displayName ?? "";
    },
  },
  {
    header: "Created at",
    id: "createdAt",
    cell: ({ row }) => {
      const date = new Date(row.original.createdAt);

      return (
        <span title={date.toLocaleString()}>{date.toLocaleDateString()}</span>
      );
    },
  },
  {
    header: "Last sign in",
    id: "lastSignInAt",
    cell: ({ row }) => {
      const lastSignInAt = row.original.lastSignInAt;

      if (!lastSignInAt) {
        return <span>-</span>;
      }

      const date = new Date(lastSignInAt);
      return <span suppressHydrationWarning>{date.toLocaleString()}</span>;
    },
  },
  {
    header: "Status",
    id: "status",
    cell: ({ row }) => {
      const banDuration = row.original.banDuration;

      if (!banDuration || banDuration === "none") {
        return (
          <Badge className="inline-flex" color="success" size="small">
            Active
          </Badge>
        );
      }

      return (
        <Badge className="inline-flex" color="error" size="small">
          Banned
        </Badge>
      );
    },
  },
  {
    header: "",
    id: "actions",
    cell: ({ row }) => {
      const user = row.original;
      const banDuration = row.original.banDuration;
      const isBanned = banDuration && banDuration !== "none";

      return (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton>
                <span className="sr-only">Open menu</span>
                <EllipsisHorizontal className="h-4 w-4" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => navigator.clipboard.writeText(user.id)}
              >
                Copy user ID
              </DropdownMenuItem>

              <If condition={!isBanned}>
                <DropdownMenuItem asChild>
                  <Link href={`/admin/users/${user.id}/impersonate`}>
                    Impersonate User
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <Link
                    className="text-red-500 hover:bg-red-50 dark:hover:bg-red-500/5"
                    href={`/admin/users/${user.id}/ban`}
                  >
                    Ban User
                  </Link>
                </DropdownMenuItem>
              </If>

              <If condition={isBanned}>
                <DropdownMenuItem asChild>
                  <Link href={`/admin/users/${user.id}/reactivate`}>
                    Reactivate User
                  </Link>
                </DropdownMenuItem>
              </If>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
  },
];

const UsersTable = ({
  users,
  page,
  pageCount,
  perPage,
}: React.PropsWithChildren<{
  users: UserRow[];
  pageCount: number;
  page: number;
  perPage: number;
}>) => {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <DataTable
      columns={columns}
      data={users}
      onPaginationChange={({ pageIndex }) => {
        router.push(`${pathname}?page=${pageIndex + 1}`);
      }}
      pageCount={pageCount}
      pageIndex={page - 1}
      pageSize={perPage}
      tableProps={{
        "data-cy": "admin-users-table",
      }}
    />
  );
};

export default UsersTable;
