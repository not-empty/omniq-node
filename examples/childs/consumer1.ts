import { OmniqClient } from "omniq";
import type { JobCtx } from "omniq";

async function documentWorker(ctx: JobCtx) {
  const document_id = (ctx.payload as any)?.document_id;
  const pages = Number((ctx.payload as any)?.pages ?? 0);

  if (!document_id) throw new Error("payload.document_id is required");
  if (!Number.isFinite(pages) || pages <= 0) throw new Error("payload.pages must be > 0");

  const completion_key = `document:${document_id}`;

  console.log(`[document_worker] Initializing completion for ${pages} pages`);

  // init childs counter
  await ctx.exec.childs_init(completion_key, pages);

  // publish page jobs
  for (let page = 1; page <= pages; page++) {
    await ctx.exec.publish({
      queue: "pages",
      payload: {
        document_id,
        page,
        completion_key,
      },
    });
  }

  console.log("[document_worker] All page jobs published.");
}

async function main() {
  const redis_url = (process.env.REDIS_URL || "redis://omniq-redis:6379/0").trim();

  const omniq = await OmniqClient.create({ redis_url });

  await omniq.consume({
    queue: "documents",
    handler: documentWorker,
    verbose: true,
    drain: false,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
