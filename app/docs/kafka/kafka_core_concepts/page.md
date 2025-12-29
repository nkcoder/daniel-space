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

### The Record Format

Each record in Kafka contains:

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
│  • Offset: Unique, sequential identifier within a partition      │
│  • Timestamp: Event time or ingestion time                       │
│  • Key: Optional; used for partitioning and compaction           │
│  • Value: The actual message payload                             │
│  • Headers: Optional key-value metadata                          │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

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

```scala
// Default partitioner behavior (Kafka 2.4+)
partition =
  if (key == null)
    stickyPartition()  // Batch to same partition, then switch
  else
    murmur2(key) % numPartitions
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
│  Example:                                                        │
│  • Expected throughput: 500 MB/s                                 │
│  • Partition throughput: 50 MB/s                                 │
│  • Expected consumers: 20                                        │
│  • Partitions = max(500/50, 20) = max(10, 20) = 20              │
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

## Storage Internals: Segments and Indexes

Understanding how Kafka stores data on disk is crucial for operations and troubleshooting.

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

Kafka maintains sparse indexes for efficient offset lookup:

**Offset Index (`.index`):** Maps logical offset → physical file position

```
┌────────────────────────────────────────────────────────────────┐
│                   Offset Index (.index)                         │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  .log file (1GB):                                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ offset 0    offset 28   offset 56   offset 84   ...     │    │
│  │ @pos 0      @pos 4169   @pos 8364   @pos 12540  ...     │    │
│  └─────────────────────────────────────────────────────────┘    │
│        │              │           │           │                  │
│        ▼              ▼           ▼           ▼                  │
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

```
┌────────────────────────────────────────────────────────────────┐
│                   Time Index (.timeindex)                       │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  timestamp: 1703318400000  │  offset: 0     │           │    │
│  │  timestamp: 1703318460000  │  offset: 28    │           │    │
│  │  timestamp: 1703318520000  │  offset: 56    │           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Use case: "Give me all records after 2025-12-23 10:00:00"      │
│  1. Binary search timeindex for timestamp                        │
│  2. Get corresponding offset                                     │
│  3. Seek to that offset and read forward                        │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### Inspecting Segments with kafka-dump-log

```bash
# Dump log segment contents
bin/kafka-dump-log.sh \
    --deep-iteration \
    --print-data-log \
    --files /var/lib/kafka/data/orders.payments.completed-0/00000000000000000000.log

# Output:
# baseOffset: 0 lastOffset: 0 count: 1 ...
# | offset: 0 ... key: order-123 payload: {"amount": 99.99}
# baseOffset: 1 lastOffset: 1 count: 1 ...
# | offset: 1 ... key: order-456 payload: {"amount": 149.99}

# Dump index file
bin/kafka-dump-log.sh \
    --files /var/lib/kafka/data/orders.payments.completed-0/00000000000000000000.index

# Dump time index
bin/kafka-dump-log.sh \
    --files /var/lib/kafka/data/orders.payments.completed-0/00000000000000000000.timeindex
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
│     │       │       │       │       │       │       │           │
│     └───────│───────│───────│───────│───────┼───────┘ K1 latest │
│             └───────│───────│───────┼───────┘         K2 latest │
│                     │       └───────┘                 K3 latest │
│                     │                                            │
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

To delete a key in a compacted topic, send a record with `value = null`:

```scala
// Send a tombstone to delete key "user-123"
val tombstone = new ProducerRecord[String, String](
  "users.profiles",  // topic
  "user-123",        // key
  null               // null value = tombstone
)
producer.send(tombstone)
```

Tombstones are retained for `delete.retention.ms` (default 24 hours) to allow consumers to see the deletion, then removed during compaction.

### Combined Policy: compact,delete

You can combine both policies:

```bash
# Create topic with combined policy
bin/kafka-topics.sh --bootstrap-server localhost:9092 \
    --create \
    --topic users.events \
    --config cleanup.policy=compact,delete \
    --config retention.ms=604800000 \
    --config min.compaction.lag.ms=3600000
```

This compacts the log AND deletes segments older than `retention.ms`.

### Compaction Configuration

