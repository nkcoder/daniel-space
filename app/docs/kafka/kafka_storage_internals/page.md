---
title: Kafka Storage Internals
description: Understanding Kafka's storage architecture, segments, indexes, and lookups.
date: 2026-01-01
---

# Kafka Storage Architecture

Understanding Kafka's storage internals transforms you from a user into an operator capable of tuning, troubleshooting, and optimizing clusters. This post explores how Kafka stores data on disk and locates messages efficiently.

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

> **Note**: The `__consumer_offsets` topic is created **lazily**—it only appears after a consumer group commits its first offset. Similarly, `__cluster_metadata` only exists in KRaft mode clusters.

---

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
- Compacted (if cleanup policy includes `compact`)

### Segment Rolling Conditions

A new segment is created when any condition is met:

| Condition          | Configuration              | Default |
| ------------------ | -------------------------- | ------- |
| Size limit reached | `log.segment.bytes`        | 1 GB    |
| Time limit elapsed | `log.segment.ms`           | 7 days  |
| Index full         | `log.index.size.max.bytes` | 10 MB   |

```bash
# Topic-level override for smaller segments
kafka-configs.sh --alter \
  --entity-type topics \
  --entity-name events \
  --add-config segment.bytes=104857600  # 100 MB
```

---

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

**Why offset instead of file position?** You might wonder why `.timeindex` doesn't store positions directly. The indirection is intentional:

1. **Offsets are stable; positions aren't**: File positions can shift during log compaction. Offsets never change for a given record.

2. **Reuses existing infrastructure**: The offset→position mapping already exists in `.index`. No need to duplicate position tracking.

3. **Offset is Kafka's universal identifier**: Consumers, replication, and transactions all speak "offset." By converting timestamp→offset first, the rest of the system works unchanged.

4. **Negligible performance cost**: Two binary searches on memory-mapped files takes nanoseconds.

### Timestamp Lookup Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  "Find records from timestamp 1638100400000"                    │
│                                                                 │
│  Step 1: Binary search .timeindex                               │
│  ┌─────────────────────────────────────────┐                    │
│  │ 1638100314372 → offset 28               │                    │
│  │ 1638100454372 → offset 56  ◄── closest ≤ target              │
│  │ 1638100594372 → offset 84               │                    │
│  └─────────────────────────────────────────┘                    │
│                          │                                      │
│                          ▼                                      │
│  Step 2: Binary search .index (with offset 56)                  │
│  ┌─────────────────────────────────────────┐                    │
│  │ offset 41 → position 8192  ◄── closest ≤ 56                  │
│  │ offset 63 → position 12288              │                    │
│  └─────────────────────────────────────────┘                    │
│                          │                                      │
│                          ▼                                      │
│  Step 3: Sequential scan .log from position 8192                │
└─────────────────────────────────────────────────────────────────┘
```

This enables `consumer.offsetsForTimes()` to find where to start consuming from a specific point in time.

---

## Who Performs These Lookups?

A common misconception: consumers don't search indexes directly. **The broker performs all segment/index lookups.** Clients only communicate via network requests.

### Fetch by Offset (Normal Consumption)

```
Consumer                                      Broker
    │                                            │
    │  FetchRequest(topic, partition, offset=50) │
    │───────────────────────────────────────────►│
    │                                            │
    │                                  ┌─────────┴─────────┐
    │                                  │ 1. Find segment   │
    │                                  │ 2. Search .index  │
    │                                  │ 3. Scan .log      │
    │                                  └─────────┬─────────┘
    │                                            │
    │◄───────────────────────────────────────────│
    │  FetchResponse(records[50, 51, 52, ...])   │
```

The consumer simply says "give me records starting at offset 50." It has no idea about segments or indexes.

### Seek by Timestamp

```
Consumer                                      Broker
    │                                            │
    │  ListOffsetsRequest(timestamp=1638100400)  │
    │───────────────────────────────────────────►│
    │                                  ┌─────────┴─────────┐
    │                                  │ Search .timeindex │
    │                                  └─────────┬─────────┘
    │◄───────────────────────────────────────────│
    │  ListOffsetsResponse(offset=56)            │
    │                                            │
    │  FetchRequest(offset=56)                   │
    │───────────────────────────────────────────►│
