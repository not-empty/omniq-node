import { OmniqClient } from "omniq";

class Payload {
  constructor() {
    this.document_id = "doc_123";
    this.pages = 5;
    this.urgent = true;
    this.meta = { source: "node", attempt: 1 };
  }
}

async function main() {
  const host = "omniq-redis";
  const port = 6379;
  const omniq = await OmniqClient.create({ host, port });

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
