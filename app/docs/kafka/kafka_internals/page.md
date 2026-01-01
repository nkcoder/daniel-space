---
title: Kafka Internals
description: Understanding Kafka's internals including storage architecture, indexes, and KRaft.
---

# Kafka Internals

Understanding Kafka's internals transforms you from a user into an operator capable of tuning, troubleshooting, and optimizing clusters. This post explores how Kafka stores data on disk, locates messages efficiently, and manages cluster metadata with KRaft.

## Storage Architecture Overview

Kafka's storage model is elegantly simple: append-only logs organized hierarchically.

```
/var/kafka-logs/                         # log.dirs
├── __consumer_offsets-0/                # Internal topic (created lazily)
├── __consumer_offsets-1/                # Only appears after first commit
├── orders-0/                            # Topic partition directory
│   ├── 00000000000000000000.log         # Segment file (data)
│   ├── 00000000000000000000.index       # Offset index
│   ├── 00000000000000000000.timeindex   # Timestamp index
│   ├── 00000000000000512000.log         # Next segment
│   ├── 00000000000000512000.index
│   ├── 00000000000000512000.timeindex
│   └── leader-epoch-checkpoint          # Leader epoch tracking
├── orders-1/
└── orders-2/
```

**Key insight**: The partition is the unit of parallelism, but the **segment** is the unit of storage.

> **Note**: The `__consumer_offsets` topic is created **lazily**—it only appears after a consumer group commits its first offset. If you've only been producing messages, you won't see it. Similarly, `__cluster_metadata` only exists in KRaft mode clusters.

## Log Segments: The Building Blocks

A partition isn't a single file—it's a sequence of segments. This design enables efficient retention, compaction, and concurrent read/write operations.

### Segment Files

Each segment consists of three files sharing a base name (the first offset in the segment):

| File         | Purpose                        | Entry Size |
| ------------ | ------------------------------ | ---------- |
| `.log`       | Actual record batches          | Variable   |
| `.index`     | Offset → file position mapping | 8 bytes    |
| `.timeindex` | Timestamp → offset mapping     | 12 bytes   |

### Segment Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                      Partition: orders-0                         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Segment 0   │  │ Segment 512K │  │ Segment 1M   │           │
│  │   (closed)   │  │   (closed)   │  │   (ACTIVE)   │           │
│  │              │  │              │  │              │           │
│  │ Offsets:     │  │ Offsets:     │  │ Offsets:     │           │
│  │ 0 - 511,999  │  │ 512K - 1M-1  │  │ 1M - current │ ← writes  │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│        │                 │                                       │
│        └─────────────────┴── eligible for deletion/compaction    │
└─────────────────────────────────────────────────────────────────┘
```

Only the **active segment** receives writes. Closed segments are immutable and can be:

- Read by consumers
- Deleted based on retention policy
- Compacted (if cleanup policy is `compact`)

### Segment Rolling Conditions

A new segment is created when any condition is met:

| Condition          | Configuration              | Default |
| ------------------ | -------------------------- | ------- |
| Size limit reached | `log.segment.bytes`        | 1 GB    |
| Time limit elapsed | `log.segment.ms`           | 7 days  |
| Index full         | `log.index.size.max.bytes` | 10 MB   |

```scala
// Topic-level override for smaller segments
kafka-configs.sh --alter \
  --entity-type topics \
  --entity-name events \
  --add-config segment.bytes=104857600  // 100 MB
