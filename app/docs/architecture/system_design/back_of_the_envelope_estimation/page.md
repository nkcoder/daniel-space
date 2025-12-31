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

## Latency numbers

Approximate latency numbers (based on modern systems):
| Operation | Latency | Notes |
| ---------------------------------- | --------------------------- | --------------------------- |
| L1 cache reference | ~1 ns | Fastest memory access |
| Branch mispredict | ~5 ns | CPU pipeline stall |
| L2 cache reference | ~7 ns | Still very fast |
| Mutex lock/unlock | ~25 ns | Synchronization overhead |
| Main memory reference | ~100 ns | 100x slower than L1 |
| Compress 1KB with Zippy | ~3 μs (3,000 ns) | Snappy compression |
| Send 2KB over 1 Gbps network | ~20 μs (20,000 ns) | Network bandwidth limit |
| Read 1MB sequentially from network | ~10 ms | Varies with network quality |
| Read 1MB sequentially from disk | ~1 ms (SSD) to ~20 ms (HDD) | SSD is 20x faster |

Key takeaways for distributed systems:

- **Memory hierarchy matters**: L1 -> L2 -> RAM shows 100x jumps in latency
- **Network is expensive**: event fast networks are ~20,000x slower than RAM access
- **Sequential disk reads**: SSDs make a huge difference (20x improvement over HDDs)
- **Cache locality**: Keeping data in L1/L2 cache can dramatically improve performance

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

- 500M daily active users (DAU)
- Each user posts 2 tweets per day on average
- Average tweet size: 300 characters
- 20% of users post, 80% just read
- 10% of tweets have media (images/videos)
- Data is stored for 5 years

2. Calculate tweets per day

- Active posters: 500M \* 20% = 100M users
- Tweets per day = 100M \* 2 = 200M tweets/day
- Tweets QPS: 200M / 24 hour / 3600s = ~2300
- Peek QPS: 3 \* QPS = ~7000

3. Calculate tweet storage

- Metadata per tweet
  - User ID: 8 bytes
  - Tweet ID: 8 bytes
  - Timestamp: 8 bytes
  - Likes/retweets counts: 8 bytes
  - other metadata: ~32 bytes
  - total: ~64 bytes
- Tweet
  - 300 characters \* 2 bytes (UTF-8) = 600 bytes
- Total: (64 + 600) \* 200M = 132.8 GB/day

4. Calculate media storage

- Tweets with media: 200M \* 10% = 20M/day
- Average media size: 200 KB (compressed image)
- Media storage: 20M \* 200 KB = 4 TB/day

5. Total daily storage

- 132.8 GB/day + 4 TB/day = 4.13 TB/day

6. Calculate 5-year storage

- Storage: 4.13 TB/day _ 365 days _ 5 years = ~7.5 PB
- Add 30% for replication/backups, total ~= 10PB
