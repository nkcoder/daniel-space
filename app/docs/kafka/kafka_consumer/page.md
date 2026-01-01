---
title: Kafka Consumer Deep Dive
description: Kafka Consumer Deep Dive including Groups, Rebalancing & The New Protocol
---

# Kafka Consumer Deep Dive

The Kafka Consumer appears straightforward—subscribe, poll, process. But production systems demand understanding of consumer groups, rebalancing dynamics, offset management, and now in Kafka 4.x, an entirely new consumer protocol. This post explores these mechanisms in depth.

## Consumer Groups: The Foundation

A consumer group is a set of consumers cooperating to consume data from topics. Kafka distributes partitions among group members, enabling horizontal scaling while preserving per-partition ordering.

```
                         Topic: orders (6 partitions)
                    ┌─────┬─────┬─────┬─────┬─────┬─────┐
                    │ P0  │ P1  │ P2  │ P3  │ P4  │ P5  │
                    └──┬──┴──┬──┴──┬──┴──┬──┴──┬──┴──┬──┘
                       │     │     │     │     │     │
           ┌───────────┴─────┴─────┴─────┴─────┴─────┘
           │         Consumer Group: order-processors
           │
    ┌──────┴──────┬─────────────┬─────────────┐
    ▼             ▼             ▼             ▼
┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐
│Consumer│   │Consumer│   │Consumer│   │Consumer│
│   A    │   │   B    │   │   C    │   │   D    │
│ P0,P1  │   │  P2,P3 │   │   P4   │   │   P5   │
└────────┘   └────────┘   └────────┘   └────────┘
```

**Key principles:**

- Each partition is assigned to exactly one consumer within a group
- A consumer can handle multiple partitions
- If consumers > partitions, some consumers remain idle
- Multiple groups can independently consume the same topic

## The Group Coordinator

Every consumer group has a designated broker serving as its **Group Coordinator**. This coordinator manages membership, triggers rebalances, and stores committed offsets.

The coordinator is determined by hashing the `group.id` to a partition of the `__consumer_offsets` topic—the leader of that partition becomes the coordinator. This distributes coordination load across the cluster.

```
┌─────────────────────────────────────────────────────────────┐
│                  __consumer_offsets (50 partitions)         │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬───────┐  │
│  │ P0  │ P1  │ P2  │ ... │ P25 │ ... │ P47 │ P48 │  P49  │  │
│  └──┬──┴─────┴─────┴─────┴──┬──┴─────┴─────┴─────┴───────┘  │
│     │                       │                                │
│  Broker1               Broker3                               │
│  (Leader P0)           (Leader P25)                          │
│     │                       │                                │
│  Coordinates:           Coordinates:                         │
│  • group-A              • group-B                            │
│  • group-C              • group-D                            │
└─────────────────────────────────────────────────────────────┘
```

## Classic vs New Rebalance Protocol

Kafka 4.0 introduced KIP-848, a fundamentally redesigned consumer protocol. Understanding both is crucial for migration planning.

### Classic Protocol (Pre-4.0 Default)

The classic protocol uses a **synchronous barrier** model with JoinGroup/SyncGroup APIs:

```
Consumer A          Coordinator          Consumer B
    │                    │                    │
    │───JoinGroup───────→│←────JoinGroup──────│
    │                    │                    │
    │   (waits for all members to join)       │
    │                    │                    │
    │←──JoinResponse─────│────JoinResponse───→│
    │   (A elected       │                    │
    │    leader)         │                    │
    │                    │                    │
    │───SyncGroup────────│←────SyncGroup──────│
    │   (with            │   (empty)          │
    │    assignments)    │                    │
    │                    │                    │
    │←──SyncResponse─────│────SyncResponse───→│
    │   (P0,P1)          │   (P2,P3)          │
```

**Problems with classic protocol:**

- **Stop-the-world**: All consumers pause during rebalance
- **Slowest member bottleneck**: One slow consumer delays everyone
- **Client-side complexity**: Assignment logic runs on a "leader" consumer
- **Cascading failures**: One misbehaving consumer affects the entire group

