---
title: Kafka Core Concepts
description: An overview of the core concepts of Apache Kafka, including topics, partitions, producers, consumers, and brokers.
date: 2025-12-30
---

# Kafka Core Concepts

## The Append-Only Commit Log

At its heart, Kafka is a distributed commit log. This simple yet powerful abstraction is the foundation of everything Kafka does.

### What is a Commit Log?

A commit log (also called a write-ahead log or WAL) is an append-only data structure where new records are always written to the end. Records are never modified in place — they're immutable once written.

```
┌─────────────────────────────────────────────────────────────────┐
│                    The Commit Log Abstraction                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Offset:   0     1     2     3     4     5     6     7           │
│          ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐        │
│  Records │ A │ │ B │ │ C │ │ D │ │ E │ │ F │ │ G │ │ H │        │
│          └───┘ └───┘ └───┘ └───┘ └───┘ └───┘ └───┘ └───┘        │
│            ▲                               ▲           ▲         │
│            │                               │           │         │
│         Oldest                          Consumer    Newest       │
│         Record                          Position    Record       │
│                                                                   │
│  ◄──────────────── Reads ────────────────►                       │
│                                            ◄── Writes (append)   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Why Append-Only?

This design choice unlocks several critical advantages:

**1. Sequential I/O Performance**

Hard drives and SSDs perform dramatically better with sequential access patterns. Kafka's append-only writes achieve throughput close to the theoretical maximum of the underlying storage.

```
┌────────────────────────────────────────────────────────────────┐
│                 Sequential vs. Random I/O                       │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Random I/O:     Seek → Read → Seek → Read → Seek → Read        │
│                  ~~~~   ▓▓▓   ~~~~   ▓▓▓   ~~~~   ▓▓▓           │
│                  (slow)       (slow)       (slow)                │
│                                                                  │
│  Sequential I/O: Read ─────────────────────────────────►        │
│                  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓          │
│                  (fast - no seeks needed)                        │
│                                                                  │
│  HDD Sequential: ~100-200 MB/s                                   │
│  HDD Random:     ~1-2 MB/s (100x slower!)                        │
│  SSD Sequential: ~500-3000 MB/s                                  │
│  SSD Random:     ~50-200 MB/s (still 10x slower)                 │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

**2. Simplified Concurrency**

With append-only writes, there's no need for complex locking. Writers always append to the end, while readers can safely read any previously written data.

**3. Natural Replication**

Replicating an append-only log is straightforward: followers simply fetch and append new records from the leader. No complex conflict resolution needed.

**4. Time Travel**

Because records are never deleted immediately, consumers can "rewind" and reprocess historical data. This enables powerful patterns like event sourcing and stream replay.

---

## Brokers and Cluster Architecture

A single Kafka server is called a **Kafka broker**. An ensemble of Kafka brokers working together is called a **Kafka cluster**. Each broker in a cluster is identified by a unique numeric ID.

```
┌────────────────────────────────────────────────────────────────┐
│                      Kafka Cluster                              │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Broker 1   │  │   Broker 2   │  │   Broker 3   │          │
│  │   (id: 1)    │  │   (id: 2)    │  │   (id: 3)    │          │
│  │              │  │              │  │              │          │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │          │
│  │ │Partitions│ │  │ │Partitions│ │  │ │Partitions│ │          │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         ▲                 ▲                 ▲                   │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           │                                      │
│                    ┌──────┴──────┐                               │
│                    │   Clients   │                               │
│                    │ (Producers/ │                               │
│                    │  Consumers) │                               │
│                    └─────────────┘                               │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### Bootstrap Servers

Every broker in the cluster has metadata about all other brokers:

- Any broker in the cluster is also called a **bootstrap server**
- A client can connect to any broker to get metadata about the entire cluster
- In practice, it is common for Kafka clients to connect to multiple bootstrap servers to ensure high availability and fault tolerance

```java
// Connecting to multiple bootstrap servers for fault tolerance
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG,
    "broker1:9092,broker2:9092,broker3:9092");
