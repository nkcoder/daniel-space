---
title: Introduction to Apache Kafka
description:
date: 2025-12-23
---

# Introduction to Apache Kafka

## What is Apache Kafka?

Apache Kafka is a distributed event streaming platform capable of handling trillions of events per day. Originally developed at LinkedIn in 2010 and open-sourced in 2011, Kafka has become the de facto standard for building real-time data pipelines and streaming applications.

At its core, Kafka provides three key capabilities:

1. **Publish and Subscribe:** Read and write streams of events (similar to a messaging system)
2. **Store:** Store streams of events durably and reliably for as long as you want
3. **Process:** Process streams of events as they occur or retrospectively

Unlike traditional messaging systems, Kafka treats messages as an immutable, append-only commit log. This fundamental design choice enables Kafka's remarkable performance characteristics: sequential disk writes, zero-copy data transfer, and horizontal scalability.

### Core Terminology

Before diving deeper, let's establish the vocabulary:

| Term                     | Description                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- |
| **Event/Record/Message** | A unit of data containing a key, value, timestamp, and optional headers             |
| **Topic**                | A named, logical category or feed to which records are published                    |
| **Partition**            | A topic is split into partitions for parallelism; each is an ordered, immutable log |
| **Offset**               | A unique identifier for each record within a partition                              |
| **Producer**             | An application that publishes events to topics                                      |
| **Consumer**             | An application that subscribes to topics and processes events                       |
| **Consumer Group**       | A set of consumers that cooperatively consume from topics                           |
| **Broker**               | A Kafka server that stores data and serves client requests                          |
| **Controller**           | The broker (or dedicated node) responsible for cluster metadata management          |

---

## The Evolution: From ZooKeeper to KRaft

### The ZooKeeper Era (2011-2024)

For over a decade, Apache ZooKeeper was the backbone of Kafka's distributed coordination. ZooKeeper handled critical responsibilities:

- **Controller Election:** Selecting which broker manages partition leader elections
- **Cluster Membership:** Tracking which brokers are alive
- **Topic Configuration:** Storing topic metadata and configurations
- **Access Control:** Managing ACLs for security

While ZooKeeper served Kafka well, this architecture introduced significant operational complexity:

```
┌─────────────────────────────────────────────────────────────────┐
│                     ZooKeeper Architecture                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│   │ ZooKeeper 1 │◄──►│ ZooKeeper 2 │◄──►│ ZooKeeper 3 │         │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│          │                  │                  │                 │
│          └──────────────────┼──────────────────┘                 │
│                             │                                    │
│                             ▼                                    │
│          ┌─────────────────────────────────────┐                │
│          │         Metadata Requests            │                │
│          └─────────────────────────────────────┘                │
│                             │                                    │
│     ┌───────────────────────┼───────────────────────┐           │
│     ▼                       ▼                       ▼           │
│ ┌────────┐             ┌────────┐             ┌────────┐        │
│ │Broker 1│             │Broker 2│             │Broker 3│        │
│ │        │             │(Ctrl)  │             │        │        │
│ └────────┘             └────────┘             └────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Pain Points with ZooKeeper:**

1. **Operational Overhead:** Two distributed systems to deploy, configure, monitor, and secure
2. **Scalability Limits:** Metadata changes propagated via RPCs grew linearly with partition count
3. **Recovery Time:** Controller failover required loading all metadata from ZooKeeper
4. **Consistency Challenges:** Split-brain scenarios between ZooKeeper state and broker state

### The Birth of KRaft (KIP-500)

In late 2019, the Kafka community proposed KIP-500: "Replace ZooKeeper with a Self-Managed Metadata Quorum." The vision was elegant: use Kafka itself to store and replicate metadata using a Raft-based consensus protocol.

**The timeline:**

| Version       | Date           | Milestone                                     |
| ------------- | -------------- | --------------------------------------------- |
| Kafka 2.8     | April 2021     | KRaft early access (single-node only)         |
| Kafka 3.0     | September 2021 | KRaft preview with migration support          |
| Kafka 3.3     | October 2022   | KRaft production-ready for new clusters       |
| Kafka 3.6     | October 2023   | ZooKeeper-to-KRaft migration production-ready |
| Kafka 3.9     | January 2025   | Last bridge release supporting both modes     |
| **Kafka 4.x** | **2025**       | **ZooKeeper completely removed; KRaft only**  |

---

## What's New in Kafka 4.x

Kafka 4.x represents the most significant architectural shift since the project's inception. Here are the major features and changes that define this generation.

### ZooKeeper Removed — KRaft is the Only Option

After 14 years, ZooKeeper is gone. All Kafka 4.x clusters run exclusively in KRaft mode. This isn't just a configuration change — it's a fundamental simplification of the platform.

**Migration Path:** There's no direct upgrade from ZooKeeper to 4.x. You must first migrate to Kafka 3.9 (the last bridge release), complete the ZooKeeper-to-KRaft migration, then upgrade to 4.x.

**Dynamic Controller Quorum (KIP-853):** Controllers can now be added or removed without cluster downtime:

```bash
# Add a new controller
bin/kafka-metadata-quorum.sh --bootstrap-server localhost:29092 add-controller

