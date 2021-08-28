import { Logo, Button, TopbarHeader } from "components";
import { FiHome, FiCompass, FiBookmark } from "react-icons/fi";
import { tw } from "util/styles";

const navigation = [
  { name: "Home", href: "#", icon: FiHome, current: true },
  { name: "Explore", href: "#", icon: FiCompass, current: false },
  { name: "Bookmark", href: "#", icon: FiBookmark, current: false },
];

const footerNavigation = [
  { name: "About", href: "#" },
  { name: "Privacy", href: "#" },
  { name: "Terms", href: "#" },
];

export const SidebarFixed = tw.div`fixed flex flex-col h-screen`;

export const Sidebar = () => {
  return (
    <section className="hidden flex-grow-0 flex-shrink-0 w-[200px] lg:block">
      <SidebarFixed className="w-[200px]">
        <TopbarHeader>
          <Logo />
        </TopbarHeader>
        <nav className="flex flex-col py-10">
          {navigation.map((item) => (
            <Button
              key={item.name}
              as="a"
              href={item.href}
              variant="ghost"
              align="start"
              shape="rounded"
              className="my-1 -ml-4"
            >
              <item.icon aria-hidden="true" className="w-5 h-5 mr-4" />
              <span className="truncate">{item.name}</span>
            </Button>
          ))}
        </nav>
        <Button shape="rounded" full>
          New Lesson
        </Button>
        <footer className="py-4 mt-auto text-xs border-t border-t-gray-400">
          <div className="mb-1">©2021, Kyh Inc.</div>
          <div>
            {footerNavigation.map((item) => (
              <a
                className="inline-block mr-1 hover:underline"
                key={item.name}
                href={item.href}
              >
                {item.name}
              </a>
            ))}
          </div>
        </footer>
      </SidebarFixed>
    </section>
  );
};
