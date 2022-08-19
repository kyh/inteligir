import { Link } from "@remix-run/react";
import { FiHome, FiCompass, FiBookmark } from "react-icons/fi";
import { buttonStyles } from "~/components/Button";

const navigation = [
  { name: "Home", href: "/home", icon: FiHome, current: true },
  { name: "Explore", href: "/explore", icon: FiCompass, current: false },
  { name: "Bookmark", href: "/bookmark", icon: FiBookmark, current: false },
];

const footerNavigation = [
  { name: "About", href: "/about" },
  { name: "Privacy", href: "/privacy" },
  { name: "Terms", href: "/terms" },
];

export const SidebarNav = () => {
  return (
    <section className="flex flex-col h-full">
      <nav className="flex flex-col py-6">
        {navigation.map((item) => (
          <div className="my-1 -mx-4" key={item.name}>
            <Link
              to={item.href}
              className={buttonStyles({
                $variant: "ghost",
                $align: "start",
                $shape: "rounded",
                $full: true,
              })}
            >
              <item.icon aria-hidden="true" className="w-5 h-5 mr-4" />
              <span className="truncate">{item.name}</span>
            </Link>
          </div>
        ))}
      </nav>
      <Link
        to="/lesson/new"
        className={buttonStyles({ $shape: "rounded", $full: true })}
      >
        New Lesson
      </Link>
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
            <Link
              key={item.name}
              to={item.href}
              className="inline-block mr-1 hover:underline"
            >
              {item.name}
            </Link>
          ))}
        </div>
      </footer>
    </section>
  );
};
