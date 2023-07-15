import type { PropsWithChildren } from "react";
import { cn } from "~/lib/utils";

type BaseProps = {
  vertical?: boolean;
};

type Props = BaseProps &
  (
    | {
        bordered?: boolean;
      }
    | {
        secondary?: boolean;
      }
    | {
        pill?: boolean;
      }
  );

const NavigationMenu = (props: PropsWithChildren<Props>) => {
  return (
    <nav
      className={cn(`NavigationMenu`, {
        PillNavigationMenu: "pill" in props && props.pill,
        BorderedNavigationMenu: "bordered" in props && props.bordered,
        SecondaryNavigationMenu: "secondary" in props && props.secondary,
        VerticalNavigationMenu: props.vertical,
      })}
    >
      {props.children}
    </nav>
  );
};

export default NavigationMenu;
