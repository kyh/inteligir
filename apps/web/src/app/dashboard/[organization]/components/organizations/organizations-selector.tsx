import { useCallback, useContext } from "react";
import Image from "next/image";
import { useParams, usePathname, useRouter } from "next/navigation";
import { PlusMini } from "@inteligir/icons";
import { SelectArrow } from "@radix-ui/react-select";
import {
  Select,
  SelectItem,
  SelectContent,
  SelectTrigger,
  SelectSeparator,
  SelectGroup,
  SelectAction,
  SelectLabel,
  SelectValue,
} from "@inteligir/ui/select";
import Trans from "@inteligir/ui/trans";
import { If } from "@/components/if";
import UserSessionContext from "@/features/auth/session-context";
import CreateOrganizationModal from "./create-organization-modal";
import type Organization from "@/lib/organizations/types/organization";
import useUserOrganizationsQuery from "@/lib/organizations/hooks/use-user-organizations-query";
import type MembershipRole from "@/lib/organizations/types/membership-role";
import useCurrentOrganization from "@/lib/organizations/hooks/use-current-organization";
import { configuration } from "@/lib/configuration";

const OrganizationsSelector = () => {
  const changeOrganization = useChangeOrganization();

  const organization = useCurrentOrganization();
  const { userSession } = useContext(UserSessionContext);

  const userId = userSession?.data?.id as string;
  const selectedOrganizationId = organization?.uuid;

  const { data, isLoading } = useUserOrganizationsQuery(userId);

  return (
    <Select
      onValueChange={(uuid) => {
        changeOrganization(uuid);
      }}
      value={selectedOrganizationId}
    >
      <SelectTrigger
        className="!h-9 !bg-transparent"
        data-cy="organization-selector"
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

          <OrganizationsOptions organizations={data ?? []} />

          <If condition={isLoading}>
            <SelectItem value={selectedOrganizationId ?? ""}>
              <OrganizationItem organization={organization} />
            </SelectItem>
          </If>
        </SelectGroup>

        <SelectSeparator />

        <SelectGroup>
          <CreateOrganizationModal
            Trigger={
              <SelectAction
                className="flex flex-row items-center space-x-2 truncate"
                data-cy="create-organization-button"
              >
                <PlusMini className="h-5" />
                <span>New organization</span>
              </SelectAction>
            }
          />
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

const OrganizationsOptions = (
  props: React.PropsWithChildren<{
    organizations: {
      organization: Organization;
      role: MembershipRole;
    }[];
  }>,
) => {
  return (
    <>
      {props.organizations.map(({ organization }) => {
        return (
          <SelectItem
            data-cy={`organization-selector-${organization.name}`}
            key={organization.uuid}
            value={organization.uuid}
          >
            <OrganizationItem organization={organization} />
          </SelectItem>
        );
      })}
    </>
  );
};

const OrganizationItem = ({
  organization,
}: {
  organization: Maybe<Organization>;
}) => {
  const imageSize = 18;

  if (!organization) {
    return null;
  }

  const { logoURL, name } = organization;

  return (
    <span
      className="flex max-w-[12rem] items-center space-x-2"
      data-cy="organization-selector-item"
    >
      <If condition={logoURL}>
        <span className="flex items-center">
          <Image
            alt={`${name} Logo`}
            className="object-contain"
            height={imageSize}
            src={logoURL as string}
            style={{
              width: imageSize,
              height: imageSize,
            }}
            width={imageSize}
          />
        </span>
      </If>

      <span className="w-auto truncate text-sm font-medium">{name}</span>
    </span>
  );
};

export default OrganizationsSelector;

const useChangeOrganization = () => {
  const path = usePathname();
  const params = useParams();
  const router = useRouter();

  return useCallback(
    (uuid: string) => {
      const appPrefix = configuration.paths.appPrefix;
      const organizationPath = `${appPrefix}/${uuid}`;
      const route = path.replace(`${appPrefix}/${params.organization}`, "");

      if (route !== undefined) {
        router.push(`${organizationPath}/${route}`);
      }
    },
    [params.organization, path, router],
  );
};
