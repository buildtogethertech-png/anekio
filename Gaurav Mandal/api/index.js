// Vercel Node functions load /api as CommonJS. The Express app is bundled to CJS in vercel-build.
const bundled = require("./handler.cjs");
module.exports = bundled.default || bundled;
