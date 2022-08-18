import { json, LoaderArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { isAuthenticated } from "~/lib/auth/server/authenticator.server";
import {
  posts as postsData,
  comments as commentsData,
} from "~/lib/post/data/data";
import { Comment } from "~/lib/post/ui/Comment";
import { MainLayout } from "~/components/Page";
import { Heading } from "~/components/Text";
import { List } from "~/components/List";
import { useInfiniteScroll } from "~/components/InfiniteScroll";
import { Post } from "~/lib/post/data/postSchema";

export const loader = async ({ request }: LoaderArgs) => {
  const user = await isAuthenticated(request);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("c");

  return json({
    postList: postsData,
    user,
  });
};

const Page = () => {
  const { postList } = useLoaderData<typeof loader>();
  const {
    fetcher,
    loadMore,
    hasNextPage,
    ref,
    data: posts,
  } = useInfiniteScroll({
    initialData: postList,
    fetcherResultKey: "postList",
  });

  return (
    <MainLayout
      title={<Heading>Home</Heading>}
      aside={<Aside comments={commentsData} loading={false} />}
    >
      <ul role="list">
        {posts.map((post) => (
          <li key={post.id}>{post.id}</li>
        ))}
      </ul>
    </MainLayout>
  );
};

const Aside = ({
  loading,
  comments,
}: {
  loading: boolean;
  comments: Post[];
}) => {
  return (
    <section aria-labelledby="comments-section" className="my-6 overflow-auto">
      <Heading
        id="comments-section"
        className="sticky top-0 pb-2 mb-0 text-lg bg-gradient-to-b from-white"
      >
        Comments
      </Heading>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <List role="list">
          {comments.map((comment) => (
            <Comment key={comment.id} comment={comment} />
          ))}
        </List>
      )}
    </section>
  );
};

export default Page;
