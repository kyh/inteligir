import { createContext } from "react";

type Vertical = {
  vertical?: boolean;
};

type Bordered = {
  bordered?: boolean;
};

type Secondary = {
  secondary?: boolean;
};

type Pill = {
  pill?: boolean;
};

export type NavigationMenuProps = Vertical & (Bordered | Secondary | Pill);

export const NavigationMenuContext = createContext<NavigationMenuProps>({});
