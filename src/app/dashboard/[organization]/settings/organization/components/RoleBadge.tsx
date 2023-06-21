import roles from "~/lib/organizations/roles";
import MembershipRole from "~/lib/organizations/types/membership-role";
import { Badge, type BadgeProps } from "~/components/Badge";

const roleToColor: Record<MembershipRole, BadgeProps["color"]> = {
  [MembershipRole.Owner]: "warn",
  [MembershipRole.Admin]: "success",
  [MembershipRole.Member]: "info",
};

const RoleBadge: React.FCC<{
  role: MembershipRole;
}> = ({ role }) => {
  const data = roles.find((item) => item.value === role);

  return (
    <Badge color={roleToColor[role]}>
      <span data-cy="member-role-badge">{data?.label}</span>
    </Badge>
  );
};

export default RoleBadge;