# Remove a controller
bin/kafka-metadata-quorum.sh --bootstrap-server localhost:29092 remove-controller --controller-id 2 --controller-directory-id <dir-id>
```

### Next-Generation Consumer Protocol (KIP-848)

The legacy consumer group protocol had a fundamental limitation: rebalances were "stop-the-world" events. The new protocol changes this dramatically:

```
┌─────────────────────────────────────────────────────────────────┐
│                  Legacy vs. New Rebalance Protocol               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  LEGACY PROTOCOL:                                                │
│  ┌────────┬────────┬────────┬────────┬────────┐                 │
│  │Consumer│PAUSE   │Rebalance│Resume  │Consumer│                 │
│  │Working │        │         │        │Working │                 │
│  └────────┴────────┴────────┴────────┴────────┘                 │
│           ▲                           ▲                          │
│           └── All consumers stop ─────┘                          │
│                                                                   │
│  NEW PROTOCOL (KIP-848):                                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │Consumer 1: Working ──────────────────────►                  │ │
│  │Consumer 2: Working ──► Reassign ──► Work                    │ │
│  │Consumer 3: Working ──────────────────────►                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│           ▲                                                      │
│           └── Only affected consumers pause (incremental)        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Key improvements:**

- Server-side partition assignment (broker manages assignments)
- Incremental rebalancing (unaffected consumers continue processing)
- Dramatically reduced rebalance latency
- Enabled by default on server; clients opt-in with `group.protocol=consumer`

A dedicated Streams Rebalance Protocol (KIP-1071) extends these benefits specifically for Kafka Streams applications.

### Queues for Kafka (KIP-932)

Traditionally, Kafka provides ordered, partitioned consumption where each partition is consumed by exactly one consumer in a group. KIP-932 introduces "Share Groups" for queue-like semantics:

- Multiple consumers can process messages from the same partition
- Individual message acknowledgments
- Out-of-order processing with redelivery
- Perfect for work queue patterns

> **Note:** Share Groups are currently in preview and not yet recommended for production use.

### Enhanced Security

**JWT Bearer Token Support (KIP-1139):** Enhanced OAuth 2.0 support with JWT Bearer grant type, eliminating the need for plain-text secrets:

```properties
sasl.mechanism=OAUTHBEARER
sasl.oauthbearer.token.endpoint.url=https://auth.example.com/oauth/token
sasl.login.callback.handler.class=org.apache.kafka.common.security.oauthbearer.OAuthBearerLoginCallbackHandler
```

### Other Notable Changes

| Feature                              | Description                                                 |
| ------------------------------------ | ----------------------------------------------------------- |
| **Compatibility Baseline (KIP-896)** | Clients must be at least version 2.1 to connect             |
| **Plugin Metrics (KIP-877)**         | Plugins can implement `Monitorable` to register JMX metrics |
| **MirrorMaker 1 Removed**            | Only MirrorMaker 2 is supported                             |
| **Legacy Message Formats**           | Message formats v0/v1 no longer supported for writes        |

