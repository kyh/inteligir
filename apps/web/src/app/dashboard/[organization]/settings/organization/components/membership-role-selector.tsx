import roles from "@/features/organizations/roles";
import { canInviteUser } from "@/features/organizations/permissions";
import Trans from "ui/components/trans";
import {
  Select,
  SelectItem,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "ui/components/select";
import type MembershipRole from "@/lib/organizations/types/membership-role";
import IfHasPermissions from "@/components/if-has-permissions";

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
                <span className="text-sm">
                  <Trans i18nKey={role.label} />
                </span>
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
