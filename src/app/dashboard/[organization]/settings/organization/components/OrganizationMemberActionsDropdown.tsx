import {
  MoreVerticalIcon,
  ReplaceIcon,
  UserCircleIcon,
  XIcon,
} from "lucide-react";
import { Button } from "~/components/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/Dropdown";
import If from "~/components/If";

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
        <Button data-cy="member-actions-dropdown" disabled={props.disabled}>
          <span className="sr-only">Open members actions menu</span>
          <MoreVerticalIcon className="h-6" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent collisionPadding={{ right: 50 }}>
        <DropdownMenuItem
          className="cursor-pointer"
          data-cy="update-member-role-action"
          onClick={props.onChangeRoleSelected}
        >
          <span className="flex items-center space-x-2">
            <ReplaceIcon className="h-5" />
            <span>Change Role</span>
          </span>
        </DropdownMenuItem>

        <If condition={props.isOwner}>
          <DropdownMenuItem
            className="cursor-pointer"
            data-cy="transfer-ownership-action"
            onClick={props.onTransferOwnershipSelected}
          >
            <span className="flex items-center space-x-2">
              <UserCircleIcon className="h-5" />
              <span>Transfer Ownership</span>
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
            <XIcon className="h-5" />
            <span>Remove</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default OrganizationMemberActionsDropdown;
