---
title: Message Delivery Semantics
description: Message Delivery Semantics, Exactly Once and Beyond
date: 2026-01-01
---

# Message Delivery Semantics

In distributed systems, ensuring reliable message delivery is one of the most challenging problems to solve. Network failures, broker crashes, and application restarts can all conspire to lose or duplicate your data. This post explores Kafka's delivery guarantees—from the simple at-most-once to the sophisticated exactly-once semantics—and how to extend these guarantees when integrating with external systems.

## The Three Delivery Guarantees

Before diving into implementation, let's establish what each guarantee actually means:

| Semantic      | Behavior               | Trade-off          | Use Case             |
| ------------- | ---------------------- | ------------------ | -------------------- |
| At-Most-Once  | Fire and forget        | May lose messages  | Metrics, logging     |
| At-Least-Once | Retry on failure       | May duplicate      | Default production   |
| Exactly-Once  | No loss, no duplicates | Highest complexity | Financial, inventory |

### At-Most-Once: Speed Over Safety

The producer sends a message and moves on without waiting for acknowledgment. If the broker fails to receive it, the message is lost forever.

```java
Properties config = new Properties();
config.put("bootstrap.servers", "localhost:9092");
config.put("acks", "0");        // Don't wait for any acknowledgment
config.put("retries", "0");     // Never retry
```

### At-Least-Once: Safety Over Simplicity

The producer retries until it receives acknowledgment. This guarantees delivery but may result in duplicates if the broker wrote the message but the acknowledgment was lost.

```java
Properties config = new Properties();
config.put("bootstrap.servers", "localhost:9092");
config.put("acks", "all");                       // Wait for all replicas
config.put("retries", Integer.MAX_VALUE);
config.put("enable.idempotence", "false");       // Duplicates possible
```

### Exactly-Once: The Gold Standard

Each message is delivered and processed exactly once, even when failures occur. Kafka achieves this through idempotent producers, transactions, and transactional consumers working together.

---

## Idempotent Producers: Eliminating Duplicates

Idempotence ensures that even if the producer retries sending a message, it's written exactly once to the log. This is the foundation of Kafka's exactly-once semantics.

### How It Works

When `enable.idempotence=true`, each producer receives a unique **Producer ID (PID)** and assigns monotonically increasing **sequence numbers** per partition:

```
Producer (PID=1000)                    Broker (Partition 0)
      │                                      │
      │── ProduceRequest ───────────────────►│
      │   (pid=1000, seq=0, "order-1")       │
      │                                      │ Writes record, tracks seq=0
      │◄── ACK (success) ────────────────────│
      │                                      │
      │── ProduceRequest ───────────────────►│
      │   (pid=1000, seq=1, "order-2")       │
      │                                      │ Writes record, tracks seq=1
      │         ✗ ACK lost (network issue)   │
      │                                      │
      │── ProduceRequest (retry) ───────────►│
      │   (pid=1000, seq=1, "order-2")       │
      │                                      │ seq=1 already seen → deduplicate!
      │◄── ACK (success, deduplicated) ──────│
```

The broker maintains a small buffer tracking the last 5 sequence numbers per PID/partition pair. Any message with a sequence number already seen is acknowledged but not written again.

### Configuration (Kafka 4.x Defaults)

Since Kafka 3.0, idempotence is enabled by default:

| Config                                  | Default   | Purpose                                |
| --------------------------------------- | --------- | -------------------------------------- |
| `enable.idempotence`                    | `true`    | Enable PID/sequence tracking           |
| `acks`                                  | `all`     | Wait for all ISR to acknowledge        |
| `retries`                               | `MAX_INT` | Retry indefinitely on transient errors |
| `max.in.flight.requests.per.connection` | `5`       | Max unacknowledged batches             |

With idempotence enabled and `max.in.flight.requests.per.connection ≤ 5`, Kafka guarantees ordering even with retries.

### Limitations of Idempotence Alone

Idempotence provides exactly-once within a single partition for a single producer session. It does **not** help with:

- Atomic writes across multiple partitions or topics
- Coordinating consumer offset commits with produced messages
- Producer crashes and restarts (new PID = new sequence space)

For these scenarios, you need transactions.

### Why Offset Coordination Matters

In a consume-transform-produce workflow, you have two operations that must succeed together:

