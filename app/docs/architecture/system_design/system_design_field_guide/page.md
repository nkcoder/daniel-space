---
title: 'System Design Field Guide'
description: Reference guide covering consistency models, reliability vs. availability tradeoffs, scaling patterns, caching/CDN strategies, multi-region deployment, queues, and operational monitoring practices.
date: 2025-10-15
tags: [architecture]
---

# System Design Field Guide

## Consistency

**Eventual consistency**: is the weakest consistency model. The applications that don't have strict ordering requirements and don't require reads to return the latest write choose this model. Eventual consistency ensures that all the replicas converge on a final value after a finite time and when no more writes are coming in.
Eventual consistency ensures high availability.
Example: Domain Name System (DNS), Cassandra.

**Strict Consistency (linearizability)**: is the strongest consistency model. It ensures that a read request from any replicas will get the latest write value. Once the client receives the acknowledgment that the write operation has been performed, other clients can read that value.
Strict consistency is challenging to achieve in a distributed system because of network delays and failures. Usually synchronous replication, consensus algorithms such Paxos and Raft are the ingredients for achieving strong consistency. Applications with strong consistency requirements use techniques like quorum-based replications to increase the system's availability.
Example: Updating bank account's password requires strict consistency.

## Reliability

How often the system produces correct results - the probability that a system will work correctly over a given time period.

- Focus on correctness and data integrity
- Measures: can the system be trusted to deliver accurate results?
- A reliable system avoids errors, data loss, and incorrect behavior
- Example: a database that never loses data or corrupts transactions is highly reliable

## Availability

How often the system is operational and accessible - the percentage of time a system is up and able to respond to requests.

- Focuses on uptime and accessibility
- Measures: is the system ready to serve requests right now?
- Calculated as `uptime / (uptime + downtime) (often expressed as `nines` - 99.99% etc.)
- Example: a web server that responds to requests 99.99% of the time has high availability

## Reliability vs Availability

A system can be highly available but not reliable - it's always accessible but sometimes returns wrong answers or loses data.

Conversely, a system could be reliable but not highly available - when it works, it's always correct, but it has frequent downtime.

Example for a payment processing system:

- High availability, low reliability: system is always up (99.99%) but occasionally processes duplicate charges due to bugs.
- High reliability, low availability: System never makes mistakes when processing payments, but goes down frequently for maintenance.

## Scalability

> How to scale your application step by step.

### Separate web server from database server

Allows them to be scaled independently.

Non-relational databases might be the right choice if:

- your application requires super-low latency
- your data are unstructured, and you do not have any relational data
- you only need to serialize and deserialize data (JSON, YAML, XML etc.)
- you need to store a massive amount of data

### Scale the web servers

**Vertical scaling (scale up)**: adding more power (CPU, RAM etc.) to your servers

- there are hard limits
- there is no failover and redundancy (single point of failure)
- The overall cost of vertical scaling is high.

**Horizontal scaling (scale out)**: adding more servers into your pool of resources

- Stateful:
  - A stateful server remembers client data (state) from one request to the next
  - Every request from the same client must be routed the same server, this can be done with sticky sessions in most load balancers
  - But adding or remover servers is much more difficult; it is also challenging to handle server failures.
- Stateless:
  - A stateless server keeps no state information
  - A stateless system is simpler, more robust and scalable.

**Load balancer**: distributes incoming traffic among web servers that are defined in a load-balanced set.

- Round Robin
- Weighted Round Robin
- Least Connections
- Weighted Least Connections
- Resource-based/Adaptive

### Scale the database

**Database Replication**: one writer and many readers (replicas)

- The writer node only supports write operations, the reader nodes only support read operations
- If a reader node goes offline, read operations are redirected to other healthy reader nodes; a new read node will spin up and replace the old one.
- If the writer node goes offline, a reader node will be promoted to be the new writer; all write operations will be redirected to the new writer node; a new reader node will replace the old one for data replication immediately.
- Advantages:
  - Better performance: all read operations are distributed across reader nodes.
  - Reliability: data is replicated across multiple locations
  - High availability: data is replicated across multiple servers

**Horizontal Scaling (sharding)**
Sharding separates large databases into smaller, more easily managed parts called shards. Each shard shares the same schema, though the actual data on each shard is unique to the shard.
When choosing a sharding key, one of the most important criteria is to choose a key that can evenly distribute data.
Challenges:

- Resharding data: when a single shard could no longer hold more data due to rapid growth, we need to reshard and move data around. Consistent hashing is a commonly used technique.
- Celebrity problem: also called the hotspot key problem; Excessive access to a specific shard could cause server overload, we may need to allocate a shard for ech celebrity, or each shard might even require further partition.
- Join and de-normalization: it is hard to perform join operations across database shards. de-normalization is a common workaround so that queries can be performed in a single table.

### Improve load/response time

**Cache**:

- Stores the result of expensive responses or frequently accessed data in memory so that subsequent requests are served more quickly
- Benefits: better system performance; ability to reduce database workloads; ability to scale the cache tier independently
- Considerations:
  - Decide when to use cache: for data that is read frequently but modified infrequently
  - Consistency: keep the data in database and cache in sync.
  - Mitigating failures: use multiple cache servers across different data centers are recommended to avoid single point of failure.
  - Expiration policy: add TTL to the cached data (too short will cause the system to reload data from the database too frequently; too long will fetch stale data.)
  - Eviction policy: LRU(Least Recently Used), LFU(Least Frequently Used), FIFO(First In First Out).

**CDN (Content Delivery Network)**:

- A network of geographically dispersed servers used to deliver static content like images, videos, CSS, JavaScript files etc.
- Considerations:
  - Cost: CDN is charged for data transfers in and out, so only cache frequently used assets.
  - Setting an appropriate cache expiry: if too short, the content might no long be fresh; if too long, it can cause repeat reloading of content from origin servers to CDN.
  - Fallback: if CDN is temporally down, clients should be able to detect the problem and request resources from the origin.
  - Invalidating files: expire assets by either invalidating the CDN object by provider API or using object versions.

### Data Centers

To improve availability and provide a better user experience across wider geographical areas, supporting multiple data centers is crucial.

GeoDNS is a DNS service that allows domain names to be resolved to IP addresses based on the location of a user.

In the event of any significant data center outage, we direct all traffic to a healthy data center.

Multi data center considerations:

- Traffic redirection: GeoDNS can be used to direct traffic to the nearest data center based on user's location.
- Data synchronization: In failover cases, traffic might be routed to a data center where data is unavailable. A common strategy is to replicate data across multiple data centers.
- Test and deployment: Use automated deployment tools to keeps services consistent through all the data centers.

### Message Queue

A message queue is a durable component that supports asynchronous communication.

Decoupling makes the message queue a preferred architecture for building a scalable and reliable application.

## Logging, Metrics, Automation

Monitoring error logs is important because it helps to identify errors and problems in the system (per server level, or aggregated to a centralized service)

Collecting different types of metrics help us to gain business insights and understand the health status of the system.

Automation: CI (Continuous Integration) and CD (Continuous Deployment).
