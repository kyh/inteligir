import Button from "~/core/ui/Button";
import Heading from "~/core/ui/Heading";
import Trans from "~/core/ui/Trans";

import SiteHeader from "~/app/(site)/components/SiteHeader";

import configuration from "~/configuration";
import initializeServerI18n from "~/i18n/i18n.server";
import getLanguageCookie from "~/i18n/get-language-cookie";

export const metadata = {
  title: `Page not found - ${configuration.site.name}`,
};

const NotFoundPage = async () => {
  await initializeServerI18n(getLanguageCookie());

  return (
    <main>
      <SiteHeader />

      <div className="m-auto flex min-h-[50vh] w-full items-center justify-center">
        <div className="flex flex-col space-y-8">
          <div className="flex space-x-8 divide-x divide-gray-100">
            <div>
              <Heading type={1}>
                <span
                  data-cy="catch-route-status-code"
                  className="text-primary-500"
                >
                  404
                </span>
              </Heading>
            </div>

            <div className="flex flex-col space-y-4 pl-8">
              <div className="flex flex-col space-y-2">
                <div>
                  <Heading type={1}>
                    <Trans i18nKey="common:pageNotFound" />
                  </Heading>
                </div>

                <p className="text-gray-500 dark:text-gray-300">
                  <Trans i18nKey="common:pageNotFoundSubHeading" />
                </p>
              </div>

              <div className="flex space-x-4">
                <Button color="secondary" href="/">
                  <Trans i18nKey="common:contactUs" />
                </Button>

                <Button href="/">
                  <Trans i18nKey="common:backToHomePage" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default NotFoundPage;
