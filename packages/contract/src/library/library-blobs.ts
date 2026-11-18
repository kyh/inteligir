// The library's bytes, the route beside `/v1/rpc` that carries bytes rather than calls: its files,
// `/v1/blobs/<sha>`, which a device GETs, a range of it if it asks, carrying its session by its
// own door as `/v1/rpc` does. A file goes up outside it, to the store `library.files.reserve`
// names, before a write names its sha.

export const V1_BLOBS_PATH = "/v1/blobs";

// the name a reader asks a file be served under (`?name=`), which a browser's viewer titles it by
// and a download saves it as: kept only when an item of the library holds the file by that name,
// so no link serves a file under a name its library never gave it
export const V1_BLOBS_NAME_PARAM = "name";

// the largest file the library takes: one PUT, which the store takes whole up to 100 MB before it
// asks for a multipart upload
export const BLOB_MAX_BYTES = 100 * 1024 * 1024;
