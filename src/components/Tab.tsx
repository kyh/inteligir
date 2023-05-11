import Link from "next/link";
import { Tab as HeadlessTab } from "@headlessui/react";

const Tab: React.FCC<{
  href?: string;
  disabled?: boolean;
  queryParam?: string;
}> = ({ children, href, disabled, queryParam }) => {
  const useQueryParam = queryParam ?? `tab`;
  const link = href ? `?${useQueryParam}=${href}` : "";

  return (
    <HeadlessTab
      disabled={disabled}
      className={({ selected }) => (selected ? "TabSelected Tab" : "Tab")}
    >
      <Link href={link}>{children}</Link>
    </HeadlessTab>
  );
};

export default Tab;
