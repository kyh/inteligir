import {
  auth,
  firestore,
  useQuery,
  prepareDocForCreate,
  prepareDocForUpdate,
} from "util/db";
import { useUserBlocks } from "actions/user";
import {
  collection,
  query,
  orderBy,
  where,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

export const useLessons = () => {
  const currentUser = auth.currentUser;
  const uid = currentUser && currentUser.uid;

  const lessonsQuery = useQuery(
    query(collection(firestore, "lessons"), orderBy("createdAt", "desc"))
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
  return useQuery(
    lessonId && query(collection(doc(firestore, lessonId), "lessons"))
  );
};

export const createLesson = (lesson: any) => {
  return addDoc(
    collection(firestore, "lessons"),
    prepareDocForCreate({ ...lesson, _likeCount: 0, _flagged: false })
  );
};

export const updateLesson = (lessonId = "", lesson: any) => {
  return updateDoc(
    doc(collection(firestore, "lessons"), lessonId),
    prepareDocForUpdate(lesson)
  );
};

export const deleteLesson = (lessonId = "") => {
  return deleteDoc(doc(collection(firestore, "lessons"), lessonId));
};

// Flagging a Lesson
export const flagLesson = (lessonId = "") => {
  return addDoc(
    collection(firestore, "lessons"),
    prepareDocForCreate({ lessonId })
  );
};

export const unflagLesson = (flagId = "") => {
  return deleteDoc(doc(collection(firestore, "lessonFlags"), flagId));
};

// Liking a Lesson
export const useLessonLikes = (uid = "") => {
  const lessonLikesQuery = useQuery(
    uid &&
      query(collection(firestore, "lessonLikes"), where("createdBy", "==", uid))
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
  return addDoc(
    collection(firestore, "lessonLikes"),
    prepareDocForCreate({ lessonId })
  );
};

export const unlikeLesson = (flagId = "") => {
  return deleteDoc(doc(collection(firestore, "lessonLikes"), flagId));
};
