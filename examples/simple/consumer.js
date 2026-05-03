import { OmniqClient } from "omniq";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function handler(ctx) {
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
