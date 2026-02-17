// examples/childs/consumer2.js
// Pages consumer: processes a page job and child-acks completion counter.

import { OmniqClient } from "../../dist/index.js";

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
  const redis_url = String(process.env.REDIS_URL || "redis://omniq-redis:6379/0").trim();

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