```

### Broker Responsibilities

Each broker handles:

- **Storage:** Persisting partition data to disk
- **Replication:** Serving as leader or follower for partitions
- **Client requests:** Handling produce and fetch requests
- **Cluster coordination:** Participating in leader election and metadata management

---

## Topics: Logical Organization

A **topic** is a named stream of records. It's the primary abstraction for organizing data in Kafka.

Similar to how databases have **tables** to organize data, Kafka uses **topics** to organize related messages. But unlike database tables, Kafka topics are not queryable. Instead, we use Kafka producers to send data to the topic and Kafka consumers to read data from the topic.

### Topic Characteristics

- **Named category:** Like a table in a database or a folder in a filesystem
- **Multi-subscriber:** Multiple consumer groups can read independently
- **Partitioned:** Split across multiple partitions for parallelism
- **Replicated:** Each partition can have multiple replicas for fault tolerance
- **Configurable:** Retention, compaction, and other settings are per-topic
- **Immutable:** Once a message is written to a topic, it cannot be changed or deleted

### Topic Naming Conventions

Good topic names are crucial for maintainability:

```
┌────────────────────────────────────────────────────────────────┐
│                    Topic Naming Best Practices                  │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Pattern: <domain>.<entity>.<event-type>                        │
│                                                                  │
│  Examples:                                                       │
│  ✓ orders.payments.completed                                    │
│  ✓ inventory.products.updated                                   │
│  ✓ users.accounts.created                                       │
│  ✓ analytics.pageviews.raw                                      │
│                                                                  │
│  Anti-patterns:                                                  │
│  ✗ topic1, test, data          (too generic)                    │
│  ✗ Orders_Payments_Completed   (inconsistent casing)            │
│  ✗ orders-payments-completed   (hyphens can cause issues)       │
│                                                                  │
│  Internal Topics (Kafka-managed):                                │
│  • __consumer_offsets          (consumer group offsets)         │
│  • __transaction_state         (transaction metadata)           │
│  • __cluster_metadata          (KRaft metadata - single node)   │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### Creating and Managing Topics

```bash
# Create a topic with specific configuration
bin/kafka-topics.sh --bootstrap-server localhost:9092 \
    --create \
    --topic orders.payments.completed \
    --partitions 12 \
    --replication-factor 3 \
    --config retention.ms=604800000 \
    --config cleanup.policy=delete

# Describe topic details
bin/kafka-topics.sh --bootstrap-server localhost:9092 \
    --describe \
    --topic orders.payments.completed

# Alter topic configuration
bin/kafka-configs.sh --bootstrap-server localhost:9092 \
    --alter \
    --entity-type topics \
    --entity-name orders.payments.completed \
    --add-config retention.ms=259200000

# List all topics
bin/kafka-topics.sh --bootstrap-server localhost:9092 --list

# Delete a topic
bin/kafka-topics.sh --bootstrap-server localhost:9092 \
    --delete \
    --topic orders.payments.completed
```

### Key Topic Configurations

| Configuration         | Default            | Description                              |
| --------------------- | ------------------ | ---------------------------------------- |
| `retention.ms`        | 604800000 (7 days) | How long to retain records               |
| `retention.bytes`     | -1 (unlimited)     | Max size per partition before deletion   |
| `cleanup.policy`      | delete             | `delete`, `compact`, or `compact,delete` |
| `segment.bytes`       | 1073741824 (1GB)   | Max size of a single segment file        |
| `segment.ms`          | 604800000 (7 days) | Time before rolling to new segment       |
| `min.insync.replicas` | 1                  | Minimum replicas for `acks=all`          |
| `compression.type`    | producer           | `none`, `gzip`, `snappy`, `lz4`, `zstd`  |

---

## Partitions: The Unit of Parallelism

While topics provide logical organization, **partitions** are where the real work happens. A partition is an ordered, immutable sequence of records that is continually appended to.

### Why Partitions?

