---
title: Kafka Docker Image
description: The differences among Kafka docker images.
date: 2025-12-05
---

# Kafka Docker Images

The Apache Kafka project provides official Docker images (introduced via **KIP-975**), offering both traditional JVM-based and experimental native-compiled versions.

## Official Image Names

The primary official repository for Apache Kafka images is `apache/kafka`. While a Docker Official Image (DOI) named simply `kafka` was proposed in **KIP-1028**, it may not yet be available or fully synchronized in all regions. Use the `apache` namespace for the most reliable access.

| Type                      | Repository            | Latest Stable Tag           |
| :------------------------ | :-------------------- | :-------------------------- |
| **JVM (Primary)**         | `apache/kafka`        | `apache/kafka:4.1.1`        |
| **Native (Experimental)** | `apache/kafka-native` | `apache/kafka-native:4.1.1` |

---

## Technical Comparison

Starting with **Kafka 4.0**, ZooKeeper has been completely removed in favor of **KRaft mode**. These official images are optimized specifically for KRaft, requiring only a few environment variables to start.

### JVM based Kafka (Traditional)

Used for production workloads where peak throughput and stability are paramount.

- **Technology**: Runs on a Java Runtime Environment (JRE) based on Eclipse Temurin (OpenJDK).
- **Execution**: Code is compiled to bytecode and JIT-compiled at runtime.
- **Benefit**: Maximum peak performance after the "warm-up" period.

### GraalVM Native Kafka (KIP-974)

Ideal for development, CI/CD, and specific architectural roles like KRaft controllers.

- **Technology**: Compiled Ahead-of-Time (AOT) to a standalone native binary using GraalVM.
- **Execution**: Runs directly as a machine executable without a JVM.
- **Benefit**: Near-instant startup (sub-50ms) and significantly lower memory footprint.

---

## Comparison Matrix (Kafka 4.x)

| Aspect                  | JVM Image (`apache/kafka`)               | Native Image (`apache/kafka-native`)       |
| :---------------------- | :--------------------------------------- | :----------------------------------------- |
| **Startup Time**        | ~10-15 seconds (JVM + Class loading)     | **Sub-second** (Typically < 50ms)          |
| **Memory Baseline**     | ~1 GB recommended (baseline ~200MB)      | **~100-200MB** total (baseline ~50MB)      |
| **Runtime Performance** | Faster peak throughput after JIT warm-up | Consistent, but peak may be slightly lower |
| **Image Size**          | ~350MB+ (includes JRE)                   | **~120MB** (standalone binary)             |
| **Architecture**        | Supports AMD64 & ARM64                   | Primarily AMD64 (ARM64 support evolving)   |
| **Maturity**            | **Production Ready**                     | **Experimental**                           |

---

## When to Use Which?

### Choose JVM-based if:

- You are running a **Production Cluster**.
- You need high-throughput brokers that run for long periods.
- You require deep profiling (JFR, Prometheus JMX Exporter) and standard debugging tools.
- You use custom plugins (Connectors, Interceptors, Quotas) that require dynamic loading.

### Choose Native-based if:

- **Local Development**: Near-instant `docker-compose up` cycles.
- **CI/CD / Testing**: Spinning up multiple Kafka instances for integration tests.
- **KRaft Controllers**: In small clusters, dedicated controllers benefit from fast recovery and low CPU/memory overhead.
- **Serverless / Edge**: Environments with strict resource constraints and cold-start sensitivity.

> [!IMPORTANT]
> **Kafka 4.x is KRaft-only.** These images do not support ZooKeeper. For ZooKeeper-based deployments, you must use Kafka 3.x images from third parties like Bitnami or Confluent.
