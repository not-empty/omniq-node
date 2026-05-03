import { OmniqClient } from "omniq";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function handler(ctx) {
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
  const host = "omniq-redis";
  const port = 6379;
  const omniq = await OmniqClient.create({ host, port });

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
