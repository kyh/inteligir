// The doors as a program with no workerd types reads them: only the platform's Request and
// Response, which the site's DOM program and the Worker's each resolve as their own, so apps/web's
// routes type `context.doors` without loading a module of this package's runtime. One door a path
// (`./door-routes`), built per request by `./doors`.

export type Door = (request: Request) => Promise<Response>;

export interface Doors {
  readonly auth: Door;
  readonly signUp: Door;
  readonly rpc: Door;
  readonly blobs: Door;
  readonly socket: Door;
  readonly connector: Door;
  readonly connectorMetadata: Door;
  readonly authorizationServerMetadata: Door;
  readonly oauthToken: Door;
  readonly oauthRegister: Door;
  readonly consent: Door;
}

export type DoorName = keyof Doors;
