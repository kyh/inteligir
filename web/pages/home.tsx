import { Fragment } from "react";
import { Menu, Transition } from "@headlessui/react";
import {
  FiHome,
  FiCompass,
  FiBookmark,
  FiSearch,
  FiBell,
  FiMoreVertical,
  FiStar,
  FiCode,
  FiFlag,
  FiThumbsUp,
  FiMessageCircle,
  FiEye,
  FiShare,
  FiPlusCircle,
} from "react-icons/fi";
import { SEO, Logo, Container, Button, Heading } from "components";
import { tw, cx } from "util/styles";

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

const questions = [
  {
    id: "81614",
    likes: "29",
    replies: "11",
    views: "2.7k",
    author: {
      name: "Dries Vincent",
      imageUrl:
        "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
      href: "#",
    },
    date: "December 9 at 11:43 AM",
    datetime: "2020-12-09T11:43:00",
    href: "#",
    title: "What would you have done differently if you ran Jurassic Park?",
    body: `
      <p>Jurassic Park was an incredible idea and a magnificent feat of engineering, but poor protocols and a disregard for human safety killed what could have otherwise been one of the best businesses of our generation.</p>
      <p>Ultimately, I think that if you wanted to run the park successfully and keep visitors safe, the most important thing to prioritize would be&hellip;</p>
    `,
  },
  // More questions...
];

const whoToFollow = [
  {
    name: "Leonard Krasner",
    handle: "leonardkrasner",
    href: "#",
    imageUrl:
      "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
  },
  // More people...
];