### New Protocol (KIP-848)

The new protocol uses **continuous heartbeats** with server-side coordination:

```
Consumer A          Coordinator          Consumer B
    │                    │                    │
    │──Heartbeat(sub)───→│                    │
    │                    │←──Heartbeat(sub)───│
    │                    │                    │
    │    (Coordinator computes assignment)    │
    │                    │                    │
    │←─Heartbeat(assign)─│                    │
    │   (P0,P1,P2)       │                    │
    │                    │                    │
    │                    │──Heartbeat(assign)→│
    │                    │   (P3,P4,P5)       │
    │                    │                    │
    │   (Consumers reconcile incrementally)   │
```

**Key improvements:**

- **Incremental rebalancing**: Only affected partitions move
- **No global barrier**: Consumers continue processing during rebalance
- **Server-side assignment**: Coordinator computes assignments, not clients
- **Declarative state**: Consumers declare subscriptions; coordinator reconciles

### Enabling the New Protocol

```scala
val config = Map(
  "group.protocol"       -> "consumer",  // Enable KIP-848
  "group.remote.assignor"-> "uniform",   // Server-side assignor (uniform/range)
  // Other standard configs...
)
```

**Requirements:**

- Kafka 4.0+ brokers
- Client library supporting KIP-848 (Java 4.0+, librdkafka 2.10+)
- Broker config: `group.coordinator.rebalance.protocols=classic,consumer`

### Performance Comparison

| Scenario                          | Classic Protocol        | New Protocol                     |
| --------------------------------- | ----------------------- | -------------------------------- |
| 10 consumers, add 900 partitions  | ~103 seconds            | ~5 seconds                       |
| Single consumer joins large group | Full rebalance          | Incremental                      |
| Consumer crash during processing  | All consumers pause     | Others continue                  |
| Coordinator unreachable           | Consumers stop fetching | Consumers continue, can't commit |

## Partition Assignment Strategies

### Server-Side Assignors (New Protocol)

| Assignor  | Behavior                                             |
| --------- | ---------------------------------------------------- |
| `uniform` | Distributes partitions evenly across consumers       |
| `range`   | Assigns contiguous ranges per topic to each consumer |

### Client-Side Assignors (Classic Protocol)

| Assignor                    | Behavior                          | Use Case                |
| --------------------------- | --------------------------------- | ----------------------- |
| `RangeAssignor`             | Contiguous ranges per topic       | Co-partitioned topics   |
| `RoundRobinAssignor`        | Round-robin across all partitions | Even distribution       |
| `StickyAssignor`            | Minimizes partition movement      | Reduce rebalance impact |
| `CooperativeStickyAssignor` | Sticky + cooperative              | Production default      |

```scala
// Classic protocol with cooperative rebalancing
val config = Map(
  "partition.assignment.strategy" ->
    "org.apache.kafka.clients.consumer.CooperativeStickyAssignor"
)
```

## Offset Management

Offsets are the consumer's progress markers. Managing them correctly is the difference between exactly-once and data loss.

### The `__consumer_offsets` Topic

Committed offsets are stored in a compacted internal topic with 50 partitions by default. Each commit writes:

```
Key: (group_id, topic, partition)
Value: (offset, leader_epoch, metadata, timestamp)
```

### Auto vs Manual Commit

| Mode         | Config                    | Behavior                                | Risk                             |
| ------------ | ------------------------- | --------------------------------------- | -------------------------------- |
| Auto         | `enable.auto.commit=true` | Commits every `auto.commit.interval.ms` | Data loss or duplicates on crash |
| Manual Sync  | `commitSync()`            | Blocks until commit confirmed           | Performance impact               |
| Manual Async | `commitAsync()`           | Non-blocking, callback on completion    | No retry on failure              |

### Commit Strategies Compared

**Auto Commit (Default)**

```scala
val config = Map(
  "enable.auto.commit"      -> "true",
  "auto.commit.interval.ms" -> "5000"
)
// Danger: Offsets committed before processing completes
```

