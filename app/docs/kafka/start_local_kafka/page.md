---
title: Start local Kafka
description: How to start a local Kafka instance using Docker for development and testing purposes.
---

## Get Kafka

```sh
$ tar -xzf kafka_2.13-4.0.0.tgz
$ cd kafka_2.13-4.0.0
```

## Start kafka using Docker

Make sure we have Java 17+ installed and Docker running on our local environment:

```sh
$ java -version
java version "21.0.1" 2023-10-17 LTS
Java(TM) SE Runtime Environment (build 21.0.1+12-LTS-29)
Java HotSpot(TM) 64-Bit Server VM (build 21.0.1+12-LTS-29, mixed mode, sharing)
```

For local testing, we'll use the `kafka-native` Docker image which has smaller image size, faster startup time and lower memory usage.
Use the following docker-compose file to start Kafka:

```yml
services:
  broker:
    image: apache/kafka-native:4.0.0
    container_name: broker
    ports:
      - 9092:9092
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@localhost:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0
      KAFKA_NUM_PARTITIONS: 3
```

```sh
$ docker compose up -d
```

## Create a topic

```sh
bin/kafka-topics.sh --create --topic test-topic --bootstrap-server localhost:9092
```

## Start a producer

```sh
$ bin/kafka-console-producer.sh --topic test-topic --bootstrap-server localhost:9092
>
```

List details about the topic we just created:

```sh
$ bin/kafka-topics.sh --describe --topic test-topic --bootstrap-server localhost:9092
Topic: test-topic	TopicId: CAaCzhNrQNif_7_k_kjITw	PartitionCount: 1	ReplicationFactor: 1	Configs: segment.bytes=1073741824
Topic: test-topic	Partition: 0	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr:
```

## Start consumers

Open two terminal windows and start two consumers in each:

```sh
$ bin/kafka-console-consumer.sh --topic test-topic --from-beginning --bootstrap-server localhost:9092
```

In the topic producer terminal, if we type some messages, they will be consumed by both consumers in the other terminals.

```sh
$ bin/kafka-console-producer.sh --topic test-topic --bootstrap-server localhost:9092
>test message 1
>test message 2
>test message 3
```

```sh
$ bin/kafka-console-consumer.sh --topic test-topic --from-beginning --bootstrap-server localhost:9092
test message 1
test message 2
test message 3
```

## Stop Kafka

To stop the Kafka instance, we can use the following command:

```sh
$ docker compose down
```

For producers and consumers, we can use `Ctrl+C` to stop them gracefully.

## Appendix: Difference between JVM based and GraalVM based Kafka Docker images

The difference lies in how the Kafka application is compiled and executed. 

### JVM based Kafka (traditional)

- Kafka is written in Scala/Java and runs on the Java Virtual Machine (JVM)
- Docker image includes JVM + Kafka JAR files
- Code is compiled to bytecode, then JIT-compiled at runtime

### GraalVM native Kafka

- Uses GraalVM's native-image compiler
- Kafka is compiled ahead-of-time (AOT) to native machine code
- Produces a standalone executable (no JVM required)

### Key Differences

# JVM vs Native Image Comparison

| Aspect | JVM | Native |
|--------|-----|--------|
| **Startup Time** | 10-30+ seconds startup time<br>• JVM initialization<br>• Class loading<br>• JIT warm-up | Sub-second startup (typically 50-200ms)<br>• Direct executable launch<br>• No JVM overhead |
| **Memory Usage** | Higher memory footprint<br>• JVM overhead (~100-200MB baseline)<br>• Heap space allocation<br>• JIT compiler memory | Lower memory footprint<br>• No JVM overhead<br>• More predictable memory usage<br>• Better for resource-constrained environments |
| **Runtime Performance** | • Slower initial performance<br>• Gets faster after JIT warm-up<br>• Peak performance can be excellent | • Consistent performance from start<br>• No warm-up period<br>• Peak performance may be lower than optimized JVM |
| **Image Size** | Larger images<br>• Full JVM runtime<br>• All Java libraries<br>• Typically 300MB-1GB+ | Smaller images<br>• Only necessary code compiled in<br>• Typically 50-200MB |
| **Development & Debugging** | Full ecosystem support<br>• Rich debugging tools<br>• Profiling tools<br>• Dynamic class loading | Limited tooling<br>• Debugging more challenging<br>• No dynamic class loading<br>• Static analysis required |
| **When to use** | <br>• Production systems with steady workloads <br>• Need maximum throughput after warm-up <br>• Long-running brokers <br>• Requires full debugging/profiling capabilities  | <br>• Serverless/FaaS environments <br>• Microservices with frequent restarts <br>• CI/CD pipelines (faster test cycles) <br>• Development/testing (faster iteration) <br>• Resource-constraint environments |