// examples/simple/consumer.js
import { OmniqClient } from "../../dist/index.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function handler(ctx) {
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

  const omniq = await OmniqClient.create({ redis_url });

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