**Synchronous After Batch**

```scala
while true do
  val records = consumer.poll(Duration.ofMillis(100))
  for record <- records.asScala do
    process(record)
  consumer.commitSync()  // Blocks until confirmed
```

**Asynchronous with Callback**

```scala
while true do
  val records = consumer.poll(Duration.ofMillis(100))
  for record <- records.asScala do
    process(record)
  consumer.commitAsync { (offsets, exception) =>
    if exception != null then
      logger.warn(s"Commit failed: ${exception.getMessage}")
  }
```

**Per-Record with Batching**

```scala
var processed = 0
val currentOffsets = mutable.Map[TopicPartition, OffsetAndMetadata]()

while true do
  val records = consumer.poll(Duration.ofMillis(100))
  for record <- records.asScala do
    process(record)
    currentOffsets(TopicPartition(record.topic, record.partition)) =
      OffsetAndMetadata(record.offset + 1)
    processed += 1

    if processed % 100 == 0 then
      consumer.commitSync(currentOffsets.asJava)
      currentOffsets.clear()
```

### Delivery Semantics Summary

| Semantic      | Strategy                        | Trade-off            |
| ------------- | ------------------------------- | -------------------- |
| At-most-once  | Commit before processing        | Risk of data loss    |
| At-least-once | Commit after processing         | Risk of duplicates   |
| Exactly-once  | Transactions + `read_committed` | Performance overhead |

### Production Reality: Manual Commit is the Standard

**Manual commit dominates production systems** where data integrity matters. Auto-commit is typically reserved for non-critical pipelines or development environments.
The fundamental problem with auto-commit is the timing gap:

```
poll() returns 1000 messages
     │
     ▼
Auto-commit fires (offset = 1000)  ← Kafka thinks you're done
     │
     ▼
Processing message 500...
     │
     ▼
💥 Application crashes
     │
     ▼
Restart: consumer resumes at offset 1001
     │
     ▼
Messages 501-1000 are LOST
```

Common production patterns (most to least common):

- Manual sync commit after batch — Simple, reliable at-least-once
- Manual async with sync on rebalance — Better throughput for high-volume systems
- Transactional commits — Kafka Streams and exactly-once pipelines
- External offset storage — True exactly-once with databases (store offset in same transaction as processed data)

When auto-commit is acceptable:

- Metrics/logging pipelines where losing a few data points is fine
- Idempotent consumers where reprocessing has no side effects
- Development/testing for simplicity

> **Production Recommendation**: Disable auto-commit (enable.auto.commit=false) and use manual commits after processing completes. This provides at-least-once delivery semantics—the standard for production systems. Auto-commit's convenience rarely outweighs its data loss risk in real workloads.

## Consumer Configuration Deep Dive

### Essential Parameters (Kafka 4.x)

| Parameter               | Default    | Purpose                                      |
| ----------------------- | ---------- | -------------------------------------------- |
| `group.id`              | (required) | Consumer group identifier                    |
| `group.protocol`        | `classic`  | Protocol: `classic` or `consumer`            |
| `auto.offset.reset`     | `latest`   | Where to start: `earliest`, `latest`, `none` |
| `enable.auto.commit`    | `true`     | Auto-commit offsets                          |
| `max.poll.records`      | `500`      | Max records per `poll()`                     |
| `max.poll.interval.ms`  | `300000`   | Max time between polls before rebalance      |
| `session.timeout.ms`    | `45000`    | Heartbeat session timeout                    |
| `heartbeat.interval.ms` | `3000`     | Heartbeat frequency                          |
| `fetch.min.bytes`       | `1`        | Minimum data per fetch                       |
| `fetch.max.wait.ms`     | `500`      | Max wait for `fetch.min.bytes`               |

### New in Kafka 4.x: `auto.offset.reset` by Duration

```scala
// Reset to 24 hours ago instead of earliest/latest
val config = Map(
  "auto.offset.reset" -> "by_duration:PT24H"  // ISO 8601 duration
)
```

