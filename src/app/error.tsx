"use client";

import Link from "next/link";
import configuration from "~/configuration";
import { Button } from "~/components/Button";
import { Text } from "~/components/Text";
import { TopNavigation } from "~/app/(marketing)/components/TopNavigation";

export const metadata = {
  title: `An error occurred - ${configuration.site.name}`,
};

const ErrorPage = () => {
  return (
    <main>
      <TopNavigation userSession={undefined}/>
      <div className="m-auto flex min-h-[50vh] w-full items-center justify-center">
        <div className="flex flex-col space-y-8">
          <div className="flex space-x-8 divide-x divide-zinc-100">
            <div>
              <Text as="h1" variant="heading1">
                500
              </Text>
            </div>
            <div className="flex flex-col space-y-4 pl-8">
              <div className="flex flex-col space-y-2">
                <Text as="h2" variant="heading2">Oooops. An error occurred</Text>
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
    </main>
  );
};

export default ErrorPage;
