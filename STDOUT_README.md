Why this matters
----------------

The MCP (Model Context Protocol) host expects a clean JSON message stream on stdout. Any human-readable
logs written to stdout will corrupt that stream and trigger JSON parse errors such as:

  "Expected ',' or ']' after array element in JSON at position ..."

What we changed
---------------

- Added `src/utils/stdio-protect.js` which redirects `console.log` and `console.info` to `stderr`.
- Updated `dist/server.js` (temporary/compiled output) to redirect `console.log`/`console.info` to `stderr`.

How to make this permanent (recommended)
--------------------------------------

1. Import `src/utils/stdio-protect.js` at the very top of your project's entrypoint source file (e.g., `src/server.js` or `src/index.js`):

```js
// top of entrypoint
require('./utils/stdio-protect');
```

2. Rebuild your project so the change is included in `dist/`.

3. Commit & push the change:

```bash
git add src/utils/stdio-protect.js
git add dist/server.js
git add STDOUT_README.md
git commit -m "Prevent stdout log corruption for MCP hosts: redirect human logs to stderr"
git push origin main
```

Notes
-----

- If you use a logging library, configure it to write human logs to `stderr` not `stdout` for MCP runtime.
- Avoid writing non-JSON to stdout if your process is intended to be controlled by an MCP host.