```

## Index Files: Fast Message Lookup

Kafka doesn't scan entire log files to find messages. Index files provide efficient O(log n) lookups.

### Offset Index (.index)

Maps logical offsets to physical file positions:

```
┌──────────────────────────────────────────────┐
│              00000000000000000000.index       │
├────────────────────┬─────────────────────────┤
│  Relative Offset   │   Physical Position     │
├────────────────────┼─────────────────────────┤
│         0          │           0             │
│        20          │         4096            │
│        41          │         8192            │
│        63          │        12288            │
│        ...         │          ...            │
└────────────────────┴─────────────────────────┘
```

**Sparse indexing**: Not every offset is indexed. By default, an entry is added every `log.index.interval.bytes` (4096 bytes). This balances index size against lookup precision.

### Finding Offset 50: The Complete Process

A partition has **multiple segments**, each with its own `.log` and `.index` files. You need to first identify **which segment** contains your target offset, then use that segment's index.

The key insight: segment file names **are** the base offsets:

```
orders-0/
├── 00000000000000000000.log      # Contains offsets 0 - 511,999
├── 00000000000000000000.index
├── 00000000000000512000.log      # Contains offsets 512,000 - 1,023,999
├── 00000000000000512000.index
├── 00000000000001024000.log      # Contains offsets 1,024,000 - ...
├── 00000000000001024000.index
```

**Step 1: Which segment contains offset 50?**

```
Binary search segment base offsets: [0, 512000, 1024000, ...]
Find largest base offset ≤ 50 → Segment 0

Now we know to use: 00000000000000000000.log
                    00000000000000000000.index
```

**Step 2: Where in that segment?**

```
Binary search 00000000000000000000.index:
┌────────────────────┬─────────────────────────┐
│  Relative Offset   │   Physical Position     │
├────────────────────┼─────────────────────────┤
│         0          │           0             │
│        20          │         4096            │
│        41          │         8192   ◄── largest ≤ 50
│        63          │        12288            │
└────────────────────┴─────────────────────────┘

Result: Start at position 8192
```

**Step 3: Sequential scan**

```
Read from position 8192 in 00000000000000000000.log
Scan records at offsets 41, 42, 43... until we find offset 50
```

**Why can't we skip Step 1?** Each segment has its own index file. The index in segment 0 knows nothing about offsets in segment 512000. Think of it like an encyclopedia: you must first find the right volume before using that volume's index.

### Time Index (.timeindex)

Maps timestamps to offsets for time-based seeks:

```
┌──────────────────────────────────────────────┐
│           00000000000000000000.timeindex     │
├─────────────────────┬────────────────────────┤
│     Timestamp       │   Offset               │
├─────────────────────┼────────────────────────┤
│  1638100314372      │     28                 │
│  1638100454372      │     56                 │
│  1638100594372      │     84                 │
└─────────────────────┴────────────────────────┘
```

**Why offset instead of file position?** You might wonder why `.timeindex` doesn't store positions directly like `.index` does. The indirection is intentional:

1. **Offsets are stable; positions aren't**: File positions can shift during log compaction or segment rewrites. Offsets never change for a given record. Storing offsets means `.timeindex` remains valid even when physical layout changes.

2. **Reuses existing infrastructure**: The offset→position mapping already exists in `.index`. No need to duplicate position tracking.

3. **Offset is Kafka's universal identifier**: Consumers, replication, and transactions all speak "offset." By converting timestamp→offset first, the rest of the system works unchanged.

4. **Negligible performance cost**: Two binary searches on memory-mapped files (O(log n) + O(log n)) takes nanoseconds.

### Timestamp Lookup Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  "Find records from timestamp 1638100400000"                    │
│                                                                 │
│  Step 1: Binary search .timeindex                               │
│  ┌─────────────────────────────────────┐                        │
│  │ 1638100314372 → offset 28           │                        │
│  │ 1638100454372 → offset 56  ◄── closest ≤ target              │
│  │ 1638100594372 → offset 84           │                        │
│  └─────────────────────────────────────┘                        │
│                          │                                      │
│                          ▼                                      │
│  Step 2: Binary search .index (with offset 56)                  │
│  ┌─────────────────────────────────────┐                        │
│  │ offset 41 → position 8192  ◄── closest ≤ 56                  │
│  │ offset 63 → position 12288          │                        │
│  └─────────────────────────────────────┘                        │
│                          │                                      │
│                          ▼                                      │
│  Step 3: Sequential scan .log from position 8192                │
└─────────────────────────────────────────────────────────────────┘
```

This enables `consumer.offsetsForTimes()` to find where to start consuming from a specific point in time.

## Who Performs These Lookups?

A common misconception: consumers and followers don't search indexes directly. **The broker performs all segment/index lookups.** Clients only communicate via network requests.

### Fetch by Offset (Normal Consumption)

