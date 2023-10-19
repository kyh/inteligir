import { createContext } from "react";
import type { UserOrganizationData } from "@/features/organizations/queries";

type OrganizationContextPayload = UserOrganizationData["organization"];

export const OrganizationContext = createContext<{
  organization: Maybe<OrganizationContextPayload>;
  setOrganization: (organization: Maybe<OrganizationContextPayload>) => void;
}>({
  organization: undefined,
  setOrganization: (_) => _,
});