```

Two-phase: consumer asks for the offset, then fetches from it.

### Replication Uses the Same API

Follower brokers use the **same FetchRequest API** as consumers. The leader broker performs identical lookups—replication is just another fetch client.

| Operation           | Who Initiates   | Who Does Lookup | API Used           |
| ------------------- | --------------- | --------------- | ------------------ |
| Normal fetch        | Consumer        | Broker          | FetchRequest       |
| Seek by timestamp   | Consumer        | Broker          | ListOffsetsRequest |
| Replication         | Follower broker | Leader broker   | FetchRequest       |
| `auto.offset.reset` | Consumer        | Broker          | ListOffsetsRequest |

This design provides security (no file system access needed), abstraction (clients don't care about storage internals), and flexibility (storage format can evolve without breaking clients).

---

## Record Batch Format

Since Kafka 0.11, records are organized in batches with a standardized binary format (Magic v2). Understanding this format helps when debugging with `kafka-dump-log.sh` or optimizing producer batching.

```
┌─────────────────────────────────────────────────────────────────┐
│                   Record Batch Header (61 bytes)                 │
├─────────────────────────────────────────────────────────────────┤
│ baseOffset (8)        │ First offset in batch                   │
│ batchLength (4)       │ Total batch size                        │
│ partitionLeaderEpoch  │ Leader epoch for fencing                │
│ magic (1)             │ Format version (2)                      │
│ crc (4)               │ Checksum of attributes → records        │
│ attributes (2)        │ Compression, timestamp type, txn flags  │
│ lastOffsetDelta (4)   │ Offset of last record relative to base  │
│ baseSequence (4)      │ Sequence number for deduplication       │
│ producerId (8)        │ For idempotence/transactions            │
│ producerEpoch (2)     │ Producer epoch                          │
│ recordCount (4)       │ Number of records in batch              │
├─────────────────────────────────────────────────────────────────┤
│                   Records (may be compressed)                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Record 0: length, attrs, timestampDelta, offsetDelta,   │    │
│  │           keyLen, key, valueLen, value, headers         │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │ Record 1: ...                                           │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Matters

| Field                         | Operational Relevance                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `producerId` / `baseSequence` | Enables idempotent deduplication—visible in dump logs when debugging duplicate issues |
| `attributes`                  | Shows compression codec (bits 0-2) and whether batch is transactional (bit 4)         |
| `partitionLeaderEpoch`        | Helps identify which leader wrote the batch—useful for debugging replication issues   |
| `recordCount`                 | Reveals batching efficiency—low counts mean suboptimal producer configuration         |

### Compression at Batch Level

Compression applies to the records portion, not the header:

```
Attributes bits 0-2 encode compression:
  0 = none
  1 = gzip
  2 = snappy
  3 = lz4
  4 = zstd
```

The batch header remains uncompressed so brokers can route and validate without decompression. This is why larger batches compress better—more data for the algorithm to find patterns.

### Inspecting Batches

```bash
# Dump segment with batch details
kafka-dump-log.sh --deep-iteration --print-data-log \
  --files /var/kafka-logs/orders-0/00000000000000000000.log

# Output shows:
# baseOffset: 0 lastOffset: 4 count: 5 ...
# producerId: 1000 producerEpoch: 0 baseSequence: 0
# compresscodec: lz4
```

---

## Log Retention & Cleanup

Kafka supports two cleanup policies: `delete` and `compact`. They can be combined as `compact,delete`.

### Delete Policy

Removes entire segments based on time or size:

```properties
# Time-based (default: 7 days)
log.retention.hours=168

# Size-based (default: unlimited)
log.retention.bytes=-1
```

**Important**: Retention applies to **closed segments only**. An active segment is never deleted, even if it exceeds retention time. This is why very low-volume topics may retain data longer than expected.

### Compact Policy

For topics with `cleanup.policy=compact`, Kafka keeps only the latest value per key:

```
Before compaction:          After compaction:
┌─────────────────────┐     ┌─────────────────────┐
│ K1:V1 (offset 0)    │     │                     │
│ K2:V1 (offset 1)    │     │                     │
│ K1:V2 (offset 2)    │     │ K2:V2 (offset 3)    │
│ K2:V2 (offset 3)    │ ──► │ K1:V3 (offset 4)    │
│ K1:V3 (offset 4)    │     │ K3:V1 (offset 5)    │
│ K3:V1 (offset 5)    │     │                     │
└─────────────────────┘     └─────────────────────┘

Note: Offsets are preserved—compaction never changes them
```

**Tombstones**: Setting a key's value to `null` marks it for deletion. The tombstone is retained for `delete.retention.ms` (default 24 hours) to propagate to consumers, then removed.

### How Log Compaction Works

The log cleaner runs as background threads that:

1. **Select dirty segments**: Segments with keys that have newer values elsewhere
2. **Build offset map**: In-memory map of key → latest offset
3. **Copy clean data**: Write non-superseded records to new segment
4. **Swap and delete**: Replace old segments with compacted ones

