// The AI worker process. Run it next to the web app:
//   npm run ai:worker
// It claims queued AI jobs and works them as the AI agent user.
import "dotenv/config";
import { startWorker } from "../lib/ai/worker";

async function main() {
  const stop = await startWorker();
  const shutdown = async () => {
    console.log("[ai-worker] shutting down...");
    await stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