```
┌────────────────────────────────────────────────────────────────┐
│              Topic with 4 Partitions Across 3 Brokers           │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Topic: orders.payments.completed                                │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Broker 1   │  │   Broker 2   │  │   Broker 3   │           │
│  │              │  │              │  │              │           │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │           │
│  │ │ P0 (L)   │ │  │ │ P0 (F)   │ │  │ │ P1 (L)   │ │           │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │           │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │           │
│  │ │ P2 (F)   │ │  │ │ P1 (F)   │ │  │ │ P3 (L)   │ │           │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │           │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │           │
│  │ │ P3 (F)   │ │  │ │ P2 (L)   │ │  │ │ P0 (F)   │ │           │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
│  L = Leader (handles reads/writes)                               │
│  F = Follower (replicates from leader)                           │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

**Partitions enable:**

1. **Horizontal Scalability:** Data is spread across multiple brokers
2. **Parallel Processing:** Multiple consumers can read in parallel
3. **Ordering Guarantees:** Records within a partition are strictly ordered
4. **Load Balancing:** Producers distribute records across partitions

### Partition Assignment and Keys

Records are assigned to partitions based on their **key**:

```
┌────────────────────────────────────────────────────────────────┐
│                 Partition Assignment Logic                      │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  if (key == null)                                               │
│      partition = stickyPartition()  // Batch, then switch       │
│  else                                                           │
│      partition = hash(key) % numPartitions                      │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

**Key-based partitioning guarantees:**

- Records with the same key always go to the same partition
- Records with the same key are always in order relative to each other
- Perfect for maintaining per-entity ordering (e.g., all orders for customer X)

```
┌────────────────────────────────────────────────────────────────┐
│                    Key-Based Partitioning                       │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Records with keys:                                              │
│  [A:1] [B:2] [A:3] [C:4] [B:5] [A:6] [C:7] [B:8]                │
│                                                                  │
│  After partitioning (3 partitions):                              │
│                                                                  │
│  Partition 0: [A:1] ─► [A:3] ─► [A:6]    (all key=A, ordered)   │
│  Partition 1: [B:2] ─► [B:5] ─► [B:8]    (all key=B, ordered)   │
│  Partition 2: [C:4] ─► [C:7]             (all key=C, ordered)   │
│                                                                  │
│  ✓ Per-key ordering preserved                                    │
│  ✗ No global ordering across partitions                          │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### Choosing Partition Count

The partition count decision involves several trade-offs:

```
┌────────────────────────────────────────────────────────────────┐
│               Partition Count Considerations                    │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  More Partitions                   Fewer Partitions             │
│  ──────────────                    ─────────────────            │
│  ✓ Higher throughput               ✓ Lower overhead              │
│  ✓ More consumer parallelism       ✓ Faster leader elections     │
│  ✓ Better load distribution        ✓ Less memory usage           │
│  ✗ More file handles               ✓ Stronger ordering           │
│  ✗ Longer leader elections         ✗ Limited parallelism         │
│  ✗ More memory overhead            ✗ Potential hot spots         │
│                                                                  │
│  Rule of Thumb:                                                  │
│  ─────────────                                                   │
│  partitions = max(throughput / partition_throughput,             │
│                   expected_consumers)                            │
│                                                                  │
│  Where partition_throughput ≈ 10-50 MB/s depending on hardware  │
│                                                                  │
│  ⚠️  You can increase partitions later, but NOT decrease them    │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### The Hot Partition Problem

Uneven key distribution leads to "hot" partitions:

```
┌────────────────────────────────────────────────────────────────┐
│                    Hot Partition Anti-Pattern                   │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Bad: Using low-cardinality keys                                 │
│  key = record.country  // Only ~200 unique values               │
│                                                                  │
│  Result:                                                         │
│  P0 (USA):     ████████████████████████████░░░ (80% of traffic) │
│  P1 (UK):      ████░░░░░░░░░░░░░░░░░░░░░░░░░░░ (10%)            │
│  P2 (Germany): ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░ (8%)             │
│  P3 (Others):  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ (2%)             │
│                                                                  │
│  Good: Using high-cardinality keys                               │
│  key = s"${record.country}-${record.userId}"                    │
│                                                                  │
│  Result:                                                         │
│  P0: █████████░░░░░░░░░░░░░░░░░░░░░ (25%)                       │
│  P1: █████████░░░░░░░░░░░░░░░░░░░░░ (25%)                       │
│  P2: █████████░░░░░░░░░░░░░░░░░░░░░ (25%)                       │
│  P3: █████████░░░░░░░░░░░░░░░░░░░░░ (25%)                       │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

---

## Producers: Writing Data to Kafka

Applications that send data into topics are called **Kafka producers**. A producer sends messages to a topic, and messages are distributed across the topic's partitions.

### Message Structure

Each Kafka message (record) contains:

```
┌────────────────────────────────────────────────────────────────┐
│                      Kafka Record Structure                     │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     Record Batch                          │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │ Base Offset        │ Batch Length    │ Magic       │  │   │
│  │  │ CRC                │ Attributes      │ Timestamp   │  │   │
│  │  │ Producer ID        │ Producer Epoch  │ Base Seq    │  │   │
│  │  ├────────────────────────────────────────────────────┤  │   │
│  │  │                    Records[]                        │  │   │
│  │  │  ┌─────────────────────────────────────────────┐   │  │   │
│  │  │  │ Length │ Attrs │ Timestamp Delta │ Offset Δ │   │  │   │
│  │  │  │ Key    │ Value │ Headers[]                  │   │  │   │
│  │  │  └─────────────────────────────────────────────┘   │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Key Fields:                                                     │
│  • Key: Optional; used for partitioning and compaction           │
│  • Value: The actual message payload                             │
│  • Headers: Optional key-value metadata                          │
│  • Timestamp: Event time or ingestion time                       │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### Message Keys

Each message contains an optional key and a value:

- If the key is **not specified**, messages are sent in a round-robin fashion (with sticky partitioning for batching efficiency)
- If the key is **specified**, the message is sent to the partition determined by hashing the key; all messages with the same key go to the same partition
- A key can be anything: a string, a number, or a complex object serialized to bytes

Message keys are commonly used when there is a need for message ordering for all messages sharing the same field (e.g., all events for a specific user).

### Producer Acknowledgments (acks)

For a message to be successfully written, the producer must specify a level of acknowledgment:

```
┌────────────────────────────────────────────────────────────────┐
│                    Producer Acknowledgments                     │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  acks=0 (Fire and Forget)                                       │
│  ─────────────────────────                                      │
│  Producer ──► Broker                                            │
│  • No acknowledgment waited                                     │
│  • Highest throughput, possible data loss                       │
│                                                                  │
│  acks=1 (Leader Only)                                           │
│  ────────────────────                                           │
│  Producer ──► Leader ──► ACK                                    │
│  • Leader acknowledges write                                    │
│  • Data loss possible if leader fails before replication        │
│                                                                  │
│  acks=all (-1) (Full ISR)                                       │
│  ────────────────────────                                       │
│  Producer ──► Leader ──► Followers ──► ACK                      │
│  • All in-sync replicas must acknowledge                        │
│  • Strongest durability guarantee                               │
│  • Use with min.insync.replicas > 1                             │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### Message Serialization

Kafka messages are serialized into binary format (byte array) before being sent. Common serializers include:

- `StringSerializer` - for string keys/values
- `ByteArraySerializer` - for raw bytes
- `JsonSerializer` - for JSON objects
- `AvroSerializer` / `ProtobufSerializer` - for schema-based serialization

The serialization format of a topic should not change during its lifetime. Create a new topic if the format needs to change.

---

## Consumers and Consumer Groups

Applications that read data from topics are called **Kafka consumers**.

### Consumer Basics

- Consumers read from one or more partitions at a time
- Data is read **in order within each partition**
- A consumer always reads from a lower offset to a higher offset (cannot read backwards)
- Consumers use the **pull model**: they request data when ready, rather than being pushed data

By default, consumers only consume data produced after they first connected. However, they can be configured to read from the beginning or from a specific offset.

### Consumer Groups

A **consumer group** is a group of consumers that work together to consume messages from one or more topics. Each consumer in the group reads from a unique set of partitions:

```
┌────────────────────────────────────────────────────────────────┐
│                    Consumer Group Example                       │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Topic: orders (4 partitions)                                   │
│  Consumer Group: order-processors                               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                      Partitions                           │   │
│  │    P0          P1          P2          P3                 │   │
│  │    │           │           │           │                  │   │
│  │    ▼           ▼           ▼           ▼                  │   │
│  │ ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐                │   │
│  │ │ C1   │   │ C1   │   │ C2   │   │ C3   │                │   │
│  │ └──────┘   └──────┘   └──────┘   └──────┘                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  • C1 consumes from P0 and P1                                   │
│  • C2 consumes from P2                                          │
│  • C3 consumes from P3                                          │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

