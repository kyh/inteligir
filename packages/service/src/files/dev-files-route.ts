import { devUploadOf } from "./dev-upload-signature";
import { DISK_FILE_STORE } from "./file-store-of";
import { plainText } from "./plain-text";

export const devFilesRoute = async (request: Request) => {
  if (DISK_FILE_STORE === null) {
    return plainText(404, "Not found.");
  }

  const ask = devUploadOf(new URL(request.url));

  if (ask === null) {
    return plainText(403, "This upload's address was never signed, or is past its time.");
  }

  if (request.headers.get("content-type") !== ask.mime || request.body === null) {
    return plainText(403, "This upload is not the type its address names.");
  }

  const received = await DISK_FILE_STORE.receive(ask.pathname, request.body, {
    maxBytes: ask.bytes,
    mime: ask.mime,
  });

  switch (received) {
    case "stored": {
      return new Response(null, { status: 200 });
    }

    case "exists": {
      return plainText(409, "This upload was sent already.");
    }

    case "too-large": {
      return plainText(413, "This upload is larger than its address names.");
    }

    default: {
      throw new Error(`unexpected ${String(received satisfies never)}`);
    }
  }
};
