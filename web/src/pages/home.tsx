import { useState, useEffect } from "react";
import { SEO, MainLayout, List, Heading } from "components";
import { lessons as lessonData } from "data/lessons";
import { comments as commentData } from "data/comments";
import { LessonCard } from "components/Lesson/LessonCard";
import { LessonComment } from "components/Lesson/LessonComment";
import { Comment } from "actions/comment";
import { Lesson } from "actions/lesson";

const Aside = ({
  loading,
  comments,
}: {
  loading: boolean;
  comments: Comment[];
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
            <LessonComment key={comment.id} comment={comment} />
          ))}
        </List>
      )}
    </section>
  );
};

export const HomePage = () => {
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [comments, setComments] = useState<Comment[]>([]);

  const loadLessons = () => {
    setLessonsLoading(true);
    setTimeout(() => {
      setLessons(lessonData);
      setLessonsLoading(false);
    }, 100);
  };

  const loadComments = (lesson: Lesson) => {
    console.log("load comments for lesson:", lesson);
    setCommentsLoading(true);
    setTimeout(() => {
      setComments(commentData);
      setCommentsLoading(false);
    }, 100);
  };

  useEffect(() => {
    loadLessons();
  }, []);

  return (
    <>
      <SEO />
      <MainLayout
        title={<Heading>Home</Heading>}
        aside={<Aside comments={comments} loading={commentsLoading} />}
      >
        {lessonsLoading ? (
          <div>Loading...</div>
        ) : (
          <ul role="list">
            {lessons.map((lesson) => (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                onShow={loadComments}
              />
            ))}
          </ul>
        )}
      </MainLayout>
    </>
  );
};

export default HomePage;