| Configuration               | Default  | Description                                |
| --------------------------- | -------- | ------------------------------------------ |
| `min.cleanable.dirty.ratio` | 0.5      | Minimum dirty ratio to trigger compaction  |
| `min.compaction.lag.ms`     | 0        | Minimum age before record can be compacted |
| `max.compaction.lag.ms`     | ∞        | Maximum time record can remain uncompacted |
| `delete.retention.ms`       | 86400000 | How long to retain tombstones              |
| `log.cleaner.threads`       | 1        | Number of cleaner threads                  |

---

## Offsets and Consumer Position

An **offset** is a unique, sequential identifier for each record within a partition.

### Offset Semantics

```
┌────────────────────────────────────────────────────────────────┐
│                    Offset Management                            │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Partition 0:                                                    │
│                                                                  │
│  Offset:    0   1   2   3   4   5   6   7   8   9    10
│           ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐             │
│  Records: │ A │ B │ C │ D │ E │ F │ G │ H │ I │ J │             │
│           └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘             │
│             ▲                   ▲           ▲        ▲            │
│             │                   │           │        │            │
│      Log Start              Committed     Current  Log End     │
│      Offset (LSO)           Offset        Position Offset      │
│                                                      (LEO)       │
│                                                                  │
│  Key Offsets:                                                    │
│  • Log Start Offset: Earliest available (0, unless truncated)   │
│  • Committed Offset: Last offset consumer has committed (5)     │
│  • Current Position: Where consumer will read next (8)          │
│  • Log End Offset: Next offset to be written (10)               │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### Consumer Read Behavior

Kafka consumers use the **pull model** to read data, meaning they request data from the broker when they are ready to process it, rather than being pushed data by the broker.

A consumer always reads data from a lower offset to a higher offset and cannot read data backwards. By default, consumers will only consume data that was produced after they first connected to Kafka. However, they can be configured to read from the beginning of the topic or from a specific offset.

### Auto Offset Reset

When a consumer starts with no committed offset, `auto.offset.reset` determines where to begin:

```scala
// Start from the earliest available record
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest")

// Start from the end (only new records)
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "latest")

// Throw exception if no offset found
props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "none")
```

### The `__consumer_offsets` Topic

Consumer group offsets are stored in an internal topic:

```
┌────────────────────────────────────────────────────────────────┐
│                   __consumer_offsets Topic                      │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Key: [group_id, topic, partition]                              │
│  Value: [offset, metadata, timestamp]                            │
│                                                                  │
│  Example Records:                                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Key: [payment-service, orders.completed, 0]              │   │
│  │ Value: {offset: 1523, metadata: "", timestamp: ...}      │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ Key: [payment-service, orders.completed, 1]              │   │
│  │ Value: {offset: 892, metadata: "", timestamp: ...}       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Default: 50 partitions, compacted                               │
│  Partition assignment: hash(group_id) % 50                       │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

### Manual Offset Management in Scala

```scala
package com.example.kafka

import org.apache.kafka.clients.consumer.*
import org.apache.kafka.common.TopicPartition
import scala.jdk.CollectionConverters.*
import java.time.Duration
import java.util.Properties

object ManualOffsetManagement:

  def consumeWithManualCommit(
      props: Properties,
      topic: String
  ): Unit =
    val consumer = KafkaConsumer[String, String](props)
    consumer.subscribe(List(topic).asJava)

    try
      while true do
        val records = consumer.poll(Duration.ofMillis(1000))

        // Process each partition's records
        for partition <- records.partitions.asScala do
          val partitionRecords = records.records(partition).asScala

          for record <- partitionRecords do
            // Process record
            println(s"Processing: ${record.key} -> ${record.value}")

          // Commit offset for this partition only
          val lastOffset = partitionRecords.last.offset
          val commitOffset = OffsetAndMetadata(lastOffset + 1)
          consumer.commitSync(Map(partition -> commitOffset).asJava)
    finally
      consumer.close()

  /** Seek to specific offset */
  def seekToOffset(
      consumer: KafkaConsumer[String, String],
      topic: String,
      partition: Int,
      offset: Long
  ): Unit =
    val tp = TopicPartition(topic, partition)
    consumer.assign(List(tp).asJava)
    consumer.seek(tp, offset)

  /** Seek to timestamp */
  def seekToTimestamp(
      consumer: KafkaConsumer[String, String],
      topic: String,
      partition: Int,
      timestamp: Long
  ): Unit =
    val tp = TopicPartition(topic, partition)
    consumer.assign(List(tp).asJava)

    val timestampsToSearch = Map(tp -> java.lang.Long.valueOf(timestamp)).asJava
    val offsetsForTimes = consumer.offsetsForTimes(timestampsToSearch)

    Option(offsetsForTimes.get(tp)).foreach { offsetAndTimestamp =>
      consumer.seek(tp, offsetAndTimestamp.offset)
    }

  /** Get current lag for consumer group */
  def getConsumerLag(
      consumer: KafkaConsumer[String, String],
      topic: String
  ): Map[TopicPartition, Long] =
    val partitions = consumer.partitionsFor(topic).asScala
      .map(pi => TopicPartition(topic, pi.partition))
      .toList

    consumer.assign(partitions.asJava)
    consumer.seekToEnd(partitions.asJava)

    val endOffsets = partitions.map(tp => tp -> consumer.position(tp)).toMap

    consumer.seekToBeginning(partitions.asJava)
    val committed = consumer.committed(partitions.toSet.asJava).asScala

    partitions.map { tp =>
      val end = endOffsets(tp)
      val current = Option(committed.get(tp)).flatten.map(_.offset).getOrElse(0L)
      tp -> (end - current)
    }.toMap
```

