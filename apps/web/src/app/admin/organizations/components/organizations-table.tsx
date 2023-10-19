"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { usePathname, useRouter } from "next/navigation";
import { EllipsisHorizontal } from "@inteligir/icons";
import Link from "next/link";
import DataTable from "ui/components/DataTable";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "ui/components/Dropdown";
import IconButton from "ui/components/IconButton";
import type { getOrganizations } from "@/app/admin/organizations/queries";
import SubscriptionStatusBadge from "@/app/dashboard/[organization]/components/organizations/SubscriptionStatusBadge";
import configuration from "@/configuration";

type Response = Awaited<ReturnType<typeof getOrganizations>>;
type Organizations = Response["organizations"];

const columns: ColumnDef<Organizations[0]>[] = [
  {
    header: "ID",
    accessorKey: "id",
    id: "id",
    size: 10,
  },
  {
    header: "UUID",
    accessorKey: "uuid",
    id: "uuid",
    size: 200,
  },
  {
    header: "Name",
    accessorKey: "name",
    id: "name",
  },
  {
    header: "Subscription",
    id: "subscription",
    cell: ({ row }) => {
      const priceId = row.original?.subscription?.data?.priceId;

      const plan = configuration.stripe.products.find((product) => {
        return product.plans.some((plan) => plan.stripePriceId === priceId);
      });

      if (plan) {
        const price = plan.plans.find((plan) => plan.stripePriceId === priceId);

        if (!price) {
          return "Unknown Price";
        }

        return `${plan.name} - ${price.name}`;
      }

      return "-";
    },
  },
  {
    header: "Subscription Status",
    id: "subscription-status",
    cell: ({ row }) => {
      const subscription = row.original?.subscription?.data;

      if (!subscription) {
        return "-";
      }

      return <SubscriptionStatusBadge subscription={subscription} />;
    },
  },
  {
    header: "Subscription Period",
    id: "subscription-period",
    cell: ({ row }) => {
      const subscription = row.original?.subscription?.data;

      if (!subscription) {
        return "-";
      }

      const canceled = subscription.cancelAtPeriodEnd;
      const date = subscription.periodEndsAt;
      const formattedDate = new Date(date).toLocaleDateString();

      return canceled ? (
        <span className="text-orange-500">Stops on {formattedDate}</span>
      ) : (
        <span className="text-green-500">Renews on {formattedDate}</span>
      );
    },
  },
  {
    header: "Members",
    id: "members",
    cell: ({ row }) => {
      const memberships = row.original.memberships.length;
      const uid = row.original.uuid;

      return (
        <Link
          className="cursor-pointer hover:underline"
          data-cy="organization-members-link"
          href={`organizations/${uid}/members`}
        >
          {memberships} member{memberships === 1 ? "" : "s"}
        </Link>
      );
    },
  },
  {
    header: "",
    id: "actions",
    cell: ({ row }) => {
      const organization = row.original;
      const uid = organization.uuid;

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
                onClick={() => navigator.clipboard.writeText(uid)}
              >
                Copy UUID
              </DropdownMenuItem>

              <DropdownMenuItem asChild>
                <Link href={`/admin/organizations/${uid}/members`}>
                  View Members
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
  },
];

const OrganizationsTable = ({
  organizations,
  pageCount,
  perPage,
  page,
}: React.PropsWithChildren<{
  organizations: Organizations;
  pageCount: number;
  perPage: number;
  page: number;
}>) => {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <DataTable
      columns={columns}
      data={organizations}
      onPaginationChange={({ pageIndex }) => {
        router.push(`${pathname}?page=${pageIndex + 1}`);
      }}
      pageCount={pageCount}
      pageIndex={page - 1}
      pageSize={perPage}
      tableProps={{
        "data-cy": "admin-organizations-table",
      }}
    />
  );
};

export default OrganizationsTable;
