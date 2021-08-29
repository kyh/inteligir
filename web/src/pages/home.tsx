import { FiThumbsUp, FiMessageCircle, FiEye, FiShare } from "react-icons/fi";
import { SEO, MainLayout, Card, List, Heading, Button } from "components";
import { cx } from "util/styles";
import { lessons } from "data/lessons";
import { comments } from "data/comments";
import Stories, { WithSeeMore } from "components/LessonStory";

const Story2 = () => {
  return (
    <div style={{ ...contentStyle, background: "Aquamarine", color: "#333" }}>
      <h1>You get the control of the story.</h1>
      <p>
        Render your custom JSX by passing just a{" "}
        <code style={{ fontStyle: "italic" }}>content</code> property inside
        your story object.
      </p>
      <p>
        You get a <code style={{ fontStyle: "italic" }}>action</code> prop as an
        input to your content function, that can be used to play or pause the
        story.
      </p>
      <h4>v2 is out 🎉</h4>
      <p>React Native version coming soon.</p>
    </div>
  );
};

const stories2 = [
  {
    content: () => {
      return (
        <div style={contentStyle}>
          <h1>The new version is here.</h1>
          <p>This is the new story.</p>
          <p>Now render React components right into your stories.</p>
          <p>Possibilities are endless, like here - here's a code block!</p>
          <pre>
            <code style={code}>console.log('Hello, world!')</code>
          </pre>
          <p>Or here, an image!</p>
          <br />
          <img
            style={image}
            src="https://images.unsplash.com/photo-1565506737357-af89222625ad?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=1650&q=80"
          ></img>
          <h3>Perfect. But there's more! →</h3>
        </div>
      );
    },
  },
  {
    content: ({ action, story }) => {
      return (
        <WithSeeMore story={story} action={action}>
          <div style={{ background: "snow", padding: 20, height: "100%" }}>
            <h1 style={{ marginTop: "100%", marginBottom: 0 }}>🌝</h1>
            <h1 style={{ marginTop: 5 }}>
              We have our good old image and video stories, just the same.
            </h1>
          </div>
        </WithSeeMore>
      );
    },
    seeMoreCollapsed: ({ toggleMore }) => (
      <p style={customSeeMore} onClick={() => toggleMore(true)}>
        A custom See More message →
      </p>
    ),
    seeMore: ({ close }) => (
      <div
        style={{
          maxWidth: "100%",
          height: "100%",
          padding: 40,
          background: "white",
        }}
      >
        <h2>Just checking the see more feature.</h2>
        <p style={{ textDecoration: "underline" }} onClick={close}>
          Go on, close this popup.
        </p>
      </div>
    ),
  },
  {
    url: "https://picsum.photos/1080/1920",
  },
  {
    content: Story2,
  },
];

const image = {
  display: "block",
  maxWidth: "100%",
  borderRadius: 4,
};

const code = {
  background: "#eee",
  padding: "5px 10px",
  borderRadius: "4px",
  color: "#333",
};

const contentStyle = {
  background: "#333",
  width: "100%",
  padding: 20,
  color: "white",
  height: "100%",
};

const customSeeMore = {
  textAlign: "center",
  fontSize: 14,
  bottom: 20,
  position: "relative",
};

const Aside = () => {
  return (
    <section aria-labelledby="comments-section" className="my-6 overflow-auto">
      <Heading
        id="comments-section"
        as="h2"
        className="sticky top-0 pb-2 mb-0 text-lg bg-gradient-to-b from-white"
      >
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
                    <FiMessageCircle className="w-5 h-5" aria-hidden="true" />
                    <span className="font-medium text-gray-900">Reply</span>
                  </button>
                </span>
              </div>
            </div>
          </li>
        ))}
      </List>
    </section>
  );
};

export const HomePage = () => {
  return (
    <>
      <SEO />
      <MainLayout title={<Heading>Home</Heading>} aside={<Aside />}>
        <ul role="list">
          {lessons.map((lesson) => (
            <Card as="li" key={lesson.id}>
              <header className="flex space-x-3">
                <div className="flex-shrink-0">
                  <img
                    className="w-10 h-10 rounded-full"
                    src={lesson.author.imageUrl}
                    alt=""
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    <a href={lesson.author.href} className="hover:underline">
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
              </header>
              <div className="my-3">
                <Stories stories={stories2} />
              </div>
              <div className="flex justify-between space-x-8">
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
                      <FiMessageCircle className="w-5 h-5" aria-hidden="true" />
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
                      <span className="font-medium text-gray-900">Share</span>
                    </button>
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </ul>
      </MainLayout>
    </>
  );
};

export default HomePage;
