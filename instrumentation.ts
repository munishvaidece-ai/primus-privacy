// Runs once when the web server starts. See instrumentation-node.ts for what it does on a demo install.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await (await import("./instrumentation-node")).startDemoWorker();
  }
}
