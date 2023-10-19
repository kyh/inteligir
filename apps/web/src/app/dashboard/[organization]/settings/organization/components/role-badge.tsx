import { cva } from "cva";
import roles from "@/features/organizations/roles";
import Trans from "ui/components/Trans";
import MembershipRole from "@/lib/organizations/types/membership-role";
import Badge from "ui/components/Badge";

const roleClassNameBuilder = cva("font-medium", {
  variants: {
    role: {
      [MembershipRole.Owner]:
        "dark:text-dark-900 bg-yellow-100 text-current dark:bg-yellow-200",
      [MembershipRole.Admin]: "bg-blue-50 text-blue-500 dark:bg-blue-500/10",
      [MembershipRole.Member]: "bg-blue-50 text-blue-500 dark:bg-blue-500/10",
    },
  },
});

const RoleBadge: React.FCC<{
  role: MembershipRole;
}> = ({ role }) => {
  const data = roles.find((item) => item.value === role);
  const className = roleClassNameBuilder({ role });

  return (
    <Badge className={className} color="custom" size="small">
      <span data-cy="member-role-badge">
        <Trans i18nKey={data?.label} />
      </span>
    </Badge>
  );
};

export default RoleBadge;
