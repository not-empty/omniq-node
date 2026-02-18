import { OmniqClient } from "../../dist/index.js";

class Payload {
  constructor() {
    this.document_id = "doc_123";
    this.pages = 5;
    this.urgent = true;
    this.meta = { source: "node", attempt: 1 };
  }
}

async function main() {
  const redis_url = "redis://omniq-redis:6379/0";
  const omniq = await OmniqClient.create({ redis_url });

  const job_id = await omniq.publishJson({
    queue: "demo",
    payload: new Payload(), // class instance -> publishJson should normalize
    timeout_ms: 30_000,
  });

  console.log("OK", job_id);

  await omniq.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
