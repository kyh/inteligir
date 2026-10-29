// The library's bytes, the routes beside `/v1/rpc` that carry bytes rather than calls: its files,
// `/v1/blobs/<sha>`, and its exports, `/v1/exports/<id>`. A device PUTs a file under its SHA-256
// before it names the sha in a write, and GETs one it does not hold, a range of it if it asks; it
// GETs an export the library wrote for it as a zip; each carries the device's credential or the
// browser's session, as `/v1/rpc` does.

export const V1_BLOBS_PATH = "/v1/blobs";

// the largest file the library takes: the most a request body may carry through Cloudflare's edge
export const BLOB_MAX_BYTES = 100 * 1024 * 1024;

// an export's zip, by the id `library.exports.start` answered
export const V1_EXPORTS_PATH = "/v1/exports";
