# OmniQ (Node.js / TypeScript)

**Node.js / TypeScript** client for **OmniQ**, a Redis-based distributed 
job queue designed for deterministic, consumer-driven job execution and coordination.

OmniQ executes queue logic directly inside Redis using Lua scripts, ensuring atomicity, 
consistency, and predictable behavior across distributed systems.

Instead of relying on transient message delivery, OmniQ maintains explicit job state 
and coordination primitives inside Redis, allowing consumers to safely manage retries, 
concurrency, ordering, and distributed execution.

**The system is language-agnostic**, enabling producers and consumers written 
in different runtimes to share the same execution model.

Core project / docs: https://github.com/not-empty/omniq

------------------------------------------------------------------------

## Requirements

**To use OmniQ (Node):**
- Node.js 18+
- Redis >= 7.0
- Lua scripting enabled in Redis
- OmniQ scripts loaded into Redis

------------------------------------------------------------------------

## Install

``` bash
npm install omniq-node
```

------------------------------------------------------------------------

## Features

-   **Redis-native execution model**
    -   All queue operations are executed atomically inside Redis via Lua
-   **Consumer-driven processing**
    -   Workers control reservation, execution, and completion lifecycle
-   **Deterministic job lifecycle**
    -   Explicit states such as wait, active, failed, and completed
-   **Grouped jobs with concurrency control**
    -   FIFO within groups and parallel execution across groups
-   **Atomic administrative operations**
    -   Retry, removal, pause, and batch operations with strong consistency guarantees
-   **Parent/Child workflow primitive**
    -   Fan-out execution with atomic completion tracking
-   **Language-agnostic architecture**
    -   Producers and consumers can run in different runtimes

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

**Handler behavior:**
- Normal completion → job is completed
- Throwing error → job is failed and retried if eligible

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


# Administrative Operations

All operations are atomic and executed via Redis Lua scripts.

## Retry Failed Job

```ts
await omniq.retry_failed("demo", "jobId");
```

------------------------------------------------------------------------

## Retry Failed Batch

```ts
const results = await omniq.retry_failed_batch(
  "demo",
  ["id1", "id2"]
);
```

------------------------------------------------------------------------

## Remove Job

```ts
await omniq.remove_job("demo", "jobId", "failed");
```

------------------------------------------------------------------------

## Remove Jobs Batch

```ts
const results = await omniq.remove_jobs_batch(
  "demo",
  "failed",
  ["id1", "id2"]
);
```

------------------------------------------------------------------------

## Pause / Resume / IsPaused

```ts
await omniq.pause("demo");
const paused = await omniq.is_paused("demo");
await omniq.resume("demo");
```

Pausing prevents new reservations; running jobs are not interrupted.

------------------------------------------------------------------------

## Parent / Child Workflows

This primitive enables fan-out workflows, where a parent job distributes 
work across multiple child jobs and tracks completion using an atomic 
counter stored in Redis.

Each child job acknowledges completion using a shared **completion key**. 
The system guarantees idempotency, meaning retries or duplicate executions 
do not corrupt the counter.

When all child jobs complete, the counter reaches zero.

### Parent Example

```ts
async function parentWorker(ctx: any) {
  const { document_id, pages } = ctx.payload;

  await ctx.exec.childs_init(document_id, pages);

  for (let i = 0; i < pages; i++) {
    await ctx.exec.publish({
      queue: "pages",
      payload: {
        page: i,
        completion_key: document_id,
      },
    });
  }
}
```

### Child Example

```ts
async function pageWorker(ctx: any) {
  const { page, completion_key } = ctx.payload;

  console.log(`Processing page ${page}`);

  const remaining = await ctx.exec.child_ack(completion_key);

  console.log("Remaining:", remaining);

  if (remaining === 0) {
    console.log("All child jobs completed.");
  }
}
```

### Properties

* Idempotent decrement
* Safe under retries
* Cross-queue safe
* Fully business-logic driven

------------------------------------------------------------------------

## Grouped Jobs

```ts
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

------------------------------------------------------------------------

## Pause and Resume Inside a Handler

```ts
async function pauseExample(ctx: any) {
  const paused = await ctx.exec.is_paused("test");
  console.log("Is paused:", paused);

  await ctx.exec.pause("test");

  const paused2 = await ctx.exec.is_paused("test");
  console.log("Is paused:", paused2);

  await ctx.exec.resume("test");
}
```

------------------------------------------------------------------------

## Best Practices

1. Always implement idempotent handlers
2. Tune lease duration carefully to avoid duplication
3. Size Redis according to workload

------------------------------------------------------------------------

## Examples

See the `./examples` folder.

------------------------------------------------------------------------

## License

See repository license.