**Key rules:**

- All consumers in a group share the same `group.id`
- Each partition is consumed by **exactly one** consumer in the group at a time
- A consumer can consume from **multiple** partitions
- If a consumer fails, Kafka **rebalances** partitions to other consumers
- If there are **more consumers than partitions**, some consumers will be idle

### Message Deserialization

Data being consumed must be deserialized from binary format back into its original format. The deserializer must match the serializer used by the producer.

---

## Offsets and Delivery Semantics

An **offset** is a unique, sequential identifier for each record within a partition. Offsets start at 0 and increment by 1 for each new record.

### Offset Semantics

```
┌────────────────────────────────────────────────────────────────┐
│                    Offset Management                            │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Partition 0:                                                    │
│                                                                  │
│  Offset:    0   1   2   3   4   5   6   7   8   9   10          │
│           ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐             │
│  Records: │ A │ B │ C │ D │ E │ F │ G │ H │ I │ J │             │
│           └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘             │
│             ▲                   ▲           ▲       ▲            │
│             │                   │           │       │            │
│        Log Start           Committed    Current   Log End       │
│        Offset              Offset       Position  Offset        │
│                                                                  │
│  Key Offsets:                                                    │
│  • Log Start Offset: Earliest available (0, unless truncated)   │
│  • Committed Offset: Last offset consumer has committed (5)     │
│  • Current Position: Where consumer will read next (8)          │
│  • Log End Offset: Next offset to be written (10)               │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

**Important:** Offsets are never reused, even after data is deleted. They continually increment.

### Consumer Offset Commits

Consumers periodically commit the offset of the last processed message to Kafka. This is stored in the internal `__consumer_offsets` topic.

Committing offsets allows consumers to resume from where they left off after:

- Consumer crashes
- Rebalances occur
- New consumers join the group

### Auto Offset Reset

When a consumer starts with no committed offset, `auto.offset.reset` determines where to begin:

| Value      | Behavior                                  |
| ---------- | ----------------------------------------- |
| `earliest` | Start from the beginning of the partition |
| `latest`   | Start from the end (only new records)     |
| `none`     | Throw an exception if no offset found     |

### Delivery Semantics

How you commit offsets determines your delivery guarantees:

**At-Most-Once:**

- Offsets are committed **before** processing
- If processing fails, the message is lost (won't be read again)
- Use case: Metrics where occasional loss is acceptable

**At-Least-Once (Recommended):**

- Offsets are committed **after** processing
- If processing fails, the message will be read again
- Requires **idempotent processing** to handle duplicates
- Use case: Most business applications

**Exactly-Once:**

- Achievable for Kafka-to-Kafka workflows using the **transactional API**
- For Kafka-to-external-system workflows, use an **idempotent consumer**
- Use case: Financial transactions, inventory updates

In practice, **at-least-once with idempotent processing** is the most common and practical approach.

---

## Storage Internals: Segments and Indexes

Understanding how Kafka stores data on disk helps with operations and troubleshooting.

### Partition Directory Structure

Each partition is stored as a directory containing segment files:

```
/var/lib/kafka/data/
└── orders.payments.completed-0/          # Topic-Partition directory
    ├── 00000000000000000000.log          # Segment: offsets 0-1006
    ├── 00000000000000000000.index        # Offset index
    ├── 00000000000000000000.timeindex    # Time index
    ├── 00000000000000001007.log          # Segment: offsets 1007-2014
    ├── 00000000000000001007.index
    ├── 00000000000000001007.timeindex
    ├── 00000000000000001007.snapshot     # Producer state snapshot
    ├── 00000000000000002015.log          # Active segment (being written)
    ├── 00000000000000002015.index
    ├── 00000000000000002015.timeindex
    ├── leader-epoch-checkpoint           # Leader epoch history
    └── partition.metadata                # Partition metadata
