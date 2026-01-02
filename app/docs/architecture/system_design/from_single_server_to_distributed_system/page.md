---
title: 'From Single Server to Distributed System'
description: A comprehensive guide to scaling applications from single server to distributed systems
date: 2025-10-15
---

# Scale from single server to distributed system

## Separate Web Server from Database Server

Allows them to be scaled independently.

```
┌─────────────┐        ┌───────────────┐
│  Web Server │◄──────►│  Database     │
│   (Nginx)   │        │  (PostgreSQL) │
└─────────────┘        └───────────────┘
      ▲
      │ HTTP
      │
┌─────────────┐
│   Clients   │
└─────────────┘
```

Non-relational databases might be the right choice if:

- your application requires super-low latency
- your data are unstructured, and you do not have any relational data
- you only need to serialize and deserialize data (JSON, YAML, XML etc.)
- you need to store a massive amount of data

## Scale the Web Servers

**Vertical scaling (scale up)**: adding more power (CPU, RAM etc.) to your servers

- there are hard limits
- there is no failover and redundancy (single point of failure)
- the overall cost of vertical scaling is high

**Horizontal scaling (scale out)**: adding more servers into your pool of resources

```
                    ┌───────────────┐
                    │ Load Balancer │
                    └───────┬───────┘
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
     ┌───────────┐   ┌───────────┐   ┌───────────┐
     │  Web App  │   │  Web App  │   │  Web App  │
     │ Server 1  │   │ Server 2  │   │ Server 3  │
     └───────────┘   └───────────┘   └───────────┘
```

- Stateful:
  - A stateful server remembers client data (state) from one request to the next
  - Every request from the same client must be routed the same server, this can be done with sticky sessions in most load balancers
  - But adding or removing servers is much more difficult; it is also challenging to handle server failures.

- Stateless:
  - A stateless server keeps no state information
  - A stateless system is simpler, more robust and scalable.

**Load balancer**: distributes incoming traffic among web servers that are defined in a load-balanced set.

```
                         ┌─────────────────────────────────────┐
                         │         Load Balancer               │
                         │  ┌─────────────────────────────┐   │
  Incoming ──────────────┼─►│  Health Checks + Algorithms │───┼───► Server Pool
  Requests               │  │  (RR, Least Conn, IP Hash)  │   │
                         │  └─────────────────────────────┘   │
                         └─────────────────────────────────────┘

  Layer 4 (Transport)      │    Layer 7 (Application)
  ─────────────────────────┼───────────────────────────────
  Routes by: IP + Port     │    Routes by: HTTP headers,
  Faster, less flexible    │    cookies, URL paths
                           │    More intelligent routing
```

- Layer 4 (Transport Layer): Routes based on IP address and TCP/UDP port; faster but less flexible
- Layer 7 (Application Layer): Routes based on HTTP headers, cookies, URL paths; more intelligent routing
- Load balancing algorithms:
  - Round Robin
  - Weighted Round Robin
  - Least Connections
  - Weighted Least Connections
  - Resource-based/Adaptive
  - IP Hash (for session affinity)
- Health checks: Regularly probe backend servers to detect failures and route traffic only to healthy instances
- Session affinity trade-offs: Sticky sessions simplify stateful apps but reduce load distribution efficiency and complicate failover

## API Gateway

A centralized entry point for all client requests that provides:

```
┌─────────┐     ┌─────────────────────────────────────────┐
│ Mobile  │────►│                                         │     ┌──────────────┐
└─────────┘     │              API Gateway                │────►│ User Service │
                │  ┌────────────────────────────────────┐ │     └──────────────┘
┌─────────┐     │  │ • Authentication    • Rate Limit  │ │
│   Web   │────►│  │ • Routing           • Caching     │ │────►┌──────────────┐
└─────────┘     │  │ • Load Balancing    • Logging     │ │     │Order Service │
                │  └────────────────────────────────────┘ │     └──────────────┘
┌─────────┐     │                                         │
│ Partner │────►│                                         │────►┌────────────────┐
└─────────┘     └─────────────────────────────────────────┘     │Product Service │
                                                                └────────────────┘
```

