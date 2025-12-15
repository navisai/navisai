export function createLogger(component) {
  return {
    info: (msg, meta) => console.log("[INFO]", component, msg, meta ?? ""),
    warn: (msg, meta) => console.warn("[WARN]", component, msg, meta ?? ""),
    error: (msg, meta) => console.error("[ERROR]", component, msg, meta ?? ""),
    debug: (msg, meta) => console.debug("[DEBUG]", component, msg, meta ?? "")
  };
}
