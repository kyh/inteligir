import fetch from "cross-fetch";

const getDefaultOptions = () => {
  return {
    headers: {
      "Content-Type": "application/json",
    } as Record<string, string>,
    mode: "cors" as RequestMode,
    credentials: "include" as RequestCredentials,
    includeCredentials: true,
  };
};

const handleResponse = (response: Response) => {
  return response.json().then((json) => {
    if (response.status >= 400) {
      console.error(json);
      // TODO: automatically signout user if session is no longer valid
      throw new Error(json);
    } else {
      return json;
    }
  });
};

export const rootPath = process.env.NEXT_PUBLIC_API_URL || "";

const getPath = (subpath: string) => {
  return subpath.startsWith("http") ? subpath : `${rootPath}/${subpath}`;
};

export const fetcher = {
  get: (subpath = "", data = {}, additionalOptions = {}) => {
    const params = new URLSearchParams(data).toString();
    const path = getPath(`${subpath}${params ? `?${params}` : ""}`);
    const options = {
      ...getDefaultOptions(),
      method: "GET",
      ...additionalOptions,
    };

    return fetch(path, options).then(handleResponse);
  },
  post: (subpath = "", data = {}, additionalOptions = {}) => {
    const path = getPath(subpath);
    const body = JSON.stringify(data);
    const options = {
      ...getDefaultOptions(),
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
      ...getDefaultOptions(),
      method: "PUT",
      body,
      ...additionalOptions,
    };

    return fetch(path, options).then(handleResponse);
  },
  patch: (subpath = "", data = {}, additionalOptions = {}) => {
    const path = getPath(subpath);
    const body = JSON.stringify(data);
    const options = {
      ...getDefaultOptions(),
      method: "PATCH",
      body,
      ...additionalOptions,
    };

    return fetch(path, options).then(handleResponse);
  },
  delete: (subpath = "", data = {}, additionalOptions = {}) => {
    const path = getPath(subpath);
    const body = JSON.stringify(data);
    const options = {
      ...getDefaultOptions(),
      method: "DELETE",
      body,
      ...additionalOptions,
    };

    return fetch(path, options).then(handleResponse);
  },
};
