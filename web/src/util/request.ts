import { firebase } from "util/firebase";

export const apiRequest = async (path = "", method = "GET", data: any) => {
  const accessToken = firebase.auth().currentUser
    ? await firebase.auth().currentUser?.getIdToken()
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
          firebase.auth().signOut();
        }

        throw new Error(response.message);
      } else {
        return response.data;
      }
    });
};
