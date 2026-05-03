import { OmniqClient } from "omniq";

async function main() {
  const host = "omniq-redis";
  const port = 6379;
  const omniq = await OmniqClient.create({ host, port });

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