1. **Produce** the result to an output topic
2. **Commit** the consumer offset to mark input as processed

Without transactions, these are independent and can fail independently:

```
Consumer                                         Broker
    │                                               │
    │◄── poll() returns msg at offset 10 ───────────│
    │                                               │
    │    [process message]                          │
    │                                               │
    │── produce result to output topic ────────────►│ ✓ Written
    │                                               │
    │── commit offset 11 ──────────────────────────►│
    │         💥 CRASH before commit!               │
```

On restart, the consumer asks "what's my last committed offset?" and gets back **10** (since 11 was never committed). It re-reads the same message, processes it again, and produces another copy to the output topic.

**Why doesn't idempotent producer help?** Because you get a **new PID** on restart:

```
Before crash:  PID=1000, seq=42, payload="result-A"  → Written
After restart: PID=1001, seq=0,  payload="result-A"  → Written again!
```

The broker sees a completely different producer—it has no way to know this is a retry of the same logical operation. Idempotence only deduplicates within the same producer session.

**Transactions solve this** by making both operations atomic:

```java
producer.beginTransaction();
producer.send(new ProducerRecord<>("output", key, result));
producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata());
producer.commitTransaction();  // Both succeed or both fail
```

Now only two outcomes are possible:

| Scenario            | Output Message                 | Offset        | On Restart                   |
| ------------------- | ------------------------------ | ------------- | ---------------------------- |
| Commit succeeds     | Visible                        | Updated to 11 | Resume from 11, no reprocess |
| Crash before commit | Not visible (`read_committed`) | Still 10      | Reprocess, but no duplicate  |

The uncommitted message from the failed transaction is filtered out for `read_committed` consumers—so even though you reprocess and produce again, only one copy is ever visible.

---

## Kafka Transactions: Atomic Multi-Partition Writes

Transactions extend exactly-once guarantees to atomic writes across multiple partitions and topics. They enable the consume-transform-produce pattern that powers exactly-once stream processing.

### Transaction Lifecycle

```
initTransactions()      Called once at startup
       │                • Registers transactional.id with coordinator
       │                • Aborts any pending transactions from zombies
       │                • Bumps epoch to fence old producers
       ▼
beginTransaction()      Starts a new transaction (local state only)
       │
       ▼
send() / send()         Produce messages (buffered, marked transactional)
       │
       ▼
sendOffsetsToTransaction()   Commit consumer offsets atomically
       │
       ▼
commitTransaction()     Two-phase commit
       │                • Writes PREPARE_COMMIT to coordinator
       │                • Writes COMMIT markers to all partitions
       │                • Writes COMPLETE_COMMIT to coordinator
       ▼
[Complete]              Messages now visible to read_committed consumers
```

### The Transaction Coordinator

Every transactional producer is assigned a **transaction coordinator**—a broker responsible for managing that producer's transaction state. The coordinator:

1. Maintains state in the `__transaction_state` internal topic (50 partitions)
2. Assigns and tracks producer epochs for zombie fencing
3. Orchestrates the two-phase commit protocol
4. Writes commit/abort markers to participating partitions

Coordinator assignment: `hash(transactional.id) % 50`

### Transactional Producer Example

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("transactional.id", "order-processor-1");
props.put("key.serializer", StringSerializer.class.getName());
props.put("value.serializer", StringSerializer.class.getName());

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Initialize once at startup - registers with coordinator, fences zombies
producer.initTransactions();

try {
    producer.beginTransaction();

    producer.send(new ProducerRecord<>("orders", "order-123", "{\"status\":\"confirmed\"}"));
    producer.send(new ProducerRecord<>("inventory", "sku-456", "{\"reserved\":5}"));
    producer.send(new ProducerRecord<>("notifications", "user-789", "{\"type\":\"confirmed\"}"));

    producer.commitTransaction();
} catch (ProducerFencedException e) {
    // Another producer with same transactional.id is active
    producer.close();
} catch (KafkaException e) {
    producer.abortTransaction();
}
```

---

## Zombie Fencing: Preventing Split-Brain

A "zombie" is a process that appears dead but is actually still running—perhaps due to a network partition or long GC pause. Zombies can cause duplicate processing if not properly handled.

### How Fencing Works

Each `transactional.id` has an associated **epoch** stored by the transaction coordinator. When a new producer calls `initTransactions()`:

1. The coordinator increments the epoch
2. Any in-progress transactions from the old epoch are aborted
3. The new producer receives the updated epoch
4. Any requests from producers with older epochs are rejected with `ProducerFencedException`

```
Timeline:

Producer A (txn-id: "order-proc", epoch=0)
    │── beginTransaction()
    │── send(msg1)
    │
    │   [Network partition - A appears dead]
    │
    │   Producer B starts (same txn-id)
    │   │── initTransactions() → epoch bumped to 1
    │   │── beginTransaction()
    │   │── send(msg2)
    │   │── commitTransaction() ✓
    │
    │   [A recovers]
    │
    │── send(msg3) → FENCED! ProducerFencedException (epoch=0 < 1)
```

### Transactional ID Strategy

**Pre-Kafka 2.5**: Required one transactional.id per input partition

```
transactional.id = "app-" + groupId + "-" + topic + "-" + partition
```

**Kafka 2.5+ (exactly_once_v2)**: Consumer group metadata enables proper fencing with a single producer

```
transactional.id = "app-" + instanceId
```

---

## Consumer Isolation Levels

The `isolation.level` configuration controls what consumers see:

| Level              | Behavior                                                 |
| ------------------ | -------------------------------------------------------- |
| `read_uncommitted` | See all messages including uncommitted/aborted (default) |
| `read_committed`   | Only see committed transactional messages                |

### Last Stable Offset (LSO)

The **Last Stable Offset (LSO)** is the offset of the first message that belongs to an open (undecided) transaction. A `read_committed` consumer can only fetch messages **before** the LSO—everything before it is "stable" (either non-transactional or from a decided transaction).

```
Partition Log:

Offset  Message              Transaction    State
──────────────────────────────────────────────────────
  0     msg-A                (none)         Decided (non-txn)
  1     msg-B                txn-1          Decided (committed)
  2     msg-C                txn-1          Decided (committed)
  3     COMMIT marker        txn-1
  4     msg-D                (none)         Decided (non-txn)
  5     msg-E                txn-2          UNDECIDED ◄─── LSO
  6     msg-F                txn-2          UNDECIDED
  7     msg-G                (none)         Decided (but blocked!)
  8     msg-H                txn-2          UNDECIDED
──────────────────────────────────────────────────────
                                            LEO = 9, LSO = 5

read_committed consumer can only fetch offsets 0-4
```

Notice: **msg-G at offset 7 is non-transactional** (immediately decided), but the consumer cannot read it yet. The broker enforces the LSO limit at fetch time—undecided messages are never sent to `read_committed` consumers:

```
Consumer (read_committed)                    Broker
    │                                           │
    │── FetchRequest(offset=5) ────────────────►│
    │                                           │ LSO=5, nothing safe to send
    │◄── FetchResponse(empty) ──────────────────│
    │                                           │
    │   [blocked, waiting...]                   │
    │                                           │
    │                                           │ txn-2 commits, LSO → 10
    │── FetchRequest(offset=5) ────────────────►│
    │◄── FetchResponse(offsets 5-9) ────────────│ Now safe to send
```

### Long Transactions Block All Consumers

If a producer starts a transaction and takes a long time to commit (or crashes), the LSO stays stuck and blocks all `read_committed` consumers—even from reading non-transactional messages that arrived later:

```
Timeline:
────────────────────────────────────────────────────────────────►

Producer A: beginTransaction()
            │── send(msg-E, offset 5)
            │
            │   [hangs or goes slow...]
            │
            │                    Meanwhile, other producers write:
            │                      msg-G (offset 7), msg-I (offset 9)...
            │
            │   LSO stuck at 5!
            │   Consumers blocked from ALL messages at offset ≥ 5
            │
            │── commitTransaction()
            │
                 LSO advances, consumers catch up
```

This is why `transaction.timeout.ms` exists (default 60s)—the broker automatically aborts transactions that exceed this duration, allowing the LSO to advance.

### How Aborted Messages Are Filtered

When a transaction aborts, the LSO advances and the broker sends all messages (including aborted ones) to the consumer. The consumer then filters out aborted messages client-side:

```
After txn-2 aborts, LSO advances to 10:

