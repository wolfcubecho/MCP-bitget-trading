// Ensure human-readable logs go to stderr so stdout remains clean for MCP JSON messages.
// Import this module as early as possible (top of your entrypoint) to avoid
// emitting non-JSON logs on stdout which can break MCP hosts that read JSON
// messages from stdout (e.g., Claude's MCP host).
try {
    const originalLog = console.log;
    console.log = (...args) => console.error(...args);
    console.info = (...args) => console.error(...args);
    // Optionally preserve debug on stdout if explicitly needed by other tools
}
catch (e) {
    // no-op
}

export {};
