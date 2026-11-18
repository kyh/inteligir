// `library.agent.events` streams a thread, so it is served at its own path, the more specific one
// RPCLink's URL for it meets first, with a longer `maxDuration` than the rest of `/v1/rpc`: the
// stream ends before it, and the device reconnects where it left off.
export { handleV1Stream as POST } from "@repo/service/rpc/v1-rpc";

export const maxDuration = 300;
