import { OmniqClient } from "omniq";

async function main() {
  const host = "omniq-redis";
  const port = 6379;

  const omniq = await OmniqClient.create({ host, port });

  const job_id = await omniq.publish({
    queue: "demo",
    payload: { hello: "world" },
    timeout_ms: 30_000,
  });

  console.log("OK", job_id);

  await omniq.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
