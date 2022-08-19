import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  posts as postsData,
  comments as commentsData,
} from "~/lib/post/data/data";
import { Comment } from "~/lib/post/ui/Comment";
import type { Post } from "~/lib/post/data/postSchema";
import { useInfiniteScroll } from "~/components/InfiniteScroll";
import { MainLayout } from "~/components/Page";
import { Heading } from "~/components/Text";
import { List } from "~/components/List";
import { Carousel } from "~/components/Carousel";

export const loader = async ({ request }: LoaderArgs) => {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("c");

  return json({
    postList: postsData,
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
      <List>
        {posts.map((post) => (
          <li className="py-4" key={post.id}>
            <Carousel>
              {post.content.map((postContent) => (
                <img
                  key={postContent.id}
                  className="rounded"
                  src={postContent.data}
                  alt=""
                />
              ))}
            </Carousel>
          </li>
        ))}
      </List>
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
        <List>
          {comments.map((comment) => (
            <Comment key={comment.id} comment={comment} />
          ))}
        </List>
      )}
    </section>
  );
};

export default Page;