```
┌─────────────────────────────────────────────────────────────────┐
│                    Log Cleaner Process                          │
│                                                                 │
│  Dirty Segments        Cleaner Thread         Clean Segment     │
│  ┌─────────────┐      ┌──────────────┐       ┌─────────────┐   │
│  │ K1:V1       │      │              │       │             │   │
│  │ K2:V1       │ ───► │ Build map:   │ ───►  │ K2:V2       │   │
│  │ K1:V2       │      │ K1→offset 4  │       │ K1:V3       │   │
│  │ K2:V2       │      │ K2→offset 3  │       │ K3:V1       │   │
│  │ K1:V3       │      │ K3→offset 5  │       │             │   │
│  │ K3:V1       │      │              │       │             │   │
│  └─────────────┘      └──────────────┘       └─────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Compaction Configuration

| Config                              | Default  | Purpose                         |
| ----------------------------------- | -------- | ------------------------------- |
| `log.cleaner.threads`               | 1        | Cleaner thread count            |
| `log.cleaner.dedupe.buffer.size`    | 128 MB   | Memory for offset map           |
| `log.cleaner.min.cleanable.ratio`   | 0.5      | Dirty ratio to trigger cleaning |
| `log.cleaner.min.compaction.lag.ms` | 0        | Minimum age before compacting   |
| `delete.retention.ms`               | 24 hours | How long to keep tombstones     |

```bash
# Check cleaner status
kafka-log-dirs.sh --describe --bootstrap-server localhost:9092 \
  --topic-list __consumer_offsets
```

---

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
- SSDs: Still significant difference due to reduced write amplification

---

## Monitoring Storage Health

### Key Metrics

| Metric                                                            | Meaning                     | Warning Sign                   |
| ----------------------------------------------------------------- | --------------------------- | ------------------------------ |
| `kafka.log:type=Log,name=Size`                                    | Partition size on disk      | Unexpected growth              |
| `kafka.log:type=Log,name=NumLogSegments`                          | Segment count               | Too many = small segments      |
| `kafka.log:type=Log,name=LogEndOffset`                            | Latest offset               | Stalled = no writes            |
| `kafka.log:type=Log,name=LogStartOffset`                          | Earliest offset             | Jumping = aggressive retention |
| `kafka.server:type=ReplicaManager,name=UnderReplicatedPartitions` | Partitions missing replicas | > 0 = replication issues       |

### Useful Commands

```bash
# Describe log directories and sizes
kafka-log-dirs.sh --describe \
  --bootstrap-server localhost:9092 \
  --topic-list orders

# Dump segment contents for debugging
kafka-dump-log.sh --deep-iteration --print-data-log \
  --files /var/kafka-logs/orders-0/00000000000000000000.log

# Check index integrity
kafka-dump-log.sh --verify-index-only \
  --files /var/kafka-logs/orders-0/00000000000000000000.index
```

---

## Best Practices

1. **Size segments appropriately**: Default 1GB works for most cases; use smaller segments for low-volume topics that need faster compaction or retention

2. **Monitor disk usage**: Set alerts for partition size growth; ensure retention settings match available capacity

3. **Tune index interval carefully**: Default `log.index.interval.bytes=4096` works well; smaller values increase index size, larger values increase scan time

4. **Enable compression at producer**: Reduces network transfer and storage; `lz4` or `zstd` recommended for balance of speed and ratio

5. **Leave page cache to the OS**: Don't over-allocate JVM heap; Kafka performs best with large page cache

6. **Use SSDs for high-throughput topics**: While Kafka works well on HDDs due to sequential I/O, SSDs help with index lookups and compaction

7. **Monitor under-replicated partitions**: This is your primary health indicator for storage and replication issues

8. **Watch for segment count growth**: Many small segments indicate misconfigured rolling or very low write volume

---

## Key Takeaways

1. **Segments are the storage unit**: Understanding the segment lifecycle is essential for capacity planning and retention tuning.

2. **Indexes enable fast lookups**: Binary search on `.index` and `.timeindex` files provides O(log n) message location.

3. **Brokers do all the work**: Clients never touch storage directly—they speak offsets, brokers translate to positions.

4. **Compaction preserves offsets**: Log compaction removes old values but never changes offsets of retained records.

5. **Page cache is your friend**: Kafka's performance relies on OS-level caching; size your memory accordingly.

---

## References

- [Kafka Documentation: Implementation](https://kafka.apache.org/documentation/#implementation)
- [Kafka Documentation: Design](https://kafka.apache.org/documentation/#design)
- [The Log: What every software engineer should know](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)
- [Kafka Storage Internals](https://developer.confluent.io/courses/architecture/get-started/)
