import {
  firebase,
  firestore,
  useQuery,
  prepareDocForCreate,
  prepareDocForUpdate,
} from "util/db";
import { useUserBlocks } from "actions/user";

export const useLessons = () => {
  const currentUser = firebase.auth().currentUser;
  const uid = currentUser && currentUser.uid;

  const lessonsQuery = useQuery(
    firestore.collection("lessons").orderBy("createdAt", "desc")
  );

  const { status: userBlockStatus, dataMap } = useUserBlocks(uid || "");

  const isLoading = currentUser
    ? lessonsQuery.status === "loading" || userBlockStatus === "loading"
    : lessonsQuery.status === "loading";

  const lessonsData = lessonsQuery.data
    ? lessonsQuery.data.filter((p: any) => !p._flagged && !dataMap[p.createdBy])
    : [];

  return {
    status: isLoading ? "loading" : "success",
    data: lessonsData,
    error: lessonsQuery.error,
  };
};

export const useLesson = (lessonId = "") => {
  return useQuery(lessonId && firestore.collection("lessons").doc(lessonId));
};

export const createLesson = (lesson: any) => {
  lesson._likeCount = 0;
  lesson._flagged = false;
  return firestore
    .collection("lessons")
    .add(prepareDocForCreate(lesson))
    .catch((error) => {
      alert(`Whoops, couldn't create the lesson: ${error.message}`);
    });
};

export const updateLesson = (lessonId = "", lesson: any) => {
  return firestore
    .collection("lessons")
    .doc(lessonId)
    .update(prepareDocForUpdate(lesson))
    .catch((error) => {
      alert(`Whoops, couldn't edit the lesson: ${error.message}`);
    });
};

export const deleteLesson = (lessonId = "") => {
  return firestore
    .collection("lessons")
    .doc(lessonId)
    .delete()
    .catch((error) => {
      alert(`Whoops, couldn't delete the lesson: ${error.message}`);
    });
};

// Flagging a Lesson
export const flagLesson = (lessonId = "") => {
  const flag = prepareDocForCreate({ lessonId });
  return firestore.collection("lessonFlags").add(flag);
};

export const unflagLesson = (flagId = "") => {
  return firestore.collection("lessonFlags").doc(flagId).delete();
};

// Liking a Lesson
export const useLessonLikes = (uid = "") => {
  const lessonLikesQuery = useQuery(
    uid && firestore.collection("lessonLikes").where("createdBy", "==", uid)
  );

  const dataMap = lessonLikesQuery.data
    ? lessonLikesQuery.data.reduce(
        (map: Record<string, string>, l: { id: string; lessonId: string }) => {
          map[l.lessonId] = l.id;
          return map;
        },
        {}
      )
    : {};

  return { status: lessonLikesQuery.status, dataMap };
};

export const likeLesson = (lessonId = "") => {
  const like = prepareDocForCreate({ lessonId });
  return firestore.collection("lessonLikes").add(like);
};

export const unlikeLesson = (likeId = "") => {
  return firestore.collection("lessonLikes").doc(likeId).delete();
};