Broker sends:     [msg-E] [msg-F] [msg-G] [msg-H] [ABORT marker]
                   (txn-2) (txn-2) (none)  (txn-2)

Consumer filters: [msg-E] [msg-F]         [msg-H]  ← skipped (aborted)

Consumer delivers only: [msg-G]
```

| Stage                      | What Happens                                         |
| -------------------------- | ---------------------------------------------------- |
| Fetch (broker-side)        | Limits response to LSO—undecided messages never sent |
| After abort (client-side)  | Filters out aborted messages based on abort marker   |
| After commit (client-side) | Delivers all messages normally                       |

### Consumer Configuration

```java
Properties config = new Properties();
config.put("bootstrap.servers", "localhost:9092");
config.put("group.id", "order-consumers");
config.put("isolation.level", "read_committed");
config.put("enable.auto.commit", "false");
config.put("key.deserializer", StringDeserializer.class.getName());
config.put("value.deserializer", StringDeserializer.class.getName());
```

---

## The Consume-Transform-Produce Pattern

This pattern is the foundation of exactly-once stream processing: consume from input topics, process, and produce to output topics—all atomically.

```java
KafkaConsumer<String, String> consumer = new KafkaConsumer<>(consumerProps);
KafkaProducer<String, String> producer = new KafkaProducer<>(producerProps);

producer.initTransactions();
consumer.subscribe(List.of("orders"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    if (!records.isEmpty()) {
        producer.beginTransaction();
        try {
            // Process and produce
            for (ConsumerRecord<String, String> record : records) {
                String result = process(record.value());
                producer.send(new ProducerRecord<>("results", record.key(), result));
            }

            // Build offsets to commit
            Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();
            for (TopicPartition partition : records.partitions()) {
                var partitionRecords = records.records(partition);
                long lastOffset = partitionRecords.get(partitionRecords.size() - 1).offset();
                offsets.put(partition, new OffsetAndMetadata(lastOffset + 1));
            }

            // Commit offsets atomically with produced messages
            producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata());
            producer.commitTransaction();
        } catch (Exception e) {
            producer.abortTransaction();
        }
    }
}
```

The key: `sendOffsetsToTransaction` commits consumer offsets **within the same transaction** as produced messages. If the transaction aborts, offsets aren't committed and the consumer re-reads the same messages.

---

## Exactly-Once with External Systems

Kafka's exactly-once guarantees apply only within Kafka. When writing to databases or calling APIs, you face the **dual-write problem**: two systems that can't share a transaction boundary.

### Pattern 1: Idempotent Consumer

Make your consumer logic idempotent so processing the same message multiple times has the same effect as processing it once.

**Strategy A: Database Upserts**

```sql
INSERT INTO orders (order_id, status, amount)
VALUES ($1, $2, $3)
ON CONFLICT (order_id) DO UPDATE SET status = $2, amount = $3;
```

**Strategy B: Deduplication Table**

```java
void processMessage(ConsumerRecord<String, String> record) {
    String messageId = new String(record.headers().lastHeader("message-id").value());

    db.transaction(() -> {
        if (!db.exists("processed_messages", messageId)) {
            Result result = transform(record.value());
            db.insert("results", result);
            db.insert("processed_messages", messageId, Instant.now());
        }
    });
}
```

**Strategy C: Idempotency Keys for APIs**

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://payment.service/charge"))
    .header("Idempotency-Key", record.key())
    .POST(HttpRequest.BodyPublishers.ofString(body))
    .build();
```

### Pattern 2: Transactional Outbox

Instead of writing to both database and Kafka, write only to the database—including an "outbox" table for events to publish.

```
┌─────────────────────────────────────────────────┐
│         Single Database Transaction             │
│                                                 │
│  ┌─────────────┐      ┌──────────────────┐     │
│  │ orders      │      │ outbox_events    │     │
│  │ (business)  │      │ (to publish)     │     │
│  └─────────────┘      └──────────────────┘     │
│         └──────────────────┘                    │
│              COMMIT (atomic)                    │
└─────────────────────────────────────────────────┘
                      │
                      ▼
            CDC (Debezium) / Poller
                      │
                      ▼
                Kafka Topic
```

