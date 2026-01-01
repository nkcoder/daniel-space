---
title: 'Back of the Envelope Estimation'
description: Quick-reference for powers of two, latency and availability benchmarks, plus a worked Twitter sizing example to ground rapid system design estimates.
date: 2025-07-05
tags: [architecture]
---

# Back of the Envelope Estimation

Jeff Dean: back-of-the-envelope calculations are estimates you create using a combination of thought experiments and common performance numbers to get a good feel for which designs will meet your requirements.

## Power of two

To obtain correct calculations, it is critical to know the data volume unit using the power of 2.

| Power | Approximate Value | Full Name  | Short Name |
| ----- | ----------------- | ---------- | ---------- |
| 2^10  | 1 thousand        | 1 kilobyte | 1 KB       |
| 2^20  | 1 million         | 1 megabyte | 1 MB       |
| 2^30  | 1 billion         | 1 gigabyte | 1 GB       |
| 2^40  | 1 trillion        | 1 terabyte | 1 TB       |
| 2^50  | 1 quadrillion     | 1 petabyte | 1 PB       |

## Common Data Sizes

Typical sizes for common data types and objects:

| Data Type / Object       | Size (Approx) | Notes                                  |
| :----------------------- | :------------ | :------------------------------------- |
| UUID                     | 16 bytes      | 128 bits                               |
| Unix Timestamp (seconds) | 4 bytes       | 32-bit integer                         |
| Unix Timestamp (ms)      | 8 bytes       | 64-bit integer (Long)                  |
| Boolean                  | 1 byte        |                                        |
| Integer (32-bit)         | 4 bytes       |                                        |
| Long (64-bit)            | 8 bytes       |                                        |
| Double (64-bit)          | 8 bytes       |                                        |
| UTF-8 Character          | 1-4 bytes     | 1 byte for ASCII, avg ~2 bytes for CJK |
| **Application Objects**  |               |                                        |
| Tweet (text only)        | ~600 bytes    | 300 characters \* 2 bytes              |
| User Profile (metadata)  | ~1 KB         | Name, bio, settings, etc.              |
| JSON API Response (avg)  | 1-10 KB       | Highly variable                        |
| **Media**                |               |                                        |
| Thumbnail Image          | 10-50 KB      | Compressed JPEG/WebP                   |
| Standard Image           | 100-500 KB    | Compressed photo                       |
| High-Res Image           | 1-5 MB        | Uncompressed or lightly compressed     |
| Short Video Clip (10s)   | 5-15 MB       | H.264, 720p                            |
| 1-minute Video           | 30-100 MB     | Depends on resolution and codec        |

## Server Throughput Benchmarks

Approximate throughput for a single modern server (e.g., 8-16 cores, 32-64GB RAM):

| Server Type            | Throughput (Approx)  | Notes                                   |
| :--------------------- | :------------------- | :-------------------------------------- |
| Web Server (Nginx/CDN) | 50,000 - 100,000 RPS | Static content, reverse proxy           |
| API Server (Simple)    | 10,000 - 50,000 RPS  | Stateless, in-memory logic              |
| API Server (with DB)   | 1,000 - 10,000 RPS   | Network I/O to DB is the bottleneck     |
| **Databases**          |                      |                                         |
| Redis (in-memory)      | 100,000+ QPS         | Simple GET/SET; check for hot keys      |
| PostgreSQL (Read)      | 10,000 - 50,000 QPS  | Index-scanned reads, connection pooling |
| PostgreSQL (Write)     | 1,000 - 5,000 TPS    | Dependent on disk I/O and WAL           |
| MySQL (Read)           | 10,000 - 50,000 QPS  | With read replicas                      |
| Cassandra (Write)      | 10,000 - 100,000 TPS | Per node, designed for write-heavy      |
| **Message Queues**     |                      |                                         |
| Kafka (Producer)       | 500,000+ msg/s       | Per broker, with batching               |
| Kafka (Consumer)       | 100,000+ msg/s       | Per partition                           |

> [!TIP]
> **Rule of Thumb for Servers**: A single, well-optimized API server can handle **~5,000-10,000 RPS** for typical CRUD operations with a database.

## Estimation Framework

A structured 5-step approach to estimation:

### Step 1: Define Scope & Scale

- **DAU (Daily Active Users)**: Start here. Most other numbers derive from this.
- **MAU (Monthly Active Users)**: Typically ~3x DAU for high-engagement apps.
- **Read:Write Ratio**: Is this a read-heavy system (e.g., Twitter) or write-heavy (e.g., logging)? A 10:1 or 100:1 read ratio is common.

