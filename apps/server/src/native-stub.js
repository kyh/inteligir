// Stub for optional native modules that @discordjs/ws / ws probe for at load
// time (zlib-sync, bufferutil, utf-8-validate). They're only used by Discord's
// Gateway path, which can't run on Cloudflare Workers, so we alias them to this
// empty module to keep the worker bundle resolvable.
export default {};