### Consumer Groups

A consumer group is a group of consumers that work together to consume messages from one or more topics. Each consumer in the group reads from a unique set of partitions, allowing for parallel processing of messages:

- All consumers in a group share the same `group.id`
- A consumer can consume from multiple partitions, but each partition can only be consumed by one consumer in the group at a time
- If a consumer fails or is removed from the group, Kafka will rebalance and assign its partitions to other consumers in the group
- If there are more consumers than partitions, some consumers will be idle and not receive any messages

### Delivery Semantics

**At-Most-Once:**

- Offsets are committed as soon as the message is received
- If processing fails, the message is lost (it won't be read again)

**At-Least-Once (usually preferred):**

- Offsets are committed after the message is processed
- If processing fails, the message will be read again (may be processed multiple times)
- Requires idempotent processing to handle duplicates

**Exactly-Once:**

- Achievable for Kafka-to-Kafka workflows using the transactional API
- For Kafka-to-external-system workflows, use an idempotent consumer

In practice, **at-least-once with idempotent processing** is the most desirable and widely used delivery semantics.

---

## Brokers and Cluster Architecture

A single Kafka server is called a **Kafka broker**. An ensemble of Kafka brokers working together is called a **Kafka cluster**. Each broker in a cluster is identified by a unique numeric ID.

If there are multiple brokers in a cluster, partitions for a given topic will be distributed among the brokers evenly to achieve load balancing and scalability.

### Bootstrap Servers

Every broker in the cluster has metadata about all other brokers:

- Any broker in the cluster is also called a **bootstrap server**
- A client can connect to any broker to get metadata about the entire cluster
- In practice, it is common for Kafka clients to connect to multiple bootstrap servers to ensure high availability and fault tolerance

```scala
// Connecting to multiple bootstrap servers for fault tolerance
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG,
  "broker1:9092,broker2:9092,broker3:9092")
```

---

## Practical Example: Custom Partitioner

Let's implement a custom partitioner that routes records based on priority:

### PriorityPartitioner.scala

```scala
package com.example.kafka.partitioner

import org.apache.kafka.clients.producer.Partitioner
import org.apache.kafka.common.Cluster
import org.apache.kafka.common.utils.Utils
import java.util.Map as JMap
import scala.util.Try

/**
 * Custom partitioner that routes high-priority messages to dedicated partitions.
 *
 * Configuration:
 *   priority.partitioner.high.priority.partitions=2  (first N partitions for high priority)
 *
 * Key format: "priority:actual-key" where priority is "high" or "normal"
 * Example: "high:order-123" or "normal:order-456"
 */
class PriorityPartitioner extends Partitioner:

  private var highPriorityPartitions: Int = 2

  override def configure(configs: JMap[String, ?]): Unit =
    highPriorityPartitions = Try(
      configs.get("priority.partitioner.high.priority.partitions")
        .asInstanceOf[String].toInt
    ).getOrElse(2)

  override def partition(
      topic: String,
      key: Any,
      keyBytes: Array[Byte],
      value: Any,
      valueBytes: Array[Byte],
      cluster: Cluster
  ): Int =
    val partitionCount = cluster.partitionCountForTopic(topic)

    if keyBytes == null then
      // No key: round-robin across all partitions
      Utils.toPositive(Utils.murmur2(valueBytes)) % partitionCount
    else
      val keyString = new String(keyBytes, "UTF-8")
      val (priority, actualKey) = parseKey(keyString)

      if priority == "high" then
        // High priority: route to first N partitions
        val highPriorityCount = math.min(highPriorityPartitions, partitionCount)
        Utils.toPositive(Utils.murmur2(actualKey.getBytes)) % highPriorityCount
      else
        // Normal priority: route to remaining partitions
        val normalPartitionCount = partitionCount - highPriorityPartitions
        if normalPartitionCount <= 0 then
          // Fallback if not enough partitions
          Utils.toPositive(Utils.murmur2(actualKey.getBytes)) % partitionCount
        else
          highPriorityPartitions +
            (Utils.toPositive(Utils.murmur2(actualKey.getBytes)) % normalPartitionCount)

  private def parseKey(key: String): (String, String) =
    val colonIndex = key.indexOf(':')
    if colonIndex > 0 then
      (key.substring(0, colonIndex).toLowerCase, key.substring(colonIndex + 1))
    else
      ("normal", key)

  override def close(): Unit = ()
```

### Using the Custom Partitioner

```scala
package com.example.kafka

import org.apache.kafka.clients.producer.*
import java.util.Properties

object PriorityProducerExample:

  def main(args: Array[String]): Unit =
    val props = Properties()
    props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092")
    props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG,
      "org.apache.kafka.common.serialization.StringSerializer")
    props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG,
      "org.apache.kafka.common.serialization.StringSerializer")

    // Use custom partitioner
    props.put(ProducerConfig.PARTITIONER_CLASS_CONFIG,
      "com.example.kafka.partitioner.PriorityPartitioner")
    props.put("priority.partitioner.high.priority.partitions", "2")

    val producer = KafkaProducer[String, String](props)

    // High priority orders go to partitions 0-1
    val highPriorityOrder = ProducerRecord[String, String](
      "orders",
      "high:order-123",  // priority:key format
      """{"orderId": "123", "amount": 10000, "priority": "high"}"""
    )

    // Normal orders go to partitions 2+
    val normalOrder = ProducerRecord[String, String](
      "orders",
      "normal:order-456",
      """{"orderId": "456", "amount": 50, "priority": "normal"}"""
    )

    producer.send(highPriorityOrder).get()
    producer.send(normalOrder).get()

    println("Sent priority-routed orders!")
    producer.close()
```

### Creating the Topic

```bash
# Create topic with 6 partitions
# Partitions 0-1: high priority
# Partitions 2-5: normal priority
bin/kafka-topics.sh --bootstrap-server localhost:9092 \
    --create \
    --topic orders \
    --partitions 6 \
    --replication-factor 3
```

---

## Key Takeaways

1. **Kafka is a commit log:** The append-only design enables sequential I/O, simple replication, and time travel capabilities.

2. **Topics organize, partitions parallelize:** Topics provide logical grouping; partitions enable horizontal scaling and parallel processing.

3. **Keys determine partition assignment:** Records with the same key always go to the same partition, guaranteeing per-key ordering.

4. **Segments are the storage unit:** Each partition is divided into segments with index files for fast offset and timestamp lookups.

5. **Two retention strategies:** Delete (time/size-based) removes entire segments; Compact (key-based) keeps only the latest value per key.

6. **Offsets are consumer position:** Understanding log start offset, committed offset, and log end offset is crucial for debugging consumer issues.

7. **Partition count is permanent:** You can increase partitions but never decrease them — choose wisely based on throughput and parallelism needs.

## References

- [Kafka Documentation: Design](https://kafka.apache.org/documentation/#design)
- [Kafka Topic Internals: Segments and Indexes](https://learn.conduktor.io/kafka/kafka-topics-internals-segments-and-indexes/)
- [Deep Dive into Apache Kafka Storage Internals](https://strimzi.io/blog/2021/12/17/kafka-segment-retention/)
- [Kafka Log Compaction](https://docs.confluent.io/kafka/design/log_compaction.html)
- [The Log: What every software engineer should know](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)