```
┌──────────────┐                              ┌──────────────┐
│   Consumer   │                              │    Broker    │
└──────┬───────┘                              └──────┬───────┘
       │                                             │
       │  FetchRequest(topic, partition, offset=50)  │
       │────────────────────────────────────────────►│
       │                                             │
       │                                   ┌─────────┴─────────┐
       │                                   │ 1. Find segment   │
       │                                   │ 2. Search .index  │
       │                                   │ 3. Scan .log      │
       │                                   └─────────┬─────────┘
       │                                             │
       │◄────────────────────────────────────────────│
       │  FetchResponse(records[50, 51, 52, ...])    │
```

The consumer simply says "give me records starting at offset 50." It has no idea about segments or indexes.

### Seek by Timestamp

```
┌──────────────┐                              ┌──────────────┐
│   Consumer   │                              │    Broker    │
└──────┬───────┘                              └──────┬───────┘
       │                                             │
       │  ListOffsetsRequest(timestamp=1638100400)   │
       │────────────────────────────────────────────►│
       │                                   ┌─────────┴─────────┐
       │                                   │ Search .timeindex │
       │                                   └─────────┬─────────┘
       │◄────────────────────────────────────────────│
       │  ListOffsetsResponse(offset=56)             │
       │                                             │
       │  FetchRequest(offset=56)                    │
       │────────────────────────────────────────────►│
```

Two-phase: consumer asks for the offset, then fetches from it.

### Replication

Follower brokers use the **same FetchRequest API** as consumers. The leader broker performs identical lookups—replication is just another fetch client.

| Operation           | Who Initiates   | Who Does Lookup | API Used           |
| ------------------- | --------------- | --------------- | ------------------ |
| Normal fetch        | Consumer        | Broker          | FetchRequest       |
| Seek by timestamp   | Consumer        | Broker          | ListOffsetsRequest |
| Replication         | Follower broker | Leader broker   | FetchRequest       |
| `auto.offset.reset` | Consumer        | Broker          | ListOffsetsRequest |

