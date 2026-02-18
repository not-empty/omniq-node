import { OmniqClient } from "omniq";

async function main() {
  const redis_url = "redis://omniq-redis:6379/0"

  const omniq = await OmniqClient.create({ redis_url });

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
