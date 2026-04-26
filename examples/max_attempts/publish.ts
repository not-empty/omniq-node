import { OmniqClient } from "omniq";

async function main() {
  const redis_url = "redis://omniq-redis:6379/0";
  const omniq = await OmniqClient.create({ redis_url });

  const job_id = await omniq.publish({
    queue: "max-attempts",
    payload: { hello: "world" },
    max_attempts: 3,
    backoff_ms: 1_000,
    timeout_ms: 30_000,
  });

  console.log("OK", job_id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
