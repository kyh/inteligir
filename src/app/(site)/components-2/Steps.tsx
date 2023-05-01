"use client";

import { Tab } from "@headlessui/react";
import { Fragment } from "react";
import { Button } from "~/components/Button";
import { SectionTitle } from "./SectionTitle";

export const Steps = () => {
  return (
    <section className="px-5 pt-20 sm:pt-24">
      <SectionTitle as="h2">
        A complex problem <br /> with a simple solution.
      </SectionTitle>
      <Tab.Group>
        <Tab.List className="isolate mt-10 inline-flex">
          <Tab as={Fragment}>
            {({ selected }) => (
              <Button
                className="relative rounded-r-none focus:z-10"
                selected={selected}
              >
                Without Putcache
              </Button>
            )}
          </Tab>
          <Tab as={Fragment}>
            {({ selected }) => (
              <Button
                className="relative -ml-px rounded-l-none focus:z-10"
                selected={selected}
              >
                With Putcache
              </Button>
            )}
          </Tab>
        </Tab.List>
        <Tab.Panels className="mt-5">
          <Tab.Panel>Content 1</Tab.Panel>
          <Tab.Panel>Content 2</Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </section>
  );
};
