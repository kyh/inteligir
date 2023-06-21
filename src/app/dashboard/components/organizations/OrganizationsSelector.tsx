import { useCallback, useContext, useState, useTransition } from "react";
import { PlusCircleIcon } from "@heroicons/react/24/outline";
import { SelectArrow } from "@radix-ui/react-select";
import useRefresh from "~/core/hooks/use-refresh";
import UserSessionContext from "~/core/session/contexts/user-session";
import useCurrentOrganization from "~/lib/organizations/hooks/use-current-organization";
import useSetCurrentOrganization from "~/lib/organizations/hooks/use-set-current-organization";
import useUserOrganizationsQuery from "~/lib/organizations/hooks/use-user-organizations-query";
import type MembershipRole from "~/lib/organizations/types/membership-role";
import type Organization from "~/lib/organizations/types/organization";
import If from "~/components/If";
import {
  Select,
  SelectAction,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "~/components/Select";
import CreateOrganizationModal from "./CreateOrganizationModal";

const OrganizationsSelector = () => {
  const [isOrganizationModalOpen, setIsOrganizationModalOpen] = useState(false);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const organization = useCurrentOrganization();
  const { userSession } = useContext(UserSessionContext);
  const refresh = useRefresh();
  const setCurrentOrganizationMutation = useSetCurrentOrganization();

  const userId = userSession?.data?.id as string;
  const selectedOrganizationId = organization?.id.toString();

  const { data, isLoading } = useUserOrganizationsQuery(userId);

  const onOrganizationChange = useCallback(
    async (organizationId: string) => {
      await setCurrentOrganizationMutation.trigger(organizationId);

      startTransition(() => {
        refresh();
      });
    },
    [refresh, setCurrentOrganizationMutation]
  );

  const isChangingOrganization =
    isPending || setCurrentOrganizationMutation.isMutating;

  return (
    <>
      <Select
        disabled={isChangingOrganization}
        open={isSelectOpen}
        value={selectedOrganizationId}
        onOpenChange={setIsSelectOpen}
        onValueChange={onOrganizationChange}
      >
        <SelectTrigger
          data-cy="organization-selector"
          className="!bg-transparent"
        >
          <span className="max-w-[5rem] text-sm lg:max-w-[12rem] lg:text-base">
            <OrganizationItem organization={organization} />

            <span hidden>
              <SelectValue />
            </span>
          </span>
        </SelectTrigger>

        <SelectContent position="popper">
          <SelectArrow />

          <SelectGroup>
            <SelectLabel>Your Organizations</SelectLabel>

            <SelectSeparator />

            <OrganizationsOptions
              organizations={data ?? []}
              organizationId={organization?.id}
            />

            <If condition={isLoading}>
              <SelectItem value={selectedOrganizationId ?? ""}>
                <OrganizationItem organization={organization} />
              </SelectItem>
            </If>
          </SelectGroup>

          <SelectSeparator />

          <SelectGroup>
            <SelectAction
              onClick={() => {
                setIsSelectOpen(false);
                setIsOrganizationModalOpen(true);
              }}
            >
              <span
                data-cy="create-organization-button"
                className="flex flex-row items-center space-x-2 truncate"
              >
                <PlusCircleIcon className="h-5" />

                <span>New organization</span>
              </span>
            </SelectAction>
          </SelectGroup>
        </SelectContent>
      </Select>

      <CreateOrganizationModal
        setIsOpen={setIsOrganizationModalOpen}
        isOpen={isOrganizationModalOpen}
      />
    </>
  );
};

function OrganizationsOptions(
  props: React.PropsWithChildren<{
    organizations: Array<{
      organization: Organization;
      role: MembershipRole;
    }>;
    organizationId: Maybe<number>;
  }>
) {
  return (
    <>
      {props.organizations.map(({ organization }) => {
        return (
          <SelectItem
            data-cy={`organization-selector-${organization.name}`}
            value={organization.id.toString()}
            key={organization.id}
          >
            <OrganizationItem organization={organization} />
          </SelectItem>
        );
      })}
    </>
  );
}

function OrganizationItem({
  organization,
}: {
  organization: Maybe<Organization>;
}) {
  const imageSize = 18;

  if (!organization) {
    return null;
  }

  const { logoURL, name } = organization;

  return (
    <span
      data-cy="organization-selector-item"
      className="flex max-w-[12rem] items-center space-x-2"
    >
      <If condition={logoURL}>
        <span className="flex items-center">
          <img
            loading="lazy"
            style={{
              width: imageSize,
              height: imageSize,
            }}
            width={imageSize}
            height={imageSize}
            alt={`${name} Logo`}
            className="object-contain"
            src={logoURL as string}
          />
        </span>
      </If>

      <span className="w-auto truncate text-sm font-medium">{name}</span>
    </span>
  );
}

export default OrganizationsSelector;