### Isolation Levels for Transactions

```scala
val config = Map(
  "isolation.level" -> "read_committed"  // Only see committed transactional messages
  // Default: "read_uncommitted"
)
```

## The Poll Loop: Getting It Right

The `poll()` method is the consumer's heartbeat. Calling it regularly is crucial for group membership.

### Basic Pattern

```scala
val consumer = KafkaConsumer[String, String](config.asJava)
consumer.subscribe(List("orders").asJava)

try
  while running.get do
    val records = consumer.poll(Duration.ofMillis(100))
    for record <- records.asScala do
      processRecord(record)
finally
  consumer.close()
```

### Handling Long Processing

If processing takes longer than `max.poll.interval.ms`, the consumer is considered dead and triggers a rebalance.

**Solution 1: Pause/Resume**

```scala
val records = consumer.poll(Duration.ofMillis(100))
consumer.pause(consumer.assignment)  // Stop fetching

for record <- records.asScala do
  processSlowly(record)  // Can take time

consumer.resume(consumer.assignment)  // Resume fetching
```

**Solution 2: Increase Interval**

```scala
val config = Map(
  "max.poll.interval.ms" -> "600000",  // 10 minutes
  "max.poll.records"     -> "100"       // Smaller batches
)
```

**Solution 3: Offload Processing**

```scala
val executor = Executors.newFixedThreadPool(10)

while running.get do
  val records = consumer.poll(Duration.ofMillis(100))
  val futures = records.asScala.map { record =>
    executor.submit(() => process(record))
  }
  // Wait for batch, then commit
  futures.foreach(_.get())
  consumer.commitSync()
```

## Error Handling & Retry Strategy

Production consumers must handle unexpected failures without crashing the entire group or permanently stalling a partition.

### 1. Blocking Retry (Simplest)

Retry the operation within the poll loop.
**Pros**: Preserves ordering.
**Cons**: Blocks the consumer; can trigger group rebalance if retries exceed `max.poll.interval.ms`.

```scala
var retries = 0
while retries < 3 do
  try
    process(record)
    retries = 3 // Success
  catch
    case e: Exception =>
      retries += 1
      Thread.sleep(100 * retries)
      if retries == 3 then throw e // Give up
```

### 2. Dead Letter Queue (DLQ)

If a message fails repeatedly (or is a known "poison pill"), publish it to a separate `dead-letter-topic` and commit the offset to move on.

```scala
try
  process(record)
catch
  case e: Exception =>
    logger.error(s"Failed to process, sending to DLQ", e)
    producer.send(new ProducerRecord("my-app-dlq", record.key(), record.value()))
    // Functionally "consumed" even though processing failed
```

### 3. Non-Blocking Retry (Advanced)

Publish the failed message to a retry topic with a delay (often implemented via separate topics like `retry-1m`, `retry-5m`). This requires a complex topology of multiple consumers.

## Concurrency & Thread Safety

> [!WARNING]
> The `KafkaConsumer` is **NOT** thread-safe.

You cannot call methods on a single consumer instance from multiple threads. Access must be synchronized or confined to a single thread.

### Multi-Threaded Processing Patterns

