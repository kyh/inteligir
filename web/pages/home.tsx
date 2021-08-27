import { Fragment } from "react";
import { Menu, Transition } from "@headlessui/react";
import {
  FiHome,
  FiCompass,
  FiBookmark,
  FiSearch,
  FiBell,
} from "react-icons/fi";
import { SEO, Logo, Container, Button, Heading } from "components";
import { tw, cx } from "util/styles";

const navigation = [
  { name: "Home", href: "#", icon: FiHome, current: true },
  { name: "Explore", href: "#", icon: FiCompass, current: false },
  { name: "Bookmark", href: "#", icon: FiBookmark, current: false },
];

const user = {
  name: "Chelsea Hagon",
  email: "chelseahagon@example.com",
  imageUrl:
    "https://images.unsplash.com/photo-1550525811-e5869dd03032?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
};

const userNavigation = [
  { name: "Your Profile", href: "#" },
  { name: "Settings", href: "#" },
  { name: "Sign out", href: "#" },
];

const Header = tw(
  "header",
  "flex items-center h-[93px] border-b border-b-gray-400"
);

const NavContainer = tw(
  "section",
  "hidden sticky top-0 lg:block lg:w-[260px] lg:mr-16"
);
const Nav = tw("nav", "pt-14 pb-10 flex flex-col");

const ContentContainer = tw("main", "w-full");

const AsideContainer = tw("aside", "hidden xl:block xl:w-[500px] xl:ml-16");

export const HomePage = () => {
  return (
    <>
      <SEO />
      <Container>
        <NavContainer>
          <Header>
            <Logo />
          </Header>
          <Nav>
            {navigation.map((item) => (
              <Button
                key={item.name}
                as="a"
                href={item.href}
                variant="ghost"
                align="start"
                shape="rounded"
                className="-ml-4 my-1"
              >
                <item.icon aria-hidden="true" className="mr-4 w-5 h-5" />
                <span className="truncate">{item.name}</span>
              </Button>
            ))}
          </Nav>
          <Button shape="rounded" full>
            New Lesson
          </Button>
        </NavContainer>
        <ContentContainer>
          <Header>
            <Heading className="mb-0">Home</Heading>
          </Header>
        </ContentContainer>
        <AsideContainer>
          <Header className="flex justify-end">
            <Button shape="rounded" variant="ghost" size="sq" className="mr-2">
              <span className="sr-only">Search</span>
              <FiSearch className="h-6 w-6" aria-hidden="true" />
            </Button>
            <Button shape="rounded" variant="ghost" size="sq" className="mr-2">
              <span className="sr-only">View notifications</span>
              <FiBell className="h-6 w-6" aria-hidden="true" />
            </Button>
            <Menu>
              <Menu.Button className="rounded-full flex focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-800">
                <span className="sr-only">Open user menu</span>
                <img
                  className="h-8 w-8 rounded-full"
                  src={user.imageUrl}
                  alt=""
                />
              </Menu.Button>
              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <Menu.Items className="origin-top-right absolute z-10 right-0 mt-4 w-48 rounded-md shadow-lg bg-white ring-black ring-opacity-5 py-1 focus:outline-none">
                  {userNavigation.map((item) => (
                    <Menu.Item key={item.name}>
                      {({ active }) => (
                        <a
                          href={item.href}
                          className={cx(
                            "block py-2 px-4 text-sm text-gray-700",
                            active && "bg-gray-100"
                          )}
                        >
                          {item.name}
                        </a>
                      )}
                    </Menu.Item>
                  ))}
                </Menu.Items>
              </Transition>
            </Menu>
          </Header>
        </AsideContainer>
      </Container>

      <img
        style={{
          position: "absolute",
          top: "-150px",
          left: "-80px",
          width: "1600px",
          maxWidth: "unset",
          pointerEvents: "none",
          opacity: 0.1,
        }}
        src="/bg.png"
      />
    </>
  );
};

export default HomePage;
