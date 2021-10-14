import { ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider as QueryClientProviderBase,
} from "react-query";
import fetch from "cross-fetch";

// For interacting with the React Query cache
export const queryClient = new QueryClient();

type Props = {
  children: ReactNode;
};

// React Query context provider that wraps our app
export const QueryClientProvider = (props: Props) => {
  return (
    <QueryClientProviderBase client={queryClient}>
      {props.children}
    </QueryClientProviderBase>
  );
};

const rootPath = process.env.NEXT_PUBLIC_API_URL;

const defaultOptions = {
  headers: {
    "Content-Type": "application/json",
  },
  mode: "cors" as RequestMode,
  credentials: "include" as RequestCredentials,
  includeCredentials: true,
};

const handleResponse = (response: Response) => {
  return response.json().then((json) => {
    // if (json.status === "error") {
    //   // Automatically signout user if accessToken is no longer valid
    //   if (json.code === "auth/invalid-user-token") {
    //     console.log("Invalid user token, signing out");
    //   }

    //   throw new Error(json.message);
    // } else {
    //   return json.data;
    // }
    return json;
  });
};

const getPath = (subpath: string) => {
  return subpath.startsWith("http") ? subpath : `${rootPath}/${subpath}`;
};

export const fetcher = {
  get: (subpath = "", data = {}, additionalOptions = {}) => {
    const params = new URLSearchParams(data).toString();
    const path = getPath(`${subpath}${params ? `?${params}` : ""}`);
    const options = { ...defaultOptions, method: "GET", ...additionalOptions };

    return fetch(path, options).then(handleResponse);
  },
  post: (subpath = "", data = {}, additionalOptions = {}) => {
    const path = getPath(subpath);
    const body = JSON.stringify(data);
    const options = {
      ...defaultOptions,
      method: "POST",
      body,
      ...additionalOptions,
    };

    return fetch(path, options).then(handleResponse);
  },
  put: (subpath = "", data = {}, additionalOptions = {}) => {
    const path = getPath(subpath);
    const body = JSON.stringify(data);
    const options = {
      ...defaultOptions,
      method: "PUT",
      body,
      ...additionalOptions,
    };

    return fetch(path, options).then(handleResponse);
  },
  delete: (subpath = "", data = {}, additionalOptions = {}) => {
    const path = getPath(subpath);
    const body = JSON.stringify(data);
    const options = {
      ...defaultOptions,
      method: "DELETE",
      body,
      ...additionalOptions,
    };

    return fetch(path, options).then(handleResponse);
  },
};
