import { firestore, useQuery, prepareDocForCreate } from "util/db";
import {
  collection,
  query,
  where,
  doc,
  addDoc,
  deleteDoc,
} from "firebase/firestore";

export const useUserBlocks = (uid = "") => {
  const blockedUsersQuery = useQuery(
    uid &&
      query(collection(firestore, "userBlocks"), where("createdBy", "==", uid))
  );

  const dataMap = blockedUsersQuery.data
    ? blockedUsersQuery.data.reduce(
        (
          map: Record<string, string>,
          b: { id: string; blockedUser: string }
        ) => {
          map[b.blockedUser] = b.id;
          return map;
        },
        {}
      )
    : {};

  return { status: blockedUsersQuery.status, dataMap };
};

export const blockUser = (userId = "") => {
  return addDoc(
    collection(firestore, "userBlocks"),
    prepareDocForCreate({ blockedUser: userId })
  );
};

export const unblockUser = (blockId = "") => {
  return deleteDoc(doc(collection(firestore, "userBlocks"), blockId));
};
