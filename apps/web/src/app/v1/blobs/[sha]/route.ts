// PUT is answered too, so a build from before the store, which sent its files here, is told to
// update rather than met with Next's own 405
export {
  fileReadRoute as GET,
  fileReadRoute as HEAD,
  fileReadRoute as PUT,
} from "@repo/service/files/file-read-route";

// a range streams from the store for as long as the device reads it
export const maxDuration = 300;