const trendingPosts = [
  {
    id: 1,
    user: {
      name: "Floyd Miles",
      imageUrl:
        "https://images.unsplash.com/photo-1463453091185-61582044d556?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    },
    body: "What books do you have on your bookshelf just to look smarter than you actually are?",
    comments: 291,
  },
  // More posts...
];

const Header = tw(
  "header",
  "flex items-center h-[93px] border-b border-b-gray-400"
);

const NavContainer = tw(
  "section",
  "hidden flex-col lg:flex lg:w-[260px] lg:mr-16"
);
const Nav = tw("nav", "py-10 flex flex-col");
const Footer = tw("footer", "mt-auto text-xs py-4 border-t border-t-gray-400");

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
                className="my-1 -ml-4"
              >
                <item.icon aria-hidden="true" className="w-5 h-5 mr-4" />
                <span className="truncate">{item.name}</span>
              </Button>
            ))}
          </Nav>
          <Button shape="rounded" full>
            New Lesson
          </Button>
          <Footer>
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
          </Footer>
        </NavContainer>
        <ContentContainer>
          <Header>
            <Heading className="mb-0">Home</Heading>
          </Header>
          <ul role="list" className="my-5">
            {questions.map((question) => (
              <li
                key={question.id}
                className="px-4 py-6 bg-white border-b sm:p-6 border-b-gray-400"
              >
                <article aria-labelledby={"question-title-" + question.id}>
                  <div>
                    <div className="flex space-x-3">
                      <div className="flex-shrink-0">
                        <img
                          className="w-10 h-10 rounded-full"
                          src={question.author.imageUrl}
                          alt=""
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          <a
                            href={question.author.href}
                            className="hover:underline"
                          >
                            {question.author.name}
                          </a>
                        </p>
                        <p className="text-sm text-gray-500">
                          <a href={question.href} className="hover:underline">
                            <time dateTime={question.datetime}>
                              {question.date}
                            </time>
                          </a>
                        </p>
                      </div>
                      <div className="flex self-center flex-shrink-0">
                        <Menu
                          as="div"
                          className="relative inline-block text-left"
                        >
                          <Menu.Button className="flex items-center p-2 -m-2 text-gray-400 rounded-full hover:text-gray-600">
                            <span className="sr-only">Open options</span>
                            <FiMoreVertical
                              className="w-5 h-5"
                              aria-hidden="true"
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
                            <Menu.Items className="absolute right-0 w-56 mt-2 origin-top-right bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                              <div className="py-1">
                                <Menu.Item>
                                  {({ active }) => (
                                    <a
                                      href="#"
                                      className={cx(
                                        active
                                          ? "bg-gray-100 text-gray-900"
                                          : "text-gray-700",
                                        "flex px-4 py-2 text-sm"
                                      )}
                                    >
                                      <FiStar
                                        className="w-5 h-5 mr-3 text-gray-400"
                                        aria-hidden="true"
                                      />
                                      <span>Add to favorites</span>
                                    </a>
                                  )}
                                </Menu.Item>
                                <Menu.Item>
                                  {({ active }) => (
                                    <a
                                      href="#"
                                      className={cx(
                                        active
                                          ? "bg-gray-100 text-gray-900"
                                          : "text-gray-700",
                                        "flex px-4 py-2 text-sm"
                                      )}
                                    >
                                      <FiCode
                                        className="w-5 h-5 mr-3 text-gray-400"
                                        aria-hidden="true"
                                      />
                                      <span>Embed</span>
                                    </a>
                                  )}
                                </Menu.Item>
                                <Menu.Item>
                                  {({ active }) => (
                                    <a
                                      href="#"
                                      className={cx(
                                        active
                                          ? "bg-gray-100 text-gray-900"
                                          : "text-gray-700",
                                        "flex px-4 py-2 text-sm"
                                      )}
                                    >
                                      <FiFlag
                                        className="w-5 h-5 mr-3 text-gray-400"
                                        aria-hidden="true"
                                      />
                                      <span>Report content</span>
                                    </a>
                                  )}
                                </Menu.Item>
                              </div>
                            </Menu.Items>
                          </Transition>
                        </Menu>
                      </div>
                    </div>
                    <h2
                      id={"question-title-" + question.id}
                      className="mt-4 text-base font-medium text-gray-900"
                    >
                      {question.title}
                    </h2>
                  </div>
                  <div
                    className="mt-2 space-y-4 text-sm text-gray-700"
                    dangerouslySetInnerHTML={{ __html: question.body }}
                  />
                  <div className="flex justify-between mt-6 space-x-8">
                    <div className="flex space-x-6">
                      <span className="inline-flex items-center text-sm">
                        <button
                          type="button"
                          className="inline-flex space-x-2 text-gray-400 hover:text-gray-500"
                        >
                          <FiThumbsUp className="w-5 h-5" aria-hidden="true" />
                          <span className="font-medium text-gray-900">
                            {question.likes}
                          </span>
                          <span className="sr-only">likes</span>
                        </button>
                      </span>
                      <span className="inline-flex items-center text-sm">
                        <button
                          type="button"
                          className="inline-flex space-x-2 text-gray-400 hover:text-gray-500"
                        >
                          <FiMessageCircle
                            className="w-5 h-5"
                            aria-hidden="true"
                          />
                          <span className="font-medium text-gray-900">
                            {question.replies}
                          </span>
                          <span className="sr-only">replies</span>
                        </button>
                      </span>
                      <span className="inline-flex items-center text-sm">
                        <button
                          type="button"
                          className="inline-flex space-x-2 text-gray-400 hover:text-gray-500"
                        >
                          <FiEye className="w-5 h-5" aria-hidden="true" />
                          <span className="font-medium text-gray-900">
                            {question.views}
                          </span>
                          <span className="sr-only">views</span>
                        </button>
                      </span>
                    </div>
                    <div className="flex text-sm">
                      <span className="inline-flex items-center text-sm">
                        <button
                          type="button"
                          className="inline-flex space-x-2 text-gray-400 hover:text-gray-500"
                        >
                          <FiShare className="w-5 h-5" aria-hidden="true" />
                          <span className="font-medium text-gray-900">
                            Share
                          </span>
                        </button>
                      </span>
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </ContentContainer>
        <AsideContainer>
          <Header className="flex justify-end">
            <Button shape="rounded" variant="ghost" size="sq" className="mr-4">
              <span className="sr-only">Search</span>
              <FiSearch className="w-6 h-6" aria-hidden="true" />
            </Button>
            <Button shape="rounded" variant="ghost" size="sq" className="mr-4">
              <span className="sr-only">View notifications</span>
              <FiBell className="w-6 h-6" aria-hidden="true" />
            </Button>
            <Menu as="div" className="relative flex-shrink-0">
              <Menu.Button className="flex rounded-full focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-800">
                <span className="sr-only">Open user menu</span>
                <img
                  className="w-8 h-8 rounded-full"
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
                <Menu.Items className="absolute right-0 z-10 w-48 py-1 mt-2 origin-top-right bg-white rounded-md shadow-lg ring-black ring-opacity-5 focus:outline-none">
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
          <div className="my-5">
            <section aria-labelledby="who-to-follow-heading">
              <div className="p-6 border-b border-b-gray-400">
                <h2
                  id="who-to-follow-heading"
                  className="text-base font-medium text-gray-900"
                >
                  Who to follow
                </h2>
                <div className="flow-root mt-6">
                  <ul role="list" className="divide-y divide-gray-200">
                    {whoToFollow.map((user) => (
                      <li
                        key={user.handle}
                        className="flex items-center py-4 space-x-3"
                      >
                        <div className="flex-shrink-0">
                          <img
                            className="w-8 h-8 rounded-full"
                            src={user.imageUrl}
                            alt=""
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            <a href={user.href}>{user.name}</a>
                          </p>
                          <p className="text-sm text-gray-500">
                            <a href={user.href}>{"@" + user.handle}</a>
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          <button
                            type="button"
                            className="inline-flex items-center px-3 py-0.5 rounded-full bg-rose-50 text-sm font-medium text-rose-700 hover:bg-rose-100"
                          >
                            <FiPlusCircle
                              className="-ml-1 mr-0.5 h-5 w-5 text-rose-400"
                              aria-hidden="true"
                            />
                            <span>Follow</span>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-6">
                  <a
                    href="#"
                    className="block w-full px-4 py-2 text-sm font-medium text-center text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                  >
                    View all
                  </a>
                </div>
              </div>
            </section>
            <section aria-labelledby="trending-heading">
              <div className="p-6 border-b border-b-gray-400">
                <h2
                  id="trending-heading"
                  className="text-base font-medium text-gray-900"
                >
                  Trending
                </h2>
                <div className="flow-root mt-6">
                  <ul role="list" className="-my-4 divide-y divide-gray-200">
                    {trendingPosts.map((post) => (
                      <li key={post.id} className="flex py-4 space-x-3">
                        <div className="flex-shrink-0">
                          <img
                            className="w-8 h-8 rounded-full"
                            src={post.user.imageUrl}
                            alt={post.user.name}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800">{post.body}</p>
                          <div className="flex mt-2">
                            <span className="inline-flex items-center text-sm">
                              <button
                                type="button"
                                className="inline-flex space-x-2 text-gray-400 hover:text-gray-500"
                              >
                                <FiMessageCircle
                                  className="w-5 h-5"
                                  aria-hidden="true"
                                />
                                <span className="font-medium text-gray-900">
                                  {post.comments}
                                </span>
                              </button>
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-6">
                  <a
                    href="#"
                    className="block w-full px-4 py-2 text-sm font-medium text-center text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
                  >
                    View all
                  </a>
                </div>
              </div>
            </section>
          </div>
        </AsideContainer>
      </Container>
    </>
  );
};

export default HomePage;