- **Request routing**: Routes requests to appropriate backend services
- **Authentication & Authorization**: Centralized security enforcement (JWT validation, API keys, OAuth)
- **Rate limiting**: Protects services from abuse and ensures fair usage
- **Request/Response transformation**: Protocol translation, payload modification
- **Caching**: Response caching to reduce backend load
- **Load balancing**: Distributes traffic across service instances
- **Logging & Monitoring**: Centralized request logging and metrics collection

Popular options: Kong, AWS API Gateway, Nginx, Envoy, Spring Cloud Gateway

## Rate Limiting & Throttling

Protects your services from being overwhelmed by too many requests.

```
Token Bucket Algorithm:
═══════════════════════════════════════════════════════════

     Tokens added         ┌──────────────────────┐
     at fixed rate ──────►│    Token Bucket      │
                          │   [●][●][●][●][ ]    │ ◄── Max capacity
                          └──────────┬───────────┘
                                     │
    Request arrives ─────────────────┼─────────────────────
                                     ▼
                          ┌───── Has Token? ─────┐
                          │                      │
                         YES                     NO
                          │                      │
                          ▼                      ▼
                    ┌──────────┐          ┌───────────┐
                    │ Process  │          │  Reject   │
                    │ Request  │          │  (429)    │
                    └──────────┘          └───────────┘
```

**Common algorithms**:

- **Token Bucket**: Tokens are added at a fixed rate; requests consume tokens
- **Leaky Bucket**: Requests are processed at a constant rate; excess requests queue or drop
- **Fixed Window**: Limits requests within fixed time intervals
- **Sliding Window Log**: Tracks timestamps of requests; more accurate but memory-intensive
- **Sliding Window Counter**: Hybrid approach balancing accuracy and efficiency

**Implementation levels**:

- Per-user/API key rate limiting
- Per-IP rate limiting
- Global rate limiting
- Distributed rate limiting (using Redis or similar)

**Response handling**: Return HTTP 429 (Too Many Requests) with `Retry-After` header

## Circuit Breaker Pattern

Prevents cascading failures when a downstream service is unhealthy.

```
                    ┌─────────────────────────────────────────────┐
                    │            Circuit Breaker States           │
                    └─────────────────────────────────────────────┘

        ┌──────────────────────────────────────────────────────────┐
        │                                                          │
        ▼                                                          │
   ┌─────────┐      Failures exceed       ┌─────────┐              │
   │ CLOSED  │ ──────threshold──────────► │  OPEN   │              │
   │         │                            │         │              │
   │ Normal  │                            │  Fail   │              │
   │Operation│ ◄────Success────────┐      │  Fast   │              │
   └─────────┘                     │      └────┬────┘              │
        ▲                          │           │                   │
        │                          │      Timeout                  │
        │                          │      expires                  │
        │                     ┌────┴────┐      │                   │
        │                     │HALF-OPEN│◄─────┘                   │
        │                     │         │                          │
        │                     │  Test   │──────Failures────────────┘
        └─────────────────────│Requests │
              Success         └─────────┘
```

**States**:

- **Closed**: Normal operation; requests pass through
- **Open**: Service is failing; requests fail immediately without calling the service
- **Half-Open**: After a timeout, allows limited requests to test if service has recovered

**Configuration parameters**:

- Failure threshold: Number of failures before opening the circuit
- Success threshold: Number of successes in half-open state before closing
- Timeout: Duration to wait before transitioning from open to half-open

**Benefits**:

- Fail fast: Reduces latency when downstream is unhealthy
- Prevents resource exhaustion from waiting on failing services
- Gives downstream services time to recover

Popular implementations: Resilience4j, Hystrix (deprecated), Polly (.NET)

## Scale the Database

**Database Replication**: one writer and many readers (replicas)