For the complete list of changes, refer to the [official release notes](https://kafka.apache.org/downloads).

---

## Understanding KRaft Architecture

KRaft (Kafka Raft) is Kafka's implementation of the Raft consensus protocol, adapted for event-driven metadata management.

### The Quorum Controller

In KRaft mode, a subset of nodes form a **controller quorum** that manages all cluster metadata. One controller is the **active controller** (leader), while others are **hot standbys** (followers).

```
┌─────────────────────────────────────────────────────────────────┐
│                      KRaft Architecture                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│         ┌─────────────────────────────────────────┐              │
│         │          Controller Quorum               │              │
│         │  ┌───────────┐ ┌───────────┐ ┌───────┐  │              │
│         │  │Controller1│ │Controller2│ │Ctrl 3 │  │              │
│         │  │ (Active)  │ │ (Standby) │ │(Stby) │  │              │
│         │  └─────┬─────┘ └─────┬─────┘ └───┬───┘  │              │
│         │        │             │           │       │              │
│         │        └─────────────┼───────────┘       │              │
│         │                      │                   │              │
│         │              __cluster_metadata          │              │
│         │              (Replicated Log)            │              │
│         └─────────────────────┬───────────────────┘              │
│                               │                                   │
│                               │ Metadata                          │
│                               │ Replication                       │
│                               ▼                                   │
│     ┌─────────────────────────────────────────────────┐          │
│     │                   Brokers                        │          │
│     │  ┌─────────┐    ┌─────────┐    ┌─────────┐      │          │
│     │  │Broker 1 │    │Broker 2 │    │Broker 3 │      │          │
│     │  │ Data    │    │ Data    │    │ Data    │      │          │
│     │  └─────────┘    └─────────┘    └─────────┘      │          │
│     └─────────────────────────────────────────────────┘          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### The `__cluster_metadata` Topic

All cluster metadata is stored in a special internal topic called `__cluster_metadata`. Unlike regular topics:

- It has a single partition
- Records are flushed to disk synchronously (required by Raft)
- Only controllers can write to it
- Brokers read from it to stay synchronized

Metadata is encoded as specific record types:

```
┌────────────────────────────────────────────────────────┐
│              Metadata Record Types                      │
├────────────────────────────────────────────────────────┤
│ TopicRecord         │ Topic creation/deletion          │
│ PartitionRecord     │ Partition configuration          │
│ BrokerRegistration  │ Broker joining the cluster       │
│ ProducerIdsRecord   │ Producer ID allocation           │
│ ConfigRecord        │ Dynamic configuration changes    │
│ FeatureLevelRecord  │ Feature flag updates             │
│ ... and many more                                      │
└────────────────────────────────────────────────────────┘
```

### Deployment Modes

KRaft supports two deployment modes:

#### Combined Mode (Development Only)

A single process acts as both broker and controller, refer to the [docker compose file](https://github.com/nkcoder/kafka-space/blob/main/docker/docker-compose.yml):

```properties
process.roles=broker,controller
node.id=1
```

**⚠️ Not recommended for production.** If the node fails, you lose both data serving and cluster coordination.

#### Dedicated Mode (Production)

Controllers and brokers run as separate processes, refer to the [docker compose file](https://github.com/nkcoder/kafka-space/blob/main/docker/docker-compose-cluster.yml):

```
Controllers: process.roles=controller
Brokers:     process.roles=broker
```

This provides:

- Independent scaling of controllers and brokers
- Isolation of controller resources (CPU, memory, disk I/O)
- Better fault tolerance

### Controller Sizing

For production, use an odd number of controllers (for majority voting):

| Controllers | Tolerates Failures | Recommendation      |
| ----------- | ------------------ | ------------------- |
| 1           | 0                  | Development only    |
| 3           | 1                  | Standard production |
| 5           | 2                  | High availability   |

Resource requirements for controllers are modest: approximately 5GB RAM and 5GB disk for metadata storage.

---

## Setting Up Your First KRaft Cluster

Let's set up Kafka 4.1 in two ways: a quick Docker setup for development, and a manual setup to understand the internals.

### Option 1: Docker Compose (Quick Start)

Let's use the [docker compose file](https://github.com/nkcoder/kafka-space/blob/main/docker/docker-compose.yml).

Start the cluster:

```bash
docker-compose up -d
```

Verify it's running:

```sh
docker exec -it kafka /opt/kafka/bin/kafka-metadata-quorum.sh --bootstrap-controller localhost:9093 describe --status

ClusterId:              MkU3OEVBNTcwNTJENDM2Qk
LeaderId:               1
LeaderEpoch:            1
HighWatermark:          190
MaxFollowerLag:         0
MaxFollowerLagTimeMs:   0
CurrentVoters:          [{"id": 1, "endpoints": ["CONTROLLER://localhost:9093"]}]
CurrentObservers:       []
```

### Option 2: Manual Installation

#### Step 1: Download Kafka 4.1

```bash
# Download
wget https://downloads.apache.org/kafka/4.1.1/kafka_2.13-4.1.1.tgz

# Extract
tar -xzf kafka_2.13-4.1.1.tgz
cd kafka_2.13-4.1.1
```

#### Step 2: Generate Cluster ID

```bash
KAFKA_CLUSTER_ID=$(bin/kafka-storage.sh random-uuid)
echo $KAFKA_CLUSTER_ID
```

#### Step 3: Configure the Server

Edit `config/server.properties`:

```properties
# The role of this server: broker, controller, or broker,controller
process.roles=broker,controller

# Unique node ID
node.id=1

# Controller quorum configuration (dynamic mode in 4.1)
controller.quorum.bootstrap.servers=localhost:9093

# Listeners
listeners=PLAINTEXT://:9092,CONTROLLER://:9093
advertised.listeners=PLAINTEXT://localhost:9092
controller.listener.names=CONTROLLER
listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT

# Inter-broker listener
inter.broker.listener.name=PLAINTEXT

# Log directories
log.dirs=/tmp/kraft-combined-logs
metadata.log.dir=/tmp/kraft-combined-logs

# Topic defaults
num.partitions=3
default.replication.factor=1
min.insync.replicas=1

# Log retention
log.retention.hours=168
log.segment.bytes=1073741824

# Replication factor for internal topics (set to 1 for single-node)
offsets.topic.replication.factor=1
transaction.state.log.replication.factor=1
transaction.state.log.min.isr=1
```

#### Step 4: Format Storage

```sh
bin/kafka-storage.sh format --standalone --cluster-id $KAFKA_CLUSTER_ID --config config/server.properties
Formatting dynamic metadata voter directory /tmp/kraft-combined-logs with metadata.version 4.1-IV1.
```

The `--standalone` flag sets up a dynamic quorum with this node as the initial controller.

#### Step 5: Start Kafka

```bash
bin/kafka-server-start.sh config/server.properties
```

#### Step 6: Verify

In another terminal:

```bash
# Check cluster status
bin/kafka-metadata-quorum.sh --bootstrap-controller localhost:9093 describe --status
ClusterId:              4Us5dcXYRmatGjqKrTM60w
LeaderId:               1
LeaderEpoch:            1
HighWatermark:          58
MaxFollowerLag:         0
MaxFollowerLagTimeMs:   0
CurrentVoters:          [{"id": 1, "directoryId": "5elaM5wCSASWrIOO5NLJZA", "endpoints": ["CONTROLLER://localhost:9093"]}]
CurrentObservers:       []

# Create a test topic
bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --topic test-topic --partitions 3 --replication-factor 1
Created topic test-topic.

# List topics
bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
test-topic
```

Here is a complete example: [Kafka Hello World Example with Scala 3](https://github.com/nkcoder/kafka-space/tree/main/kafka-hello-world)

## Key Takeaways

1. **Kafka 4.x is KRaft-only:** ZooKeeper has been completely removed. All new deployments use KRaft for metadata management.

2. **Simpler architecture:** One distributed system instead of two. Easier to deploy, monitor, and troubleshoot.

3. **Faster failover:** Controller failover is near-instantaneous because the new leader already has all metadata in memory.

4. **New consumer protocol:** KIP-848's server-side assignment and incremental rebalancing dramatically improve consumer group stability.

5. **Queues are coming:** Share Groups (KIP-932) bring queue semantics to Kafka, enabling new use cases.

6. **Scala works great:** The Java Kafka clients work seamlessly with Scala. Use `scala.jdk.CollectionConverters` for collection interop.

---

## References

- [Apache Kafka 4.1 Documentation](https://kafka.apache.org/41/documentation.html)
- [KIP-500: Replace ZooKeeper](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500)
- [KIP-848: The Next Generation Consumer Rebalance Protocol](https://cwiki.apache.org/confluence/display/KAFKA/KIP-848)
- [KIP-853: KRaft Controller Membership Changes](https://cwiki.apache.org/confluence/display/KAFKA/KIP-853)
- [KIP-932: Queues for Kafka](https://cwiki.apache.org/confluence/display/KAFKA/KIP-932)
- [Confluent Developer: KRaft Overview](https://developer.confluent.io/learn/kraft/)