```

The filename (e.g., `00000000000000001007`) is the **base offset** — the offset of the first record in that segment.

### Segment Lifecycle

```
┌────────────────────────────────────────────────────────────────┐
│                      Segment Lifecycle                          │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. ACTIVE (Read-Write)                                          │
│     ┌─────────────────────────────────────────────┐             │
│     │ 00000000000000002015.log                    │             │
│     │ [record][record][record][    empty    ]     │◄── Appends  │
│     └─────────────────────────────────────────────┘             │
│                           │                                      │
│                           │ Segment rolls when:                  │
│                           │ • Size ≥ log.segment.bytes (1GB)     │
│                           │ • Age ≥ log.roll.ms (7 days)         │
│                           │ • Index full                         │
│                           ▼                                      │
│  2. INACTIVE (Read-Only)                                         │
│     ┌─────────────────────────────────────────────┐             │
│     │ 00000000000000002015.log                    │             │
│     │ [record][record][record][record][record]    │◄── Reads    │
│     └─────────────────────────────────────────────┘             │
│                           │                                      │
│                           │ Eligible for cleanup when:           │
│                           │ • Age > retention.ms                 │
│                           │ • Size triggers retention.bytes      │
│                           │ • Compaction criteria met            │
│                           ▼                                      │
│  3. DELETED                                                      │
│     ┌─────────────────────────────────────────────┐             │
│     │ 00000000000000002015.log.deleted            │             │
│     │ (marked for deletion, removed by cleaner)   │             │
│     └─────────────────────────────────────────────┘             │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### Index Files: Fast Offset Lookup

Kafka maintains sparse indexes for efficient lookups:

**Offset Index (`.index`):** Maps logical offset → physical file position

```
┌────────────────────────────────────────────────────────────────┐
│                   Offset Index (.index)                         │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  .index file (sparse - NOT every offset):                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  offset: 0    │  position: 0      │                     │    │
│  │  offset: 28   │  position: 4169   │  Entry added every  │    │
│  │  offset: 56   │  position: 8364   │  log.index.interval │    │
│  │  offset: 84   │  position: 12540  │  .bytes (4KB)       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Lookup offset 35:                                               │
│  1. Binary search index → find offset 28 @ position 4169        │
│  2. Scan .log from position 4169 until offset 35 found          │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

**Time Index (`.timeindex`):** Maps timestamp → offset

Used for queries like "give me all records after timestamp X".

### Inspecting Segments

```bash
# Dump log segment contents
bin/kafka-dump-log.sh \
    --deep-iteration \
    --print-data-log \
    --files /var/lib/kafka/data/topic-0/00000000000000000000.log

# Dump index file
bin/kafka-dump-log.sh \
    --files /var/lib/kafka/data/topic-0/00000000000000000000.index