```
                         ┌──────────────────┐
           Write ───────►│   Primary (RW)   │
                         │    (Writer)      │
                         └────────┬─────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │ Replication       │                   │ Replication
              ▼                   ▼                   ▼
      ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
      │  Replica 1  │     │  Replica 2  │     │  Replica 3  │
      │  (Read)     │     │  (Read)     │     │  (Read)     │
      └─────────────┘     └─────────────┘     └─────────────┘
              ▲                   ▲                   ▲
              │                   │                   │
              └───────────────────┴───────────────────┘
                           Read Queries
```

- The writer node only supports write operations, the reader nodes only support read operations
- If a reader node goes offline, read operations are redirected to other healthy reader nodes; a new read node will spin up and replace the old one.
- If the writer node goes offline, a reader node will be promoted to be the new writer; all write operations will be redirected to the new writer node; a new reader node will replace the old one for data replication immediately.
- **Replication lag**: Read replicas may be slightly behind the primary; design for eventual consistency or use synchronous replication for critical reads
- Advantages:
  - Better performance: all read operations are distributed across reader nodes.
  - Reliability: data is replicated across multiple locations
  - High availability: data is replicated across multiple servers

**Connection Pooling**: Maintains a pool of reusable database connections

```
┌─────────────────┐      ┌────────────────────────┐      ┌──────────┐
│   Application   │      │    Connection Pool     │      │ Database │
│                 │      │  ┌──┐ ┌──┐ ┌──┐ ┌──┐  │      │          │
│  Request 1 ─────┼─────►│  │C1│ │C2│ │C3│ │C4│  │◄────►│          │
│  Request 2 ─────┼─────►│  └──┘ └──┘ └──┘ └──┘  │      │          │
│  Request 3 ─────┼─────►│   (Reusable Conns)    │      │          │
│                 │      └────────────────────────┘      └──────────┘
└─────────────────┘
                         Without pool: New connection per request (slow)
                         With pool: Reuse existing connections (fast)
```

- Reduces overhead of establishing new connections
- Prevents connection exhaustion under high load
- Popular tools: HikariCP (Java), PgBouncer (PostgreSQL), ProxySQL (MySQL)
- Key configurations: minimum/maximum pool size, connection timeout, idle timeout

**Query Optimization**:

- Proper indexing strategy (B-tree, hash, composite indexes)
- Table partitioning for large tables
- Query analysis with EXPLAIN/EXPLAIN ANALYZE
- Avoid N+1 query problems

**Horizontal Scaling (sharding)**:
Sharding separates large databases into smaller, more easily managed parts called shards. Each shard shares the same schema, though the actual data on each shard is unique to the shard.

```
                      ┌────────────────┐
                      │  Shard Router  │
                      └───────┬────────┘
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
   │   Shard 1   │     │   Shard 2   │     │   Shard 3   │
   │  Users A-H  │     │  Users I-P  │     │  Users Q-Z  │
   │             │     │             │     │             │
   │ Same schema │     │ Same schema │     │ Same schema │
   │ Unique data │     │ Unique data │     │ Unique data │
   └─────────────┘     └─────────────┘     └─────────────┘

  Sharding Key: user_id (first letter)
```

When choosing a sharding key, one of the most important criteria is to choose a key that can evenly distribute data.
Challenges:

- Resharding data: when a single shard could no longer hold more data due to rapid growth, we need to reshard and move data around. Consistent hashing is a commonly used technique.
- Celebrity problem: also called the hotspot key problem; Excessive access to a specific shard could cause server overload, we may need to allocate a shard for each celebrity, or each shard might even require further partition.
- Join and de-normalization: it is hard to perform join operations across database shards. de-normalization is a common workaround so that queries can be performed in a single table.
- Cross-shard transactions: Distributed transactions are complex; consider saga pattern or eventual consistency

## Improve Load/Response Time

**Cache**:

- Stores the result of expensive responses or frequently accessed data in memory so that subsequent requests are served more quickly
- Benefits: better system performance; ability to reduce database workloads; ability to scale the cache tier independently