### Step 2: Estimate Traffic (QPS)

```
# Simple formula
Write QPS = (DAU * Actions_per_user_per_day) / 86,400 seconds
Peak QPS = Avg QPS * 2 to 3x  (for spikes)

# Example: 100M DAU, 2 posts/user/day
Write QPS = (100M * 2) / 86,400 = ~2,300 QPS
```

### Step 3: Estimate Storage

```
# Formula
Daily Storage = (Write_QPS * 86,400 seconds) * Avg_Object_Size
Yearly Storage = Daily Storage * 365
Total Storage = Yearly Storage * Retention_Years * Replication_Factor
```

### Step 4: Estimate Bandwidth

```
# Ingress (data coming in)
Ingress_bps = Write_QPS * Avg_Request_Size

# Egress (data going out) - usually much larger
Egress_bps = Read_QPS * Avg_Response_Size
```

### Step 5: Estimate Infrastructure

```
# Servers
App_Servers_Needed = Peak_QPS / QPS_per_server

# Cache (Top 20% Rule)
Cache_Size = Daily_Data_Volume * 0.2    # Cache most-accessed 20%

# Database
DB_Shards = Total_Storage / Max_per_shard  (e.g., 1-2 TB per shard)
```

## Latency numbers

Approximate latency numbers (based on modern systems):
| Operation | Latency | Notes |
| --------------------------------- | -------------------- | ------------------------------------ |
| L1 cache reference | ~1 ns | Fastest memory access |
| Branch mispredict | ~5 ns | CPU pipeline stall |
| L2 cache reference | ~7 ns | Still very fast |
| Mutex lock/unlock | ~25 ns | Synchronization overhead |
| Main memory reference | ~100 ns | 100x slower than L1 |
| Compress 1KB with **Snappy** | ~3 μs (3,000 ns) | Fast compression |
| Send 2KB over **10 Gbps** network | ~2 μs (2,000 ns) | Modern DC networking |
| Read 1MB sequentially from memory | ~250 μs (250,000 ns) | ~4GB/s |
| SSD Random Read | ~100 μs | NVMe/Flash is ~1000x faster than HDD |
| Read 1MB sequentially from SSD | ~200 μs | Faster NVMe access |
| Read 1MB sequentially from HDD | ~20 ms | Mechanical seek limit |
| **Geographic Latency** | | |
| Ping within same Data Center | < 1 ms | Local network |
| Round trip (SF to NYC) | ~40 ms | Light in fiber (USA coast) |
| Round trip (SF to London) | ~80 ms | Trans-Atlantic |
| Round trip (SF to Sydney) | ~170 ms | Trans-Pacific |

Key takeaways for distributed systems:

- **Memory hierarchy matters**: L1 -> L2 -> RAM shows 100x jumps in latency.
- **Network vs Local**: Even fast networks (~2μs) are 20 slower than RAM access (~100ns).
- **Disk is the new tape**: Mechanical HDDs are only for archiving; SSDs are the baseline for performance.
- **Regional Latency**: Cross-continent latency (>150ms) makes global synchronization (like multi-region Paxos) extremely slow.

## The 100k Multiplier

A handy shortcut for mental math: 1 QPS $\approx$ 100,000 requests per day.

| QPS (Requests/sec) | Daily Volume (Approx) | Monthly Volume (Approx) |
| :----------------- | :-------------------- | :---------------------- |
| 1                  | 100,000               | 3 Million               |
| 10                 | 1 Million             | 30 Million              |
| 100                | 10 Million            | 300 Million             |
| 1,000              | 100 Million           | 3 Billion               |
| 10,000             | 1 Billion             | 30 Billion              |

## Availability numbers

High availability is the ability of a system to be continuously operational for a desirably long period of time. It is usually measured in nines, the more the nines, the better.

| Availability %     | Downtime per day    | Downtime per year |
| ------------------ | ------------------- | ----------------- |
| 99% (2 nines)      | 14.40 minutes       | 3.65 days         |
| 99.9% (3 nines)    | 1.44 minutes        | 8.77 hours        |
| 99.99% (4 nines)   | 8.64 seconds        | 52.60 minutes     |
| 99.999% (5 nines)  | 864.00 milliseconds | 5.26 minutes      |
| 99.9999% (6 nines) | 86.40 milliseconds  | 31.56 seconds     |

## Example

### Design Twitter's QPS and storage system

1. Make assumptions

