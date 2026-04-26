import { OmniqClient } from "omniq";
import type { JobCtx } from "omniq";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function handler(ctx: JobCtx) {
  const isLastAttempt = ctx.attempt >= ctx.max_attempts;

  console.log(
    `[max_attempts] job_id=${ctx.job_id} ` +
      `attempt=${ctx.attempt}/${ctx.max_attempts} ` +
      `last_attempt=${isLastAttempt}`
  );

  if (!isLastAttempt) {
    console.log("[max_attempts] Failing on purpose to force a retry.");
    throw new Error("Intentional failure before the last attempt");
  }

  console.log("[max_attempts] Last attempt reached. Finishing successfully.");
  await sleep(1000);
}

async function main() {
  const redis_url = "redis://omniq-redis:6379/0";
  const omniq = await OmniqClient.create({ redis_url });

  await omniq.consume({
    queue: "max-attempts",
    handler,
    verbose: true,
    drain: false,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
