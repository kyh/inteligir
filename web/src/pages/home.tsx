import { SEO, MainLayout, List, Heading } from "components";
import { lessons } from "data/lessons";
import { comments } from "data/comments";
import { LessonCard } from "components/Lesson/LessonCard";
import { LessonComment } from "components/Lesson/LessonComment";

const Aside = () => {
  return (
    <section aria-labelledby="comments-section" className="my-6 overflow-auto">
      <Heading
        id="comments-section"
        className="sticky top-0 pb-2 mb-0 text-lg bg-gradient-to-b from-white"
      >
        Comments
      </Heading>
      <List role="list">
        {comments.map((comment) => (
          <LessonComment key={comment.id} comment={comment} />
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
            <LessonCard key={lesson.id} lesson={lesson} />
          ))}
        </ul>
      </MainLayout>
    </>
  );
};

export default HomePage;
