// The web app marks server code with `import "server-only"`, which throws if
// loaded in a browser bundle. The worker is a plain Node process, so it is
// safe to load; this preload makes that import a no-op for scripts only.
const Module = require("module");
const path = require("path");
const empty = path.join(__dirname, "..", "node_modules", "server-only", "empty.js");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return empty;
  return original.call(this, request, ...rest);
};