```
- 500M daily active users (DAU)
- Each user posts 2 tweets per day on average
- Average tweet size: 300 characters
- 20% of users post, 80% just read
- 10% of tweets have media (images/videos)
- Data is stored for 5 years
```

2. Calculate tweets per day

```
- Active posters: 500M * 20% = 100M users
- Tweets per day = 100M * 2 = 200M tweets/day
- Tweets QPS: 200M / 24 hour / 3600s = ~2300
- Peek QPS: 3 * QPS = ~7000
```

3. Calculate tweet storage

```
- Metadata per tweet
  - User ID: 8 bytes
  - Tweet ID: 8 bytes
  - Timestamp: 8 bytes
  - Likes/retweets counts: 8 bytes
  - other metadata: ~32 bytes
  - total: ~64 bytes
- Tweet
  - 300 characters * 2 bytes (UTF-8) = 600 bytes
- Total: (64 + 600) * 200M = 132.8 GB/day
```

4. Calculate media storage

```
- Tweets with media: 200M * 10% = 20M/day
- Average media size: 200 KB (compressed image)
- Media storage: 20M * 200 KB = 4 TB/day
```

5. Total daily storage

```
- 132.8 GB/day + 4 TB/day = 4.13 TB/day
```

6. Calculate 5-year storage

```
- Storage: 4.13 TB/day * 365 days * 5 years = ~7.5 PB
- Add 30% for replication/backups, total ~= 10PB
```

7. Read Path & Bandwidth (The "Wow" Factor)

```
- Assume users check timeline 10x more than they post
- Read QPS: 2300 (Write QPS) * 10 = 23,000 QPS
- Egress Bandwidth:
  - Each visit loads 20 tweets (some with media)
  - Assume avg visit load size = 100 KB
  - Total Egress = 23k visits/s * 100 KB = 2.3 GB/s (18.4 Gbps)
  - This requires significant CDN usage or multiple 100G edge links.
```

8. Cache Estimation (Top 20% Rule)

```
- We only need to cache "Hot Data" (latest tweets from active users)
- 200M tweets per day * 64 bytes (metadata) = 12.8 GB
- To keep the last 2 days of metadata in Redis: ~25 GB (Small enough for 1-2 servers)
```

---

## Read-Heavy vs. Write-Heavy Designs

| Type            | Examples                   | Design Focus                                                          |
| :-------------- | :------------------------- | :-------------------------------------------------------------------- |
| **Read-Heavy**  | Twitter, News, Profiles    | Denormalize data, heavy caching (Redis/Memcached), CDNs.              |
| **Write-Heavy** | Logging (ELK), IoT Sensors | Log-structured storage (LSM trees), message queues (Kafka), batching. |

---

## Example 2: URL Shortener (TinyURL)

1. Assumptions

```
- 100M new URLs shortened per month
- Read:Write ratio = 100:1 (most URLs are created once, read many times)
- Average long URL length: 100 bytes
- Short URL: 7 characters (Base62) = 7 bytes
- Storage duration: 10 years
```

2. QPS

```
- Write QPS: 100M / (30 days * 86400s) = ~40 QPS (very low)
- Read QPS: 40 * 100 = 4,000 QPS
- Peak Read QPS: 4,000 * 3 = 12,000 QPS
```

3. Storage

```
- Per URL entry: 7 (short) + 100 (long) + 8 (timestamp) + 8 (user_id) = ~130 bytes
- Daily new URLs: 100M / 30 = ~3.3M URLs/day
- Daily Storage: 3.3M * 130 bytes = ~430 MB/day
- 10-Year Storage: 430 MB * 365 * 10 = ~1.5 TB
- With replication (3x): ~5 TB (easily fits on a single large DB or a few nodes)
```

4. Cache

```
- Hot URLs (Top 20%): 0.2 * 1.5 TB (10-year data) = ~300 GB
- In practice, only the last few months are "hot", so ~50-100 GB Redis is sufficient.
```

5. Infrastructure

```
- App Servers: 12,000 Peak RPS / 5,000 RPS per server = ~3 servers (with headroom, use 5-6)
- Database: 5 TB fits comfortably on a single PostgreSQL instance with read replicas.
- Cache: 100 GB Redis cluster (2-3 nodes).
```

**Key takeaway**: URL shorteners are deceptively simple and require very modest infrastructure at scale.

---

## References

- Jeff Dean, [Numbers Everyone Should Know](http://brenocon.com/dean_perf.html)
- [ByteByteGo - System Design Interview](https://bytebytego.com/)
