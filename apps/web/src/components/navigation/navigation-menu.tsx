"use client";

import type { PropsWithChildren } from "react";
import { cva } from "@inteligir/ui";
import {
  NavigationMenuContext,
  type NavigationMenuProps,
} from "./navigation-menu-context";

const NavigationMenu = (props: PropsWithChildren<NavigationMenuProps>) => {
  const className = getNavigationMenuClassBuilder()(props);

  return (
    <ul className={className}>
      <NavigationMenuContext.Provider value={props}>
        {props.children}
      </NavigationMenuContext.Provider>
    </ul>
  );
};

export default NavigationMenu;

const getNavigationMenuClassBuilder = () =>
  cva(["flex w-full flex-wrap items-center dark:text-gray-300"], {
    variants: {
      vertical: {
        true: `flex items-start justify-between space-x-2
        lg:flex-col lg:justify-start lg:space-x-0 lg:space-y-1`,
      },
      bordered: {
        true: `dark:border-dark-800 border-b border-gray-100 pb-1.5 lg:space-x-3`,
      },
    },
  });
