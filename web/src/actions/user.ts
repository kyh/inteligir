import { firestore, useQuery, prepareDocForCreate } from "util/db";

export const useUserBlocks = (uid = "") => {
  const blockedUsersQuery = useQuery(
    uid && firestore.collection("userBlocks").where("createdBy", "==", uid)
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

export const blockUser = (userId: string) => {
  const block = prepareDocForCreate({ blockedUser: userId });
  return firestore.collection("userBlocks").add(block);
};

export const unblockUser = (blockId: string) => {
  return firestore.collection("userBlocks").doc(blockId).delete();
};
