import "../app/globals.css";
import Head from "next/head";
import Link from "next/link";
import configuration from "~/configuration";
import { Button } from "~/components/Button";
import Heading from "~/components/Heading";
import { TopNavigation } from "~/app/(marketing)/components/TopNavigation";

const InternalServerErrorPage = () => {
  return (
    <>
      <Head>
        <title key="title">{`An error occurred - ${configuration.site.name}`}</title>
      </Head>
      <TopNavigation />
      <div className="m-auto flex min-h-[50vh] w-full items-center justify-center">
        <div className="flex flex-col space-y-8">
          <div className="flex space-x-8 divide-x divide-zinc-100">
            <div>
              <Heading type={1}>
                <span className="text-emerald-500">500</span>
              </Heading>
            </div>

            <div className="flex flex-col space-y-4 pl-8">
              <div className="flex flex-col space-y-2">
                <div>
                  <Heading type={1}>Oooops. An error occurred</Heading>
                </div>

                <p className="text-zinc-500 dark:text-zinc-300">
                  Apologies, an error occurred while processing your request.
                  Please contact us if the issue persists.
                </p>
              </div>

              <div className="flex space-x-4">
                <Button as={Link} href="/">
                  Contact Us
                </Button>

                <Button as={Link} href="/">
                  Back to Home Page
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default InternalServerErrorPage;
