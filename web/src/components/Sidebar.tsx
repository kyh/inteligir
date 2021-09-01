import { Button } from "components";
import { FiHome, FiCompass, FiBookmark } from "react-icons/fi";

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

export const SidebarNav = () => {
  return (
    <section className="flex flex-col h-full">
      <nav className="flex flex-col py-6">
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
        <div className="mb-1">
          ©{new Date().getFullYear()}, Made with{" "}
          <a
            className="hover:underline"
            href="https://github.com/kyh/inteligir"
            target="_blank"
            rel="noreferrer"
          >
            💻
          </a>
        </div>
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
    </section>
  );
};