**Caching strategies**:

```
Cache-Aside (Lazy Loading)                    Write-Through
══════════════════════════                    ══════════════

┌─────┐  1.Read  ┌───────┐                   ┌─────┐ 1.Write ┌───────┐
│ App │─────────►│ Cache │                   │ App │────────►│ Cache │
└──┬──┘          └───┬───┘                   └─────┘         └───┬───┘
   │                 │                                           │
   │ 2.Miss?         │                                      2.Write
   │                 │                                           │
   ▼                 ▼                                           ▼
┌──────┐ ◄──── 3.Load from DB                              ┌──────────┐
│  DB  │       4.Update cache                              │    DB    │
└──────┘                                                   └──────────┘


Write-Behind (Write-Back)                    Read-Through
═════════════════════════                    ════════════

┌─────┐ 1.Write ┌───────┐                   ┌─────┐  Read  ┌───────┐
│ App │────────►│ Cache │                   │ App │───────►│ Cache │
└─────┘         └───┬───┘                   └─────┘        └───┬───┘
                    │                                          │
               2.Async                                    Cache loads
               Queue Write                                from DB on miss
                    │                                          │
                    ▼                                          ▼
              ┌──────────┐                               ┌──────────┐
              │    DB    │                               │    DB    │
              └──────────┘                               └──────────┘
```

- **Cache-aside (Lazy Loading)**: Application checks cache first; on miss, loads from DB and populates cache
- **Write-through**: Writes go to cache and database simultaneously; ensures consistency
- **Write-behind (Write-back)**: Writes to cache first, then asynchronously to database; higher performance but risk of data loss
- **Read-through**: Cache sits between application and database; automatically loads on miss

**Considerations**:

- Decide when to use cache: for data that is read frequently but modified infrequently
- Consistency: keep the data in database and cache in sync
- Mitigating failures: use multiple cache servers across different data centers are recommended to avoid single point of failure
- Expiration policy: add TTL to the cached data (too short will cause the system to reload data from the database too frequently; too long will fetch stale data.)
- Eviction policy: LRU (Least Recently Used), LFU (Least Frequently Used), FIFO (First In First Out)

**Cache stampede (Thundering Herd)**: When a popular cache key expires, many requests simultaneously hit the database.

- Solutions:
  - Locking: Only one request fetches from DB while others wait
  - Early expiration: Proactively refresh before TTL expires
  - Probabilistic early expiration: Randomly refresh before expiration
  - Never expire + background refresh

**Distributed Cache**:

- Redis Cluster, Memcached for horizontal scaling
- Consider: data partitioning, replication, failover strategies

**CDN (Content Delivery Network)**:

```
                                    Origin Server
                                    (Your Server)
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
             ┌───────────┐        ┌───────────┐        ┌───────────┐
             │ CDN Edge  │        │ CDN Edge  │        │ CDN Edge  │
             │  (Asia)   │        │ (Europe)  │        │(Americas) │
             └─────┬─────┘        └─────┬─────┘        └─────┬─────┘
                   │                    │                    │
            ┌──────┴──────┐      ┌──────┴──────┐      ┌──────┴──────┐
            ▼             ▼      ▼             ▼      ▼             ▼
         [User]       [User]  [User]       [User]  [User]       [User]
         Tokyo       Singapore London      Paris    NYC         São Paulo

  Static content (images, CSS, JS) served from nearest edge location
```

- A network of geographically dispersed servers used to deliver static content like images, videos, CSS, JavaScript files etc.
- Considerations:
  - Cost: CDN is charged for data transfers in and out, so only cache frequently used assets.
  - Setting an appropriate cache expiry: if too short, content might need frequent refresh; if too long, it can cause repeat reloading of content from origin servers to CDN.
  - Fallback: if CDN is temporarily down, clients should be able to detect the problem and request resources from the origin.
  - Invalidating files: expire assets by either invalidating the CDN object by provider API or using object versions.

