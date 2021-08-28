import { FiThumbsUp, FiMessageCircle, FiEye, FiShare } from "react-icons/fi";
import {
  SEO,
  Sidebar,
  SidebarFixed,
  TopbarHeader,
  Container,
  Topbar,
  Card,
  List,
  Heading,
  Button,
} from "components";
import { cx } from "util/styles";
import { lessons } from "data/lessons";
import { comments } from "data/comments";

export const HomePage = () => {
  return (
    <>
      <SEO />
      <Container>
        <Sidebar />
        <main className="md:mx-20">
          <TopbarHeader className="sticky top-0">
            <Heading className="mb-0">Home</Heading>
          </TopbarHeader>
          <ul role="list" className="my-5">
            {lessons.map((lesson) => (
              <Card as="li" key={lesson.id}>
                <article aria-labelledby={"question-title-" + lesson.id}>
                  <div>
                    <div className="flex space-x-3">
                      <div className="flex-shrink-0">
                        <img
                          className="w-10 h-10 rounded-full"
                          src={lesson.author.imageUrl}
                          alt=""
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          <a
                            href={lesson.author.href}
                            className="hover:underline"
                          >
                            {lesson.author.name}
                          </a>
                        </p>
                        <p className="text-sm text-gray-500">
                          {lesson.hashtags.map((hashtag) => (
                            <a
                              key={hashtag}
                              href={lesson.href}
                              className="mr-1 hover:underline"
                            >
                              #{hashtag}
                            </a>
                          ))}
                        </p>
                      </div>
                      <div className="flex self-center flex-shrink-0">
                        <Button
                          variant="outline"
                          size="xs"
                          className={cx(lesson.following && "opacity-50")}
                        >
                          {lesson.following ? "Following" : "Follow"}
                        </Button>
                      </div>
                    </div>
                    <h2
                      id={"question-title-" + lesson.id}
                      className="mt-4 text-base font-medium text-gray-900"
                    >
                      {lesson.title}
                    </h2>
                  </div>
                  <div
                    className="mt-2 space-y-4 text-sm text-gray-700"
                    dangerouslySetInnerHTML={{ __html: lesson.body }}
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
                            {lesson.likes}
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
                            {lesson.replies}
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
                            {lesson.views}
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
              </Card>
            ))}
          </ul>
        </main>
        <aside className="hidden flex-grow-0 flex-shrink-0 w-[300px] xl:block">
          <SidebarFixed className="w-[300px]">
            <TopbarHeader className="flex justify-end">
              <Topbar />
            </TopbarHeader>
            <section aria-labelledby="comments-section" className="my-5">
              <Card>
                <Heading id="comments-section" as="h2" className="text-lg">
                  Comments
                </Heading>
                <List role="list">
                  {comments.map((comment) => (
                    <li key={comment.id} className="flex py-4 space-x-3">
                      <div className="flex-shrink-0">
                        <img
                          className="w-8 h-8 rounded-full"
                          src={comment.user.imageUrl}
                          alt={comment.user.name}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800">{comment.body}</p>
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
                                Reply
                              </span>
                            </button>
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </List>
              </Card>
            </section>
          </SidebarFixed>
        </aside>
      </Container>
    </>
  );
};

export default HomePage;
