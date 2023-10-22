import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import { ChevronRight } from "@inteligir/icons";
import LogoImage from "ui/components/logo/logo-image";
import Container from "ui/components/container";
import If from "ui/components/if";
import Heading from "ui/components/heading";
import CardButton from "ui/components/card-button";
import getSupabaseServerClient from "@/lib/supabase/server-client";
import requireSession from "@/features/auth/require-session";
import getCurrentOrganization from "@/features/organizations/get-current-organization";
import { parseOrganizationIdCookie } from "@/features/organizations/organization-cookie";
import { getOrganizationsByUserId } from "@/lib/organizations/database/queries";
import initializeServerI18n from "@/i18n/i18n.server";
import getLanguageCookie from "@/i18n/get-language-cookie";
import AppContainer from "@/app/dashboard/[organization]/components/app-container";
import configuration from "@/configuration";
import NewOrganizationButtonContainer from "@/app/dashboard/components/new-organization-button-container";
import I18nProvider from "@/i18n/i18n-provider";
import { getUserById } from "@/lib/user/database/queries";

const OrganizationsPage = async () => {
  const client = getSupabaseServerClient();
  const session = await requireSession(client);
  const userId = session.user.id;
  const { data: user } = await getUserById(client, userId);

  if (!user?.onboarded) {
    redirect(configuration.paths.onboarding);
  }

  const organizationUidCookie = await parseOrganizationIdCookie(userId);

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

  const i18n = await initializeServerI18n(getLanguageCookie());
  const csrfToken = headers().get("X-CSRF-Token") ?? "";

  const organizations = data.map((item) => item.organization);

  if (organizations.length === 1) {
    const organization = organizations[0];
    const href = getAppHomeUrl(organization.uuid);

    return redirect(href);
  }

  return (
    <I18nProvider lang={i18n.language}>
      <div className="flex flex-col space-y-8">
        <OrganizationsPageHeader />

        <AppContainer>
          <Container>
            <div className="lg:grid-col-3 grid grid-cols-1 gap-4 xl:grid-cols-4 xl:gap-6">
              <NewOrganizationButtonContainer csrfToken={csrfToken} />

              {organizations.map((organization) => {
                const href = getAppHomeUrl(organization.uuid);

                return (
                  <CardButton
                    className="relative"
                    href={href}
                    key={organization.id}
                  >
                    <span
                      className={
                        "absolute left-6 top-4 flex justify-start" +
                        " h-full w-full items-center space-x-4"
                      }
                    >
                      <If condition={organization.logoURL}>
                        {(logo) => (
                          <Image
                            alt={`${organization.name} Logo`}
                            className="contain rounded-full"
                            height={36}
                            src={logo}
                            width={36}
                          />
                        )}
                      </If>

                      <span className="flex items-center space-x-2.5 text-base font-medium">
                        <span>{organization.name}</span>

                        <ChevronRight className="h-4" />
                      </span>
                    </span>
                  </CardButton>
                );
              })}
            </div>
          </Container>
        </AppContainer>
      </div>
    </I18nProvider>
  );
};

export default OrganizationsPage;

const OrganizationsPageHeader = () => {
  return (
    <div className="dark:border-dark-700 flex flex-1 items-center justify-between border-b border-gray-50 p-4">
      <div className="flex w-full flex-1 justify-between">
        <div className="flex items-center justify-between space-x-4 lg:space-x-0">
          <div className="flex items-center space-x-2 lg:space-x-4 xl:space-x-6">
            <LogoImage />

            <Heading type={5}>
              <span className="flex items-center space-x-0.5 lg:space-x-2">
                <span className="lg:text-initial text-base font-medium dark:text-white">
                  Your Organizations
                </span>
              </span>
            </Heading>
          </div>
        </div>
      </div>
    </div>
  );
};

const getAppHomeUrl = (organizationUid: string) =>
  [`${"/dashboard"}`, organizationUid].join("/");