## Data Centers

To improve availability and provide a better user experience across wider geographical areas, supporting multiple data centers is crucial.

```
                              ┌─────────────┐
                              │   GeoDNS    │
                              │   Router    │
                              └──────┬──────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
   ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
   │  Data Center US    │ │  Data Center EU    │ │  Data Center APAC  │
   │ ┌────┐ ┌────┐     │ │ ┌────┐ ┌────┐     │ │ ┌────┐ ┌────┐     │
   │ │ LB │ │ DB │     │ │ │ LB │ │ DB │     │ │ │ LB │ │ DB │     │
   │ └────┘ └────┘     │ │ └────┘ └────┘     │ │ └────┘ └────┘     │
   │ ┌────┐ ┌────┐     │ │ ┌────┐ ┌────┐     │ │ ┌────┐ ┌────┐     │
   │ │Apps│ │Cache│    │ │ │Apps│ │Cache│    │ │ │Apps│ │Cache│    │
   │ └────┘ └────┘     │ │ └────┘ └────┘     │ │ └────┘ └────┘     │
   └─────────┬──────────┘ └────────┬─────────┘ └─────────┬──────────┘
             │                     │                     │
             └─────────────────────┼─────────────────────┘
                         Data Replication
```

GeoDNS is a DNS service that allows domain names to be resolved to IP addresses based on the location of a user.

In the event of any significant data center outage, we direct all traffic to a healthy data center.

Multi data center considerations:

- Traffic redirection: GeoDNS can be used to direct traffic to the nearest data center based on user's location.
- Data synchronization: In failover cases, traffic might be routed to a data center where data is unavailable. A common strategy is to replicate data across multiple data centers.
- Test and deployment: Use automated deployment tools to keep services consistent through all the data centers.

**Consistency trade-offs**:

- Strong consistency: All reads return the latest write; higher latency
- Eventual consistency: Updates propagate asynchronously; lower latency but stale reads possible
- Conflict resolution: Last-writer-wins, vector clocks, CRDTs

## Service Discovery

In dynamic environments, services need to discover each other automatically.

```
Client-Side Discovery                    Server-Side Discovery
════════════════════                     ═════════════════════

┌────────┐                               ┌────────┐
│ Client │                               │ Client │
└───┬────┘                               └───┬────┘
    │                                        │
    │ 1.Query                                │ 1.Request
    ▼                                        ▼
┌──────────────┐                        ┌──────────────┐
│   Service    │                        │Load Balancer │
│   Registry   │                        │   / Router   │
└──────────────┘                        └──────┬───────┘
    │                                          │
    │ 2.Return                                 │ 2.Query
    │ instances                                ▼
    ▼                                   ┌──────────────┐
┌────────┐                              │   Service    │
│ Client │──► 3.Direct call             │   Registry   │
└────────┘    to instance               └──────────────┘
                                               │
                                               │ 3.Return
                                               ▼
                                        ┌──────────────┐
                                        │Load Balancer │──► 4.Route
                                        └──────────────┘    to instance
```

**Client-side discovery**: Client queries a service registry and chooses an instance

- Examples: Netflix Eureka, Consul

**Server-side discovery**: Client requests go through a load balancer that queries the registry

- Examples: Kubernetes Service, AWS ELB

**Service registry**: Database of available service instances and their locations

- Must be highly available
- Health checks to remove unhealthy instances
- Examples: Consul, etcd, Zookeeper, Kubernetes DNS

## Container Orchestration

Automates deployment, scaling, and management of containerized applications.

