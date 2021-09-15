import { useReducer, useEffect, useRef } from "react";
import {
  serverTimestamp,
  queryEqual,
  onSnapshot,
  Query,
} from "firebase/firestore";

import { firebase, auth, firestore } from "util/firebase";

export { firebase, auth, firestore };

const extractUserData = () => {
  const user = auth.currentUser;
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
};

export const prepareDocForCreate = (doc: any) => {
  doc.createdBy = extractUserData();
  doc.createdAt = serverTimestamp();

  return doc;
};

export const prepareDocForUpdate = (doc: any) => {
  doc.updatedBy = extractUserData();
  doc.updatedAt = serverTimestamp();

  // don't save the id as part of the document
  delete doc.id;

  // don't save values that start with an underscore (these are calculated by the backend)
  Object.keys(doc).forEach((key) => {
    if (key.indexOf("_") === 0) {
      delete doc[key];
    }
  });

  return doc;
};

// Reducer for useQuery hook state and actions
const reducer = (state: any, action: any) => {
  switch (action.type) {
    case "idle":
      return { status: "idle", data: undefined, error: undefined };
    case "loading":
      return { status: "loading", data: undefined, error: undefined };
    case "success":
      return { status: "success", data: action.payload, error: undefined };
    case "error":
      return { status: "error", data: undefined, error: action.payload };
    case "update":
      return {
        ...state,
        data: state.data
          ? { ...state.data, ...action.payload }
          : action.payload,
      };
    default:
      throw new Error("invalid action");
  }
};

export const useQuery = (query: Query | "") => {
  // Our initial state
  // Start with an "idle" status if query is falsy, as that means hook consumer is
  // waiting on required data before creating the query object.
  // Example: useQuery(uid && firestore.collection("profiles").doc(uid))
  const initialState = {
    status: query ? "loading" : "idle",
    data: undefined,
    error: undefined,
  };

  // Setup our state and actions
  const [state, dispatch] = useReducer(reducer, initialState);

  // Gives us previous query object if query is the same, ensuring
  // we don't trigger useEffect on every render due to query technically
  // being a new object reference on every render.
  const queryCached = useMemoCompare(query, (prevQuery) => {
    // Use built-in Firestore isEqual method to determine if "equal"
    return prevQuery && query && queryEqual(query, prevQuery);
  });

  useEffect(() => {
    // Return early if query is falsy and reset to "idle" status in case
    // we're coming from "success" or "error" status due to query change.
    if (!queryCached) {
      dispatch({ type: "idle" });
      return;
    }

    dispatch({ type: "loading" });

    // Subscribe to query with onSnapshot
    // Will unsubscribe on cleanup since this returns an unsubscribe function
    return onSnapshot(
      queryCached,
      (response) => {
        // Get data for collection or doc
        const data = response.docs.map((d) => {
          d.exists() === true ? { id: d.id, ...d.data() } : null;
        });

        dispatch({ type: "success", payload: data });
      },
      (error: any) => {
        dispatch({ type: "error", payload: error });
      }
    );
  }, [queryCached]); // Only run effect if queryCached changes

  return { ...state, dispatch };
};

const useMemoCompare = <T>(
  next: T,
  compare: (prev: T, next: T) => T | boolean
) => {
  // Ref for storing previous value
  const previousRef = useRef(next);
  const previous = previousRef.current;

  // Pass previous and next value to compare function
  // to determine whether to consider them equal.
  const isEqual = compare(previous, next);

  // If not equal update previousRef to next value.
  // We only update if not equal so that this hook continues to return
  // the same old value if compare keeps returning true.
  useEffect(() => {
    if (!isEqual) {
      previousRef.current = next;
    }
  });

  // Finally, if equal then return the previous value
  return isEqual ? previous : next;
};
