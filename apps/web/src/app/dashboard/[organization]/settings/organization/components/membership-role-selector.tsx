import Trans from "@inteligir/ui/trans";
import {
  Select,
  SelectItem,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@inteligir/ui/select";
import IfHasPermissions from "@/components/if-has-permissions";
import type MembershipRole from "@/lib/organizations/types/membership-role";
import roles from "@/lib/organizations/roles";
import { canInviteUser } from "@/lib/organizations/permissions";

const MembershipRoleSelector: React.FCC<{
  value?: MembershipRole;
  onChange?: (role: MembershipRole) => unknown;
}> = ({ value: currentRole, onChange }) => {
  const selectedRole = getSelectedRoleModel(currentRole);

  return (
    <Select
      onValueChange={(value) => {
        onChange?.(Number(value));
      }}
      value={selectedRole.value.toString()}
    >
      <SelectTrigger data-cy="role-selector-trigger">
        <SelectValue />
      </SelectTrigger>

      <SelectContent>
        {roles.map((role) => {
          return (
            <IfHasPermissions
              condition={(currentUserRole) =>
                canInviteUser(currentUserRole, role.value)
              }
              key={role.value}
            >
              <SelectItem
                data-cy={`role-item-${role.value}`}
                value={role.value.toString()}
              >
                <span className="text-sm">{role.label}</span>
              </SelectItem>
            </IfHasPermissions>
          );
        })}
      </SelectContent>
    </Select>
  );
};

const getSelectedRoleModel = (currentRole: MembershipRole | undefined) => {
  const memberRole = roles[2];

  return (
    roles.find((role) => {
      return role.value === currentRole;
    }) ?? memberRole
  );
};

export default MembershipRoleSelector;
