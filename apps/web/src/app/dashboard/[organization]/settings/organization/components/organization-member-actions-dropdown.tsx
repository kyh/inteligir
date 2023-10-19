import {
  Adjustments,
  EllipsisVertical,
  UserCircleMini,
  XMarkMini,
} from "@inteligir/icons";
import Trans from "ui/components/Trans";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "ui/components/Dropdown";
import IconButton from "ui/components/IconButton";
import If from "ui/components/If";

const OrganizationMemberActionsDropdown: React.FCC<{
  onRemoveSelected: EmptyCallback;
  onChangeRoleSelected: EmptyCallback;
  onTransferOwnershipSelected: EmptyCallback;
  disabled: boolean;
  isOwner: boolean;
}> = (props) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={props.disabled}>
        <IconButton
          data-cy="member-actions-dropdown"
          disabled={props.disabled}
          label="Open members actions menu"
        >
          <EllipsisVertical className="h-6" />
        </IconButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent collisionPadding={{ right: 50 }}>
        <DropdownMenuItem
          className="cursor-pointer"
          data-cy="update-member-role-action"
          onClick={props.onChangeRoleSelected}
        >
          <span className="flex items-center space-x-2">
            <Adjustments className="h-5" />

            <span>
              <Trans i18nKey="organization:changeRole" />
            </span>
          </span>
        </DropdownMenuItem>

        <If condition={props.isOwner}>
          <DropdownMenuItem
            className="cursor-pointer"
            data-cy="transfer-ownership-action"
            onClick={props.onTransferOwnershipSelected}
          >
            <span className="flex items-center space-x-2">
              <UserCircleMini className="h-5" />
              <span>
                <Trans i18nKey="organization:transferOwnership" />
              </span>
            </span>
          </DropdownMenuItem>
        </If>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="cursor-pointer focus:!bg-red-50 dark:focus:!bg-red-500/10"
          data-cy="remove-member-action"
          onClick={props.onRemoveSelected}
        >
          <span className="flex items-center space-x-2 text-red-700 dark:text-red-500">
            <XMarkMini className="h-5" />
            <span>
              <Trans i18nKey="organization:removeMember" />
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default OrganizationMemberActionsDropdown;