1.  **Thread-per-Consumer**: Run strictly one consumer per thread. Good for simple isolation.
2.  **Consumer-Producer Decoupling**: A single thread polls and pushes records to a thread pool (as seen in the [Offload Processing](#solution-3-offload-processing) example).
    - **Risk**: You cannot commit offsets safely until **all** tasks in the batch are finished.
    - **Mitigation**: Accumulate offsets and commit them only when order is guaranteed or gaps are acceptable.

## Rebalance Listeners

React to partition assignment changes with `ConsumerRebalanceListener`:

```scala
consumer.subscribe(
  List("orders").asJava,
  new ConsumerRebalanceListener:
    override def onPartitionsRevoked(partitions: util.Collection[TopicPartition]): Unit =
      logger.info(s"Revoked: ${partitions.asScala.mkString(", ")}")
      // Commit current progress before losing partitions
      consumer.commitSync()
      // Flush any in-memory state
      stateStore.flush()

    override def onPartitionsAssigned(partitions: util.Collection[TopicPartition]): Unit =
      logger.info(s"Assigned: ${partitions.asScala.mkString(", ")}")
      // Initialize state for new partitions
      for tp <- partitions.asScala do
        stateStore.initialize(tp)
)
```

## Static Group Membership

Prevent unnecessary rebalances during rolling restarts with static membership:

```scala
val config = Map(
  "group.instance.id" -> s"order-processor-${hostname}"
)
```

With static membership:

- Consumer can disconnect for up to `session.timeout.ms` without triggering rebalance
- Same instance ID rejoining gets the same partition assignment
- Ideal for Kubernetes deployments with predictable pod names

## Rack Awareness

In cloud environments (AWS, GCP), cross-zone data transfer is expensive and adds latency. Kafka can let consumers fetch from the closest replica (leader or follower).

### Configuration

```scala
val config = Map(
  "client.rack" -> "us-east-1a",  // The zone this consumer is running in
  // Brokers must also have broker.rack configured
)
```

**Benefits:**

- **Reduced Cost**: avoid cross-AZ transfer fees.
- **Lower Latency**: fetch from local broker.
- **Load Balancing**: spreads fetch load across followers.

## Consumer Lag Monitoring

Consumer lag is the gap between the latest message and the last consumed message:

```
Lag = Log End Offset - Consumer Committed Offset
```

### Key Metrics

| Metric                  | Meaning                       |
| ----------------------- | ----------------------------- |
| `records-lag`           | Current lag per partition     |
| `records-lag-max`       | Maximum lag across partitions |
| `fetch-rate`            | Requests per second           |
| `records-consumed-rate` | Messages consumed per second  |
| `commit-rate`           | Offset commits per second     |

### CLI Monitoring

```bash
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group order-processors

# Output:
# GROUP            TOPIC   PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# order-processors orders  0          15234           15240           6
# order-processors orders  1          14892           14892           0
```

## Best Practices Summary

1. **Use the new protocol** (`group.protocol=consumer`) for Kafka 4.0+ deployments—fewer rebalances, better availability
2. **Disable auto-commit** for at-least-once semantics; commit after processing
3. **Size `max.poll.records`** based on processing time to stay within `max.poll.interval.ms`
4. **Use static membership** in containerized environments to minimize rebalance churn
5. **Implement rebalance listeners** to commit offsets and flush state before partition revocation
6. **Monitor consumer lag** as a primary health indicator; alert on sustained high lag
7. **Use `read_committed` isolation** when consuming from transactional producers
8. **Set meaningful `client.id`** and `group.instance.id` for operational visibility
9. **Handle deserialization errors** gracefully—use a DLQ or specific error handlers to prevent poison messages from crashing the loop.
10. **Enable Rack Awareness** (`client.rack`) to reduce cross-zone data transfer costs and latency.
11. **Close consumers properly** in finally blocks to ensure clean group leave.

## Reference

- [Kafka Design](https://kafka.apache.org/41/design/design/#the-consumer)
- [Consumer Configs](https://kafka.apache.org/41/configuration/consumer-configs/)
- [Kafka Consumers: Reading and Reacting to Event Streams](https://developer.confluent.io/courses/apache-kafka/consumers/?utm_medium=sem&utm_source=google&utm_campaign=ch.sem_br.nonbrand_tp.prs_tgt.kafka_mt.xct_rgn.apac_sbrgn.aunz_lng.eng_dv.all_con.kafka-consumer_term.kafka-consumer&utm_term=kafka%20consumer&creative=&device=c&placement=&gad_source=1&gad_campaignid=22120623753&gbraid=0AAAAADRv2c2xJ0veS7y5_Ra-MQv8mgJQe&gclid=CjwKCAiAjc7KBhBvEiwAE2BDOZgHLLP3Uv4NlGeO8wcxV9WdE4w_wgwwLynPQwl2Oc31Qnf9hiI9BBoCdjIQAvD_BwE)
