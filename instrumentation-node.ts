// On a demo install, starts the AI worker inside the web server, so "npm run dev" is all anyone has to run:
// uploads on the Live Run screen are picked up within a second.
//
// Real installs run the worker as its own process (npm run ai:worker) and leave this switched off.
export async function startDemoWorker() {
  const demo = process.env.LOCAL_DEMO_AUTH === "true";
  const flag = process.env.AI_WORKER_AUTOSTART;
  const on = flag ? flag === "true" : demo;
  if (!on) return;
  const g = globalThis as unknown as { __primusWorker?: boolean };
  if (g.__primusWorker) return; // hot reload must not start a second worker
  g.__primusWorker = true;
  if (demo && process.env.AI_DEMO_PACE_MS === undefined) process.env.AI_DEMO_PACE_MS = "250";
  const { startWorker } = await import("./lib/ai/worker");
  await startWorker({ workerId: `inline-${process.pid}`, planIntervalMs: Number.POSITIVE_INFINITY });
  console.log("[ai-worker] started inside the web server (demo install)");
}
