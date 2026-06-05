// Stub for optional native modules that @discordjs/ws / ws probe for at load
// time (zlib-sync compression, bufferutil, utf-8-validate). They're only used
// by the Discord *Gateway* path, which cannot run on Cloudflare Workers, so we
// alias them to this empty module to keep the Workers bundle resolvable.
export default {};
