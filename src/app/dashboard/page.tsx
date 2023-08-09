import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { getOrganizationsByUserId } from "~/lib/organizations/queries";
import { parseOrganizationIdCookie } from "~/lib/server/cookies/organization.cookie";
import getCurrentOrganization from "~/lib/server/organizations/get-current-organization";
import { getUserById } from "~/lib/user/queries";
import requireSession from "~/lib/user/require-session";
import { Button } from "~/components/Button";
import { Container } from "~/components/Container";
import { If } from "~/components/If";
import { Logo } from "~/components/Logo";
import { Text } from "~/components/Text";
import AppContainer from "~/app/dashboard/[organization]/components/AppContainer";
import NewOrganizationButtonContainer from "~/app/dashboard/components/NewOrganizationButtonContainer";

const OrganizationsPage = async () => {
  const client = getSupabaseServerClient();
  const session = await requireSession(client);
  const userId = session.user.id;
  const { data: user } = await getUserById(client, userId);

  if (!user || !user.onboarded) {
    redirect("/onboarding");
  }

  const organizationUidCookie = await parseOrganizationIdCookie();

  if (organizationUidCookie) {
    const currentOrganizationResponse = await getCurrentOrganization({
      userId,
      organizationUid: organizationUidCookie,
    })
      .then((response) => response.organization)
      .catch(() => null);

    if (currentOrganizationResponse) {
      redirect(getAppHomeUrl(organizationUidCookie));
    }
  }

  const { data, error } = await getOrganizationsByUserId(client, user.id);

  if (error) {
    throw error;
  }

  const csrfToken = headers().get("X-CSRF-Token") ?? "";

  const organizations = data.map((item) => item.organization);

  if (organizations.length === 1) {
    const organization = organizations[0];
    const href = getAppHomeUrl(organization.uuid);

    return redirect(href);
  }

  return (
    <div className="flex flex-col space-y-8">
      <OrganizationsPageHeader />
      <AppContainer>
        <Container>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-4 xl:gap-6">
            <NewOrganizationButtonContainer csrfToken={csrfToken} />
            {organizations.map((organization) => {
              const href = getAppHomeUrl(organization.uuid);

              return (
                <Button
                  as={Link}
                  className="relative"
                  key={organization.id}
                  href={href}
                >
                  <span className="absolute left-6 top-4 flex items-center space-x-4">
                    <If condition={organization.logoURL}>
                      {(logo) => (
                        <Image
                          width={36}
                          height={36}
                          className="rounded-full"
                          src={logo}
                          alt={`${organization.name} Logo`}
                        />
                      )}
                    </If>
                    <span className="flex items-center space-x-2.5 text-base font-medium">
                      <span>{organization.name}</span>
                      <ChevronRightIcon className="h-4" />
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        </Container>
      </AppContainer>
    </div>
  );
};

export default OrganizationsPage;

const OrganizationsPageHeader = () => {
  return (
    <div className="flex flex-1 items-center justify-between border-b border-border p-4">
      <div className="flex w-full flex-1 justify-between">
        <div className="flex items-center justify-between space-x-4 lg:space-x-0">
          <div className="flex items-center space-x-2 lg:space-x-4 xl:space-x-6">
            <Logo />
            <Text variant="heading2">
              <span className="flex items-center space-x-0.5 lg:space-x-2">
                <span className="text-base font-medium dark:text-white">
                  Your Organizations
                </span>
              </span>
            </Text>
          </div>
        </div>
      </div>
    </div>
  );
};

const getAppHomeUrl = (organizationUid: string) => {
  return ["/dashboard", organizationUid].join("/");
};
