import { auth, firestore, useQuery, prepareDocForCreate } from "util/db";
import { useUserBlocks } from "actions/user";
import { UserInfo } from "firebase/auth";
import {
  collection,
  query,
  orderBy,
  where,
  doc,
  addDoc,
  deleteDoc,
} from "firebase/firestore";

export type Comment = {
  id: string;
  content: string;
  _likeCount: number;
  _flagged: boolean;
  createdBy: Partial<UserInfo>;
  createdAt: string;
};

export const useComments = () => {
  const currentUser = auth.currentUser;
  const uid = currentUser && currentUser.uid;

  const commentsQuery = useQuery(
    query(collection(firestore, "comments"), orderBy("createdAt", "desc"))
  );

  const { status: userBlockStatus, dataMap } = useUserBlocks(uid || "");

  const isLoading = currentUser
    ? commentsQuery.status === "loading" || userBlockStatus === "loading"
    : commentsQuery.status === "loading";

  const commentsData = commentsQuery.data
    ? commentsQuery.data.filter(
        (p: any) => !p._flagged && !dataMap[p.createdBy]
      )
    : [];

  return {
    status: isLoading ? "loading" : "success",
    data: commentsData,
    error: commentsQuery.error,
  };
};

export const useComment = (commentId = "") => {
  return useQuery(
    commentId && query(collection(doc(firestore, commentId), "comments"))
  );
};

export const createComment = (comment: Partial<Comment>) => {
  return addDoc(
    collection(firestore, "comments"),
    prepareDocForCreate({
      ...comment,
      _likeCount: 0,
      _flagged: false,
    })
  );
};

export const deleteComment = (commentId = "") => {
  return deleteDoc(doc(collection(firestore, "comments"), commentId));
};

// Flagging a Comment
export const flagComment = (commentId = "") => {
  return addDoc(
    collection(firestore, "commentFlags"),
    prepareDocForCreate({ commentId })
  );
};

export const unflagComment = (flagId = "") => {
  return deleteDoc(doc(collection(firestore, "commentFlags"), flagId));
};

// Liking a Comment
export const useCommentLikes = (uid = "") => {
  const commentLikesQuery = useQuery(
    uid &&
      query(
        collection(firestore, "commentLikes"),
        where("createdBy", "==", uid)
      )
  );

  const dataMap = commentLikesQuery.data
    ? commentLikesQuery.data.reduce(
        (map: Record<string, string>, l: { id: string; commentId: string }) => {
          map[l.commentId] = l.id;
          return map;
        },
        {}
      )
    : {};

  return { status: commentLikesQuery.status, dataMap };
};

export const likeComment = (commentId = "") => {
  return addDoc(
    collection(firestore, "commentLikes"),
    prepareDocForCreate({ commentId })
  );
};

export const unlikeComment = (flagId = "") => {
  return deleteDoc(doc(collection(firestore, "commentLikes"), flagId));
};