```
┌────────────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                     Control Plane                             │  │
│  │  ┌──────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐  │  │
│  │  │API Server│ │ Scheduler │ │Controller │ │     etcd      │  │  │
│  │  └──────────┘ └───────────┘ └───────────┘ └───────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │   Worker Node   │  │   Worker Node   │  │   Worker Node   │    │
│  │ ┌───┐ ┌───┐    │  │ ┌───┐ ┌───┐    │  │ ┌───┐ ┌───┐    │    │
│  │ │Pod│ │Pod│    │  │ │Pod│ │Pod│    │  │ │Pod│ │Pod│    │    │
│  │ └───┘ └───┘    │  │ └───┘ └───┘    │  │ └───┘ └───┘    │    │
│  │ ┌───┐ ┌───┐    │  │ ┌───┐          │  │ ┌───┐ ┌───┐    │    │
│  │ │Pod│ │Pod│    │  │ │Pod│          │  │ │Pod│ │Pod│    │    │
│  │ └───┘ └───┘    │  │ └───┘          │  │ └───┘ └───┘    │    │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘    │
└────────────────────────────────────────────────────────────────────┘

         │                                            │
    Auto-scaling                                 Self-healing
  (HPA adds pods)                          (Restart failed pods)
```

**Key capabilities**:

- **Auto-scaling**: Horizontal Pod Autoscaler (HPA) based on CPU/memory/custom metrics
- **Self-healing**: Automatic restart of failed containers
- **Service discovery & load balancing**: Built-in DNS and load balancing
- **Rolling updates & rollbacks**: Zero-downtime deployments
- **Resource management**: CPU/memory limits and requests

**Scaling strategies**:

- Horizontal scaling: Add more pod replicas
- Vertical scaling: Increase resources per pod
- Cluster autoscaling: Add/remove nodes based on demand

Popular platforms: Kubernetes, Docker Swarm, Amazon ECS, Google Cloud Run

## Message Queue

A message queue is a durable component that supports asynchronous communication.

```
┌──────────────┐                                      ┌──────────────┐
│   Producer   │                                      │   Consumer   │
│  (Service A) │                                      │  (Service B) │
└──────┬───────┘                                      └──────▲───────┘
       │                                                     │
       │ 1.Publish                                    4.Process
       │                                                     │
       ▼                                                     │
┌─────────────────────────────────────────────────────────────────────┐
│                         Message Queue                               │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ [Msg1] [Msg2] [Msg3] [Msg4] [Msg5]  ───────────────────────► │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Features:                                                          │
│  • Durability (messages persisted)                                  │
│  • Ordering (FIFO or partitioned)                                   │
│  • Acknowledgment (at-least-once/exactly-once)                      │
│                                                                     │
│  Dead Letter Queue (DLQ):                                           │
│  ┌─────────────────────────┐                                        │
│  │ [Failed1] [Failed2]     │  ◄── Messages that couldn't be         │
│  └─────────────────────────┘      processed after retries           │
└─────────────────────────────────────────────────────────────────────┘
```

Decoupling makes the message queue a preferred architecture for building a scalable and reliable application.

**Delivery semantics**:

- **At-most-once**: Messages may be lost but never redelivered
- **At-least-once**: Messages are never lost but may be redelivered; consumers must be idempotent
- **Exactly-once**: Each message is delivered exactly once; most difficult to achieve

**Dead Letter Queue (DLQ)**: Stores messages that could not be processed

- Allows inspection and debugging of failed messages
- Prevents poison messages from blocking the queue
- Configure retry policies before moving to DLQ

**Backpressure handling**:

- Rate limiting on producers
- Queue size limits with rejection policies
- Consumer scaling based on queue depth

**Best practices**:

- Idempotent consumers for at-least-once delivery
- Message ordering considerations (partitioning by key)
- Poison message handling with retry limits

Popular options: Apache Kafka, RabbitMQ, Amazon SQS, Redis Streams

## Observability: Logging, Metrics, Tracing

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Observability Stack                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────┐      ┌────────────┐      ┌────────────┐            │
│  │  Logging   │      │  Metrics   │      │  Tracing   │            │
│  │            │      │            │      │            │            │
│  │ • ELK Stack│      │ •Prometheus│      │ • Jaeger   │            │
│  │ • Splunk   │      │ • Grafana  │      │ • Zipkin   │            │
│  │ • Datadog  │      │ • Datadog  │      │ •OpenTelem │            │
│  └─────┬──────┘      └─────┬──────┘      └─────┬──────┘            │
│        │                   │                   │                    │
│        └───────────────────┼───────────────────┘                    │
│                            │                                        │
│                     ┌──────▼──────┐                                 │
│                     │  Alerting   │                                 │
│                     │ PagerDuty,  │                                 │
│                     │ OpsGenie    │                                 │
│                     └─────────────┘                                 │
└─────────────────────────────────────────────────────────────────────┘

