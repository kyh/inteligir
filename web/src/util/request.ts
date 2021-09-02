import { getIdToken, signOut } from "firebase/auth";
import { auth } from "util/firebase";

export const apiRequest = async (path = "", method = "GET", data: any) => {
  const accessToken = auth.currentUser
    ? await getIdToken(auth.currentUser)
    : undefined;

  return fetch(`/api/${path}`, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: data ? JSON.stringify(data) : undefined,
  })
    .then((response) => response.json())
    .then((response) => {
      if (response.status === "error") {
        // Automatically signout user if accessToken is no longer valid
        if (response.code === "auth/invalid-user-token") {
          signOut(auth);
        }

        throw new Error(response.message);
      } else {
        return response.data;
      }
    });
};
