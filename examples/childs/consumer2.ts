import { OmniqClient } from "omniq";
import type { JobCtx } from "omniq";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function pageWorker(ctx: JobCtx) {
  const page = Number((ctx.payload as any)?.page ?? 0);
  const completion_key = String((ctx.payload as any)?.completion_key ?? "").trim();

  if (!Number.isFinite(page) || page <= 0) throw new Error("payload.page must be > 0");
  if (!completion_key) throw new Error("payload.completion_key is required");

  console.log(`[page_worker] Processing page ${page} (job_id=${ctx.job_id})`);
  await sleep(1500);

  // child_ack: returns remaining count (0 when last finishes; -1 on error)
  const remaining = await ctx.exec.child_ack(completion_key);

  console.log(`[page_worker] Page ${page} done. Remaining=${remaining}`);

  if (remaining === 0) {
    console.log("[page_worker] Last page finished.");
  }
}

async function main() {
  const redis_url = (process.env.REDIS_URL || "redis://omniq-redis:6379/0").trim();

  const omniq = await OmniqClient.create({ redis_url });

  await omniq.consume({
    queue: "pages",
    handler: pageWorker,
    verbose: true,
    drain: false,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