Distributed Trace Example:
═══════════════════════════

Request ──► API Gateway ──► User Service ──► Database
   │             │               │              │
   │    [Span 1] │    [Span 2]   │   [Span 3]   │
   │◄────────────┴───────────────┴──────────────┤
   │              Total Trace Duration          │
```

**Logging**:

- Monitoring error logs is important because it helps to identify errors and problems in the system
- Centralized logging: Aggregate logs from all services (ELK Stack, Splunk, Datadog)
- Structured logging: JSON format for easier parsing and querying
- Log levels: DEBUG, INFO, WARN, ERROR; configure appropriately per environment
- Correlation IDs: Track requests across services

**Metrics**:

- Collecting different types of metrics helps gain business insights and understand the health status of the system
- Types: counters, gauges, histograms, summaries
- Key metrics: latency (p50, p95, p99), error rate, throughput, saturation
- RED method: Rate, Errors, Duration
- USE method: Utilization, Saturation, Errors
- Tools: Prometheus, Grafana, Datadog, CloudWatch

**Distributed Tracing**:

- Track requests as they flow through multiple services
- Identify bottlenecks and latency issues
- Tools: Jaeger, Zipkin, OpenTelemetry, AWS X-Ray

**Alerting**:

- Set up alerts for critical thresholds
- Avoid alert fatigue with proper thresholds and grouping
- Runbooks for common issues

**Automation**: CI (Continuous Integration) and CD (Continuous Deployment).

- Automated testing at every stage
- Infrastructure as Code (Terraform, Pulumi)
- GitOps for declarative deployments

## Summary Cheat Sheet

```
Application Scaling Journey
═══════════════════════════════════════════════════════════════════

     Single Server          Separate Concerns         Scale Web Tier
    ┌───────────┐          ┌─────┐   ┌────┐          ┌─────┐
    │ Web + DB  │    ──►   │ Web │   │ DB │    ──►   │ LB  │
    └───────────┘          └─────┘   └────┘          └──┬──┘
                                                    ┌───┼───┐
                                                   [W] [W] [W]

        Add Cache              Add CDN              Multiple DCs
       ┌───────┐             ┌───────┐            ┌────┐ ┌────┐
       │ Redis │             │  CDN  │            │ DC1│ │ DC2│
       └───────┘             └───────┘            └────┘ └────┘
                                                    (GeoDNS)

      Scale Database          Message Queue         Microservices
    ┌────┐                   ┌─────────┐          ┌───┐ ┌───┐
    │ RW │                   │  Kafka  │          │Svc│ │Svc│
    └─┬──┘                   └─────────┘          └───┘ └───┘
   ┌──┴──┐
  [R]   [R]
```

| Stage                      | Key Actions                                             |
| -------------------------- | ------------------------------------------------------- |
| **Separate concerns**      | Split web server from database                          |
| **Scale web tier**         | Add load balancer, horizontal scaling, stateless design |
| **Add API Gateway**        | Centralized routing, auth, rate limiting                |
| **Protect services**       | Rate limiting, circuit breakers                         |
| **Scale database**         | Read replicas, connection pooling, sharding             |
| **Improve latency**        | Caching (Redis), CDN for static assets                  |
| **Go multi-region**        | Data centers, GeoDNS, data replication                  |
| **Dynamic infrastructure** | Service discovery, container orchestration              |
| **Decouple services**      | Message queues with proper delivery semantics           |
| **Observe everything**     | Logging, metrics, tracing, alerting                     |
