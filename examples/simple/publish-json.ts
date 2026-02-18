import { OmniqClient } from "omniq";

class Customer {
  constructor(
    public id: string,
    public email: string,
    public vip: boolean
  ) {}
}

class OrderCreated {
  constructor(
    public order_id: string,
    public customer: Customer,
    public amount: number,
    public currency: string,
    public items: string[],
    public processed: boolean,
    public retry_count: number,
    public tags?: string[]
  ) {}
}

async function main() {
  const redis_url = "redis://omniq-redis:6379/0";
  const omniq = await OmniqClient.create({ redis_url });

  const payload = new OrderCreated(
    "ORD-2026-0001",
    new Customer("CUST-99", "leo@example.com", true),
    1500,
    "USD",
    ["keyboard", "mouse"],
    false,
    0,
    ["priority", "online"]
  );

  const job_id = await omniq.publishJson({
    queue: "demo",
    payload,
    timeout_ms: 30_000,
    max_attempts: 5,
  });

  console.log("OK", job_id);

  await omniq.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});