This design provides security (no file system access needed), abstraction (clients don't care about storage internals), and flexibility (storage format can evolve without breaking clients).

### Replication Fetch Loop

Since replication uses the same FetchRequest API, here's how followers stay in sync:

```
Follower                              Leader
   │                                     │
   │──FetchRequest(offset=1000)─────────►│
   │                                     │ (lookup in .index/.log)
   │◄──FetchResponse(records, HW=1050)───│
   │                                     │
   │  (append records to local .log)     │
   │  (update local high watermark)      │
   │                                     │
   │──FetchRequest(offset=1050)─────────►│
   │                                     │
   │◄──FetchResponse(records, HW=1100)───│
   │              ...                    │
```

The follower continuously fetches, appends to its own segments, and updates its high watermark. This is why followers have identical segment/index file structures to the leader. We'll explore ISR management, leader election, and durability guarantees in depth in the next post.

## Record Batch Format (Magic v2)

Since Kafka 0.11, records are organized in batches with a standardized binary format:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Record Batch Header (61 bytes)              │
├─────────────────────────────────────────────────────────────────┤
│ baseOffset (8)        │ First offset in batch                   │
│ batchLength (4)       │ Total batch size                        │
│ partitionLeaderEpoch  │ Leader epoch for fencing                │
│ magic (1)             │ Format version (2)                      │
│ crc (4)               │ Checksum of attributes → records        │
│ attributes (2)        │ Compression, timestamp type, txn flags  │
│ lastOffsetDelta (4)   │ Offset of last record relative to base  │
│ firstTimestamp (8)    │ Timestamp of first record               │
│ maxTimestamp (8)      │ Max timestamp in batch                  │
│ producerId (8)        │ For idempotence/transactions            │
│ producerEpoch (2)     │ Producer epoch                          │
│ baseSequence (4)      │ Sequence number for deduplication       │
│ recordCount (4)       │ Number of records in batch              │
├─────────────────────────────────────────────────────────────────┤
│                      Records (compressed)                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Record 0: length, attrs, timestampDelta, offsetDelta,   │    │
│  │           keyLen, key, valueLen, value, headers         │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │ Record 1: ...                                           │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │ Record N: ...                                           │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Compression at Batch Level

Compression applies to the records portion, not the header. This is why larger batches compress better—more data for the algorithm to find patterns.

```
Attributes bits 0-2 encode compression:
  0 = none
  1 = gzip
  2 = snappy
  3 = lz4
  4 = zstd
```

The batch header remains uncompressed so brokers can route and validate without decompression.

## Log Retention & Cleanup

### Delete Policy

```
# Time-based (default: 7 days)
log.retention.hours=168

# Size-based (default: unlimited)
log.retention.bytes=-1

# Minimum compaction lag
log.cleaner.min.compaction.lag.ms=0
```

**Important**: Retention applies to **closed segments only**. An active segment is never deleted, even if it exceeds retention time.

### Compact Policy

For topics with `cleanup.policy=compact`, Kafka keeps only the latest value per key:

```
Before compaction:          After compaction:
┌─────────────────────┐     ┌─────────────────────┐
│ K1:V1 (offset 0)    │     │                     │
│ K2:V1 (offset 1)    │     │                     │
│ K1:V2 (offset 2)    │     │ K2:V2 (offset 3)    │
│ K2:V2 (offset 3)    │ ──→ │ K1:V3 (offset 4)    │
│ K1:V3 (offset 4)    │     │ K3:V1 (offset 5)    │
│ K3:V1 (offset 5)    │     │                     │
└─────────────────────┘     └─────────────────────┘
```

**Tombstones**: Setting a key's value to `null` marks it for deletion after `delete.retention.ms`.

## KRaft: Kafka's Native Metadata Management

KRaft (Kafka Raft) replaces ZooKeeper with a built-in consensus protocol. Since Kafka 4.0, ZooKeeper mode is deprecated—KRaft is the path forward.

### Architecture Comparison

```
ZooKeeper Mode (Legacy)              KRaft Mode (Kafka 4.x)
┌─────────────────────────┐         ┌─────────────────────────┐
│     ZooKeeper Cluster   │         │   Controller Quorum     │
│  ┌─────┐┌─────┐┌─────┐  │         │  ┌─────┐┌─────┐┌─────┐  │
│  │ ZK1 ││ ZK2 ││ ZK3 │  │         │  │ C1  ││ C2  ││ C3  │  │
│  └──┬──┘└──┬──┘└──┬──┘  │         │  │(act)││(stby)│(stby)│  │
│     │      │      │     │         │  └──┬──┘└──┬──┘└──┬──┘  │
└─────┼──────┼──────┼─────┘         │     │      │      │     │
      │      │      │               │     └──────┴──────┘     │
      ▼      ▼      ▼               │    __cluster_metadata   │
┌─────────────────────────┐         └───────────┬─────────────┘
│    Kafka Brokers        │                     │
│  ┌─────┐┌─────┐┌─────┐  │         ┌───────────▼─────────────┐
│  │ B1  ││ B2  ││ B3  │  │         │    Kafka Brokers        │
│  │(ctr)││     ││     │  │         │  ┌─────┐┌─────┐┌─────┐  │
│  └─────┘└─────┘└─────┘  │         │  │ B1  ││ B2  ││ B3  │  │
└─────────────────────────┘         │  │(obs)││(obs)││(obs)│  │
                                    │  └─────┘└─────┘└─────┘  │
                                    └─────────────────────────┘
```

### The `__cluster_metadata` Topic

All cluster metadata lives in a single-partition internal topic:

- Topic configurations
- Partition assignments
- Broker registrations
- ACLs and quotas
- Feature flags

This log is replicated across controller nodes using the Raft protocol.

### Controller Roles

| Role       | `process.roles`     | Responsibility                       |
| ---------- | ------------------- | ------------------------------------ |
| Controller | `controller`        | Metadata management, leader election |
| Broker     | `broker`            | Handle client requests, store data   |
| Combined   | `controller,broker` | Both (dev/test only)                 |

### Why KRaft is Better

| Aspect                        | ZooKeeper                 | KRaft                    |
| ----------------------------- | ------------------------- | ------------------------ |
| Controller failover           | Load state from ZK (slow) | Already in memory (fast) |
| Metadata propagation          | RPCs to each broker       | Event log replication    |
| Partition limit               | ~200K practical limit     | Millions supported       |
| Operational complexity        | Two systems to manage     | Single system            |
| Recovery time (2M partitions) | Minutes                   | Seconds                  |

### Configuring KRaft

**Controller node:**

```properties
process.roles=controller
node.id=1
controller.quorum.voters=1@controller1:9093,2@controller2:9093,3@controller3:9093
controller.listener.names=CONTROLLER
listeners=CONTROLLER://controller1:9093
```

**Broker node:**

```properties
process.roles=broker
node.id=101
controller.quorum.voters=1@controller1:9093,2@controller2:9093,3@controller3:9093
listeners=PLAINTEXT://broker1:9092
```

### Dynamic Quorum (KIP-853, Kafka 3.9+)

Controllers can now be added/removed without restart:

```bash
# Add a new controller
kafka-metadata-quorum.sh --bootstrap-server localhost:9092 \
  add-controller --controller-id 4 --controller-directory-id <uuid>

# Remove a controller
kafka-metadata-quorum.sh --bootstrap-server localhost:9092 \
  remove-controller --controller-id 3 --controller-directory-id <uuid>
```

## Performance Optimizations

### Zero-Copy Transfer

Kafka uses `sendfile()` to transfer data directly from page cache to network socket, bypassing user space:

```
Traditional:                    Zero-Copy:
Disk → Kernel Buffer            Disk → Page Cache
Kernel Buffer → User Buffer          ↓
User Buffer → Socket Buffer     Page Cache → NIC
Socket Buffer → NIC
     (4 copies)                      (0 user-space copies)
```

### Page Cache Utilization

Kafka relies heavily on the OS page cache rather than managing its own cache:

- Writes go to page cache, then async flush to disk
- Reads served from page cache if data is recent
- JVM heap stays small, avoiding GC pauses

**Operational tip**: Monitor page cache hit rates. Consumers reading recent data should see minimal disk I/O.

### Sequential I/O

Append-only writes and sequential reads maximize disk throughput:

- HDDs: 100+ MB/s sequential vs <1 MB/s random
- SSDs: Still significant difference due to reduced seeks

## Monitoring Storage Health

### Key Metrics

| Metric                      | Meaning                     | Warning Sign                   |
| --------------------------- | --------------------------- | ------------------------------ |
| `LogEndOffset`              | Latest offset in partition  | Stalled = no writes            |
| `LogStartOffset`            | Earliest available offset   | Jumping = aggressive retention |
| `Size`                      | Partition size on disk      | Unexpected growth              |
| `NumLogSegments`            | Segment count per partition | Too many = small segments      |
| `UnderReplicatedPartitions` | Partitions below ISR        | > 0 = replication issues       |

### Useful Commands

```bash
# Describe log segments
kafka-log-dirs.sh --describe \
  --bootstrap-server localhost:9092 \
  --topic-list orders

# Dump segment contents
kafka-dump-log.sh --deep-iteration --print-data-log \
  --files /var/kafka-logs/orders-0/00000000000000000000.log

# Check KRaft quorum status
kafka-metadata-quorum.sh --bootstrap-server localhost:9092 \
  describe --status
```

## Best Practices Summary

1. **Size segments appropriately**: Default 1GB works for most cases; smaller for low-volume topics needing faster compaction

2. **Monitor disk usage**: Set alerts for partition size growth and ensure retention matches capacity

3. **Use KRaft for new clusters**: ZooKeeper is deprecated; migrate existing clusters proactively

4. **Deploy 3 or 5 controllers**: Odd numbers for quorum; more than 5 rarely needed

5. **Separate controller and broker roles** in production for isolation

6. **Tune `log.index.interval.bytes`** only if you have specific lookup latency requirements

7. **Enable compression** at producer level for network and storage savings

8. **Leave page cache management to the OS**: Don't over-allocate JVM heap

9. **Use SSDs for `__cluster_metadata`** log directory for faster controller operations

10. **Monitor under-replicated partitions** as a primary health indicator

## Further Reading

- [Apache Kafka® Internal Architecture](https://developer.confluent.io/courses/architecture/get-started/)
- [Kafka Implementation](https://kafka.apache.org/41/implementation/)