```java
db.transaction(() -> {
    // Business logic
    db.update("orders", orderId, Map.of("status", "confirmed"));

    // Write to outbox (same transaction)
    db.insert("outbox_events", Map.of(
        "event_id", UUID.randomUUID(),
        "aggregate_type", "Order",
        "aggregate_id", orderId,
        "event_type", "OrderConfirmed",
        "payload", "{\"orderId\":\"" + orderId + "\",\"status\":\"confirmed\"}",
        "created_at", Instant.now()
    ));
});
```

| Publishing Approach | Pros                   | Cons                  |
| ------------------- | ---------------------- | --------------------- |
| Polling             | Simple, no extra infra | Latency, DB load      |
| Debezium CDC        | Low latency, ordering  | Additional complexity |
| Kafka Connect JDBC  | Configuration-driven   | Polling-based         |

---

## Transaction Performance

Transactions add overhead. Understanding where helps you optimize:

### Write Amplification

Each transaction adds:

- RPCs to register partitions with coordinator
- `PREPARE_COMMIT` record to `__transaction_state`
- `COMMIT` marker to each participating partition
- `COMPLETE_COMMIT` record to `__transaction_state`

### Latency Impact

| Commit Interval | Overhead | Use Case          |
| --------------- | -------- | ----------------- |
| Per-message     | ~50%     | Ultra-low latency |
| 100ms           | ~10%     | Balanced          |
| 1000ms          | ~2%      | High throughput   |

### Best Practices

```java
// Good: batch multiple records per transaction
producer.beginTransaction();
for (ProducerRecord<String, String> record : batch) {
    producer.send(record);
}
producer.commitTransaction();

// Bad: one transaction per record (high overhead)
for (ProducerRecord<String, String> record : records) {
    producer.beginTransaction();
    producer.send(record);
    producer.commitTransaction();
}
```

Additional recommendations:

- Keep transactions short to avoid delaying LSO
- Set `transaction.timeout.ms` to exceed your longest expected transaction
- Monitor for hung transactions using `kafka-transactions.sh`

---

## Kafka Streams: EOS Made Easy

Kafka Streams handles all exactly-once complexity for you:

```java
Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "order-processor");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, "exactly_once_v2");
props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass());
props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.String().getClass());

StreamsBuilder builder = new StreamsBuilder();
builder.<String, String>stream("orders")
    .mapValues(order -> processOrder(order))
    .to("processed-orders");

KafkaStreams streams = new KafkaStreams(builder.build(), props);
Runtime.getRuntime().addShutdownHook(new Thread(streams::close));
streams.start();
```

With `exactly_once_v2` (Kafka 2.5+):

- Each task uses transactions internally
- Consumer offsets committed atomically with output
- Zombie fencing via consumer group metadata
- One producer per thread (not per partition)

---

## Choosing the Right Guarantee

| Scenario                  | Recommendation                               |
| ------------------------- | -------------------------------------------- |
| Metrics, logging          | At-most-once (`acks=0`)                      |
| General messaging         | At-least-once (default idempotent producer)  |
| Kafka-to-Kafka processing | Exactly-once (transactions or Kafka Streams) |
| Kafka-to-database         | Idempotent consumer + transactional outbox   |
| Kafka-to-external API     | Idempotent consumer + idempotency keys       |

---

## Key Takeaways

1. **Idempotent producers are now default**: Since Kafka 3.0, you get exactly-once within partitions automatically.

2. **Transactions enable atomic multi-partition writes**: Use them for consume-transform-produce patterns.

3. **Zombie fencing is automatic**: The `transactional.id` + epoch mechanism prevents duplicate processing from crashed producers.

4. **`read_committed` is required**: Consumers must opt-in to see only committed transactional messages.

5. **External systems need additional patterns**: The outbox pattern and idempotent consumers extend exactly-once beyond Kafka.

6. **Kafka Streams simplifies everything**: For stream processing, `exactly_once_v2` handles all the complexity.

## References

- [Kafka Documentation: Message Delivery Semantics](https://kafka.apache.org/documentation/#semantics)
- [Exactly-once Semantics is Possible: Here's How Kafka Does It](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/)
- [Transactions in Apache Kafka](https://www.confluent.io/blog/transactions-apache-kafka/)
- [KIP-447: Producer Scalability for Exactly Once Semantics](https://cwiki.apache.org/confluence/display/KAFKA/KIP-447)
