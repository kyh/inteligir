// Shim for @vladfrangu/async_event_emitter, imported only by @discordjs/rest
// (`REST extends AsyncEventEmitter`). The real package inlines a copy of
// node-inspect-extracted whose module-scope class hierarchy throws
// "Super expression must either be null or a function" when workerd evaluates
// the bundle (Cloudflare error 10021), failing every deploy. @discordjs/rest
// only uses the EventEmitter surface (extends / emit / on / listenerCount),
// which node:events provides under nodejs_compat.
export { EventEmitter as AsyncEventEmitter } from "node:events";
