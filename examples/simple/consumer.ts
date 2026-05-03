import { OmniqClient } from "omniq";
import type { JobCtx } from "omniq";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function handler(ctx: JobCtx) {
  console.log("Waiting 2 seconds");
  await sleep(2000);
  console.log("Done");
}

async function main() {
  const host = "omniq-redis";
  const port = 6379;
  const omniq = await OmniqClient.create({ host, port });

  await omniq.consume({
    queue: "demo",
    handler,
    verbose: true,
    drain: false,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