```

---

## Retention Policies: Delete vs. Compact

Kafka provides two strategies for managing data lifecycle.

### Delete Policy (Time/Size-Based)

The default policy removes entire segments based on time or size:

```
┌────────────────────────────────────────────────────────────────┐
│                    Delete Retention Policy                      │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Configuration:                                                  │
│  cleanup.policy=delete                                          │
│  retention.ms=604800000 (7 days)                                │
│  retention.bytes=-1 (unlimited)                                 │
│                                                                  │
│  Timeline:                                                       │
│                                                                  │
│  Day 1    Day 3    Day 5    Day 7    Day 9    Day 11            │
│    │        │        │        │        │        │                │
│    ▼        ▼        ▼        ▼        ▼        ▼                │
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐                │
│  │Seg0│  │Seg1│  │Seg2│  │Seg3│  │Seg4│  │Seg5│                │
│  └────┘  └────┘  └────┘  └────┘  └────┘  └────┘                │
│                                                                  │
│  On Day 9:                                                       │
│  • Seg0 is > 7 days old → DELETED                               │
│  • Seg1 is > 7 days old → DELETED                               │
│  • Seg2-5 retained                                               │
│                                                                  │
│  ⚠️  Segments deleted as a whole, not individual records        │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### Compact Policy (Key-Based)

Log compaction retains only the latest value for each key:

```
┌────────────────────────────────────────────────────────────────┐
│                    Compact Retention Policy                     │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Configuration:                                                  │
│  cleanup.policy=compact                                          │
│                                                                  │
│  Before Compaction:                                              │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ K1:V1 │ K2:V1 │ K1:V2 │ K3:V1 │ K2:V2 │ K1:V3 │ K3:V2 │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  After Compaction (only latest values kept):                     │
│  ┌────────────────────────────────┐                              │
│  │ K2:V2 │ K1:V3 │ K3:V2 │        │                              │
│  └────────────────────────────────┘                              │
│                                                                  │
│  Use Cases:                                                      │
│  • Database changelog (CDC)                                      │
│  • State snapshots                                               │
│  • Configuration storage                                         │
│  • User profiles / entity state                                  │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### Tombstones: Deleting Keys

To delete a key in a compacted topic, send a record with `value = null` (called a tombstone). Tombstones are retained for `delete.retention.ms` (default 24 hours), then removed during compaction.

### Combined Policy

You can combine both policies with `cleanup.policy=compact,delete`. This compacts the log AND deletes segments older than `retention.ms`.

### Compaction Configuration

| Configuration               | Default  | Description                                |
| --------------------------- | -------- | ------------------------------------------ |
| `min.cleanable.dirty.ratio` | 0.5      | Minimum dirty ratio to trigger compaction  |
| `min.compaction.lag.ms`     | 0        | Minimum age before record can be compacted |
| `max.compaction.lag.ms`     | ∞        | Maximum time record can remain uncompacted |
| `delete.retention.ms`       | 86400000 | How long to retain tombstones              |

---

## Key Takeaways

1. **Kafka is a commit log:** The append-only design enables sequential I/O, simple replication, and time travel capabilities.

2. **Brokers form clusters:** Each broker stores partitions and handles client requests. Any broker can serve as a bootstrap server for cluster discovery.

3. **Topics organize, partitions parallelize:** Topics provide logical grouping; partitions enable horizontal scaling and parallel processing.

4. **Keys determine partition assignment:** Records with the same key always go to the same partition, guaranteeing per-key ordering.

5. **Producers control durability:** The `acks` setting determines the trade-off between throughput and data safety.

6. **Consumer groups enable scaling:** Multiple consumers in a group share the workload, with each partition assigned to exactly one consumer.

7. **Offsets track progress:** Understanding committed offset vs. current position is crucial for debugging consumer issues.

8. **Delivery semantics matter:** At-least-once with idempotent processing is the recommended approach for most applications.

9. **Two retention strategies:** Delete (time/size-based) removes entire segments; Compact (key-based) keeps only the latest value per key.

10. **Partition count is permanent:** You can increase partitions but never decrease them — choose wisely based on throughput and parallelism needs.

---

## References

- [Kafka Documentation: Design](https://kafka.apache.org/documentation/#design)
- [Kafka Topic Internals: Segments and Indexes](https://learn.conduktor.io/kafka/kafka-topics-internals-segments-and-indexes/)
- [Deep Dive into Apache Kafka Storage Internals](https://strimzi.io/blog/2021/12/17/kafka-segment-retention/)
- [Kafka Log Compaction](https://docs.confluent.io/kafka/design/log_compaction.html)
- [The Log: What every software engineer should know](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)
