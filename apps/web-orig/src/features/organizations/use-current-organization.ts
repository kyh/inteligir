import { useContext } from "react";
import OrganizationContext from "@/features/organizations/organization-provider";

export const useCurrentOrganization = () => {
  const { organization } = useContext(OrganizationContext);

  return organization;
};
