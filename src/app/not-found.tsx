import Button from "~/core/ui/Button";
import Heading from "~/core/ui/Heading";
import SiteHeader from "~/app/(site)/components/SiteHeader";
import configuration from "~/configuration";

export const metadata = {
  title: `Page not found - ${configuration.site.name}`,
};

const NotFoundPage = async () => {
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
                  <Heading type={1}>Oops. Page not Found.</Heading>
                </div>

                <p className="text-gray-500 dark:text-gray-300">
                  Apologies, the page you were looking for was not found
                </p>
              </div>

              <div className="flex space-x-4">
                <Button color="secondary" href="/">
                  Contact Us
                </Button>
                <Button href="/">Back to Home Page</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default NotFoundPage;
