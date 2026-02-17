import { OmniqClient } from "../../src/index.ts";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handler(ctx: any) {
  console.log("Waiting 2 seconds");
  await sleep(2000);
  
  let is_paused = await ctx.exec.ops.is_paused({
    queue: "test",
  });
  console.log(is_paused);

  console.log("Pausing");
  await sleep(2000);
  await ctx.exec.ops.pause({
    queue: "test",
  });
  is_paused = await ctx.exec.ops.is_paused({
    queue: "test",
  });
  console.log(is_paused);

  console.log("Resuming");
  await sleep(2000);
  await ctx.exec.ops.resume({
    queue: "test",
  });
  is_paused = await ctx.exec.ops.is_paused({
    queue: "test",
  });
  console.log(is_paused);
  
  console.log("Done");
}

async function main() {
  const redis_url = "redis://omniq-redis:6379/0";

  const omniq = await OmniqClient.create({ redis_url: redis_url });

  await omniq.consume({
    queue: "test",
    handler,
    verbose: true,
    drain: false,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
