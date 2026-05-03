import { OmniqClient } from "omniq";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pageWorker(ctx) {
  const page = Number(ctx?.payload?.page ?? 0);
  const completion_key = String(ctx?.payload?.completion_key ?? "").trim();

  if (!Number.isFinite(page) || page <= 0) throw new Error("payload.page must be > 0");
  if (!completion_key) throw new Error("payload.completion_key is required");

  console.log(`[page_worker] Processing page ${page} (job_id=${ctx.job_id})`);
  await sleep(1500);

  const remaining = await ctx.exec.child_ack(completion_key);

  console.log(`[page_worker] Page ${page} done. Remaining=${remaining}`);

  if (remaining === 0) {
    console.log("[page_worker] Last page finished.");
  }
}

async function main() {
  const host = String(process.env.REDIS_HOST || "omniq-redis").trim();
  const port = Number(process.env.REDIS_PORT || 6379);

  const omniq = await OmniqClient.create({ host, port });

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
