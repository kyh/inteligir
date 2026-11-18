// What a page that draws an item may load: its own origin's files and bytes its host handed it,
// never a web address. An image or a video a note names would otherwise be fetched the moment a
// device opens it, a request no person made, and the agent writes notes a saved page may steer.
// The library tab and the phone's note page spread these into their content policies.
export const DRAWING_DIRECTIVES = [
  "default-src 'self'",
  // React's style attributes and the editor's runtime <style> are not nonceable
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
] as const;
