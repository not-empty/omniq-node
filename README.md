# OmniQ (Node.js / TypeScript)

**OmniQ** is a Redis + Lua, language-agnostic job queue.\
This package is the **Node.js / TypeScript client** for OmniQ v1.

Core project / docs: https://github.com/not-empty/omniq

------------------------------------------------------------------------

## Key Ideas

-   **Hybrid lanes**
    -   Ungrouped jobs by default
    -   Optional grouped jobs (FIFO per group + per-group concurrency)
-   **Lease-based execution**
    -   Workers reserve a job with a time-limited lease
-   **Token-gated ACK / heartbeat**
    -   `reserve()` returns a `lease_token`
    -   `heartbeat()` and `ack_*()` must include the same token
-   **Pause / resume (flag-only)**
    -   Pausing prevents *new reserves*
    -   Running jobs are not interrupted
    -   Jobs are not moved
-   **Admin-safe operations**
    -   Strict `retry`, `retry_batch`, `remove`, `remove_batch`
-   **Handler-driven execution layer**
    -   `ctx.exec` exposes internal OmniQ operations safely inside
        handlers

------------------------------------------------------------------------

## Install

``` bash
npm install omniq-node
```

------------------------------------------------------------------------

## Quick Start

### Publish (TypeScript)

``` ts
import { OmniqClient } from "omniq-node";

async function main() {
  const omniq = await OmniqClient.create({
    redisUrl: "redis://omniq-redis:6379/0",
  });

  const jobId = await omniq.publish({
    queue: "demo",
    payload: { hello: "world" },
    timeout_ms: 30_000,
  });

  console.log("OK", jobId);
}

main();
```

------------------------------------------------------------------------

### Consume (TypeScript)

``` ts
import { OmniqClient } from "omniq-node";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function handler(ctx: any) {
  console.log("Waiting 2 seconds");
  await sleep(2000);
  console.log("Done");
}

async function main() {
  const omniq = await OmniqClient.create({
    redisUrl: "redis://omniq-redis:6379/0",
  });

  await omniq.consume({
    queue: "demo",
    handler,
    verbose: true,
    drain: false,
  });
}

main();
```

------------------------------------------------------------------------

## Handler Context

Inside `handler(ctx)`:

-   `queue`
-   `job_id`
-   `payload_raw`
-   `payload`
-   `attempt`
-   `lock_until_ms`
-   `lease_token`
-   `gid`
-   `exec`

------------------------------------------------------------------------

## Child Ack Control (Parent / Child Workflows)

Handler-driven primitive for fan-out workflows.

### Parent Example

``` ts
await omniq.publish({
  queue: "documents",
  payload: {
    document_id: "doc-123",
    pages: 5,
  },
});
```

### Child Example

``` ts
async function pageWorker(ctx: any) {
  const remaining = await ctx.exec.child_ack(ctx.payload.completion_key);

  if (remaining === 0) {
    console.log("Last page finished.");
  }
}
```

Properties:

-   Idempotent decrement
-   Safe under retries
-   Cross-queue safe
-   Fully business-logic driven

------------------------------------------------------------------------

## Grouped Jobs

``` ts
await omniq.publish({
  queue: "demo",
  payload: { i: 1 },
  gid: "company:acme",
  group_limit: 1,
});

await omniq.publish({
  queue: "demo",
  payload: { i: 2 },
});
```

-   FIFO inside group
-   Groups execute in parallel
-   Concurrency limited per group

------------------------------------------------------------------------

## License

See repository license.
