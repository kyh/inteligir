import Trans from "@inteligir/ui/trans";
import { cva } from "cva";
import Badge from "@inteligir/ui/badge";
import MembershipRole from "@/lib/organizations/types/membership-role";
import roles from "@/lib/organizations/roles";

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
      <span data-cy="member-role-badge">{data?.label}</span>
    </Badge>
  );
};

export default RoleBadge;
