---
title: Docker Performance & Troubleshooting
description: Understanding resource management, performance tunning and systematic debugging for dockers running in production.
---

# Docker Performance & Troubleshooting

Running containers in production requires understanding resource management, performance tuning, and systematic debugging. In production environments, you don't run containers directly with `docker run`—orchestrators like AWS ECS Fargate or Kubernetes handle container lifecycle. This guide covers practical techniques for both local development and production environments.

## Resource Management

### Local Development vs Production

```
┌─────────────────────────────────────────────────────────────────────┐
│ Resource Management: Where It's Configured                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Local Development              Production                         │
│   ┌─────────────────────-┐       ┌─────────────────────────────┐   │
│   │                      │       │                             │   │
│   │  docker run          │       │  ECS Task Definition        │   │
│   │    --memory=512m     │       │    "memory": 512            │   │
│   │    --cpus=2          │       │    "cpu": 256               │   │
│   │                      │       │                             │   │
│   │  docker-compose.yml  │       │  Kubernetes Pod Spec        │   │
│   │    deploy:           │       │    resources:               │   │
│   │      resources:      │       │      limits:                │   │
│   │        limits:       │       │        memory: "512Mi"      │   │
│   │          memory: 512M│       │        cpu: "2"             │   │
│   │                      │       │                             │   │
│   └─────────────────────-┘       └─────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### AWS ECS Fargate Resource Configuration

In ECS Fargate, resources are defined in the **Task Definition**:

```json
{
  "family": "my-go-service",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "123456789.dkr.ecr.us-east-1.amazonaws.com/my-go-service:v1.2.3",
      "cpu": 512,
      "memory": 1024,
      "memoryReservation": 512,
      "essential": true,
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ]
    }
  ]
}
```

**Fargate CPU/Memory combinations:**

| CPU (units)    | Memory (MB) options           |
| -------------- | ----------------------------- |
| 256 (.25 vCPU) | 512, 1024, 2048               |
| 512 (.5 vCPU)  | 1024 - 4096 (1GB increments)  |
| 1024 (1 vCPU)  | 2048 - 8192 (1GB increments)  |
| 2048 (2 vCPU)  | 4096 - 16384 (1GB increments) |
| 4096 (4 vCPU)  | 8192 - 30720 (1GB increments) |

**Note:** 1024 CPU units = 1 vCPU

### Kubernetes Resource Configuration

In Kubernetes, resources are defined in the **Pod spec**:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-go-service
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api
          image: my-go-service:v1.2.3
          resources:
            requests:
              memory: '256Mi'
              cpu: '250m'
            limits:
              memory: '512Mi'
              cpu: '1000m'
          ports:
            - containerPort: 8080
```

**Understanding Kubernetes resources:**

| Setting           | Description                             |
| ----------------- | --------------------------------------- |
| `requests.cpu`    | Guaranteed CPU (used for scheduling)    |
| `requests.memory` | Guaranteed memory (used for scheduling) |
| `limits.cpu`      | Maximum CPU (throttled if exceeded)     |
| `limits.memory`   | Maximum memory (OOM killed if exceeded) |

**CPU units:** `1000m` = 1 CPU core, `250m` = 0.25 CPU core

### Docker Compose (Local Development)

```yaml
# docker-compose.yml
services:
  api:
    build: .
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
    ports:
      - '8080:8080'
```

### Memory Limit Behavior

What happens when a container exceeds its memory limit is the same regardless of where it runs:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Memory Limit Behavior                                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Container memory usage increases...                               │
│                                                                     │
│   ┌─────────────────────────────────────────────────┐              │
│   │████████████████████████████████████████████████│ 100% - limit  │
│   └─────────────────────────────────────────────────┘              │
│                          │                                          │
│                          ▼                                          │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ OOM Killer terminates the container                         │  │
│   │                                                             │  │
│   │ • ECS: Task stops, service scheduler starts new task        │  │
│   │ • Kubernetes: Pod restarts (based on restartPolicy)         │  │
│   │ • Exit code: 137 (128 + SIGKILL)                           │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### CPU Throttling

When a container exceeds its CPU limit, it's **throttled** (not killed):

```
┌─────────────────────────────────────────────────────────────────────┐
│ CPU Throttling                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Container requests more CPU than its limit...                     │
│                                                                     │
│   Container wants:  ████████████████████ (4 CPU)                   │
│   Container limit:  ██████████ (2 CPU)                             │
│   Container gets:   ██████████ (2 CPU - throttled)                 │
│                                                                     │
│   Result: Process runs slower, but keeps running                    │
│   Symptoms: Increased latency, slower response times               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Go Applications in Containers

### GOMAXPROCS Issue

By default, Go sets `GOMAXPROCS` to the number of CPUs visible to the process. In containers, this might be the host's CPU count, not your container's limit.

```
┌─────────────────────────────────────────────────────────────────────┐
│ GOMAXPROCS Problem                                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Host: 8 CPU cores                                                 │
│   Container limit: --cpus=2                                         │
│                                                                     │
│   Go app sees: runtime.NumCPU() = 8                                 │
│   Go sets: GOMAXPROCS = 8                                           │
│                                                                     │
│   Result: 8 OS threads competing for 2 cores worth of CPU time      │
│           = excessive context switching, poor performance           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Solution 1: Set GOMAXPROCS Manually

```dockerfile
FROM golang:1.25-alpine AS builder
# ... build steps ...

FROM scratch
COPY --from=builder /app /app
ENV GOMAXPROCS=2
ENTRYPOINT ["/app"]
```

Or at runtime:

```bash
$ docker run -d --cpus=2 -e GOMAXPROCS=2 myapp
```

### Solution 2: Use automaxprocs (Recommended)

The `automaxprocs` library automatically sets `GOMAXPROCS` based on container CPU limits:

```go
package main

import (
    _ "go.uber.org/automaxprocs" // Automatically set GOMAXPROCS
    "log"
    "runtime"
)

func main() {
    log.Printf("GOMAXPROCS: %d", runtime.GOMAXPROCS(0))
    // With --cpus=2, this will print: GOMAXPROCS: 2

    // ... rest of your application
}
```

```bash
go get go.uber.org/automaxprocs
```

**Why automaxprocs is better:**

- Works with fractional CPUs (`--cpus=1.5`)
- Handles CPU quota changes dynamically
- No manual configuration needed
- Logs the detected value at startup

### Memory Considerations for Go

Go's garbage collector works well in containers, but be aware:

```go
// Set memory limit hint for GC (Go 1.19+)
// GOMEMLIMIT tells Go how much memory is available
// Set to ~90% of container limit to leave room for non-heap memory

// In container with --memory=512m
// Set GOMEMLIMIT=460MiB (90% of 512MB)
```

```dockerfile
ENV GOMEMLIMIT=460MiB
```

Or use `automaxprocs` sister library `automaticenv`:

```go
import _ "go.uber.org/automaxprocs"
// GOMEMLIMIT is automatically detected in Go 1.19+
```

## Monitoring Container Resources

### Local Development: docker stats

For local development, use `docker stats`:

```bash
$ docker stats

CONTAINER ID   NAME   CPU %     MEM USAGE / LIMIT   MEM %    NET I/O          BLOCK I/O
a1b2c3d4e5f6   api    25.50%    256MiB / 512MiB     50.00%   1.2MB / 500KB    0B / 0B
b2c3d4e5f6a1   db     5.25%     128MiB / 256MiB     50.00%   500KB / 1.1MB    10MB / 5MB

# Single container, no stream
$ docker stats --no-stream api

# Format output
$ docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

### Production Monitoring Setup

#### CloudWatch Container Insights (ECS)

Enable Container Insights for your cluster:

```bash
$ aws ecs update-cluster-settings \
    --cluster production-cluster \
    --settings name=containerInsights,value=enabled
```

#### Prometheus + Grafana (Kubernetes)

Deploy metrics collection:

```yaml
# ServiceMonitor for Prometheus
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-go-service
spec:
  selector:
    matchLabels:
      app: my-go-service
  endpoints:
    - port: metrics
      path: /metrics
      interval: 30s
```

### Key Metrics to Monitor

| Metric                | Warning Threshold | Action                      |
| --------------------- | ----------------- | --------------------------- |
| CPU Utilization       | > 80% sustained   | Scale out or increase CPU   |
| Memory Utilization    | > 80% of limit    | Increase limit or fix leak  |
| Restart Count         | > 0               | Check logs for crash reason |
| Request Latency (p99) | > SLA threshold   | Profile application         |
| Error Rate            | > 1%              | Check logs, investigate     |

## Logging Best Practices

### Logging Drivers

Docker supports multiple logging drivers:

```bash
# View current logging driver
$ docker info | grep "Logging Driver"
 Logging Driver: json-file

# Run container with specific driver
$ docker run -d --log-driver=json-file --log-opt max-size=10m --log-opt max-file=3 myapp
```

**Common logging drivers:**

| Driver      | Description                  | Use Case                               |
| ----------- | ---------------------------- | -------------------------------------- |
| `json-file` | Default, writes JSON to disk | Development, simple setups             |
| `local`     | Optimized local logging      | Production single-host                 |
| `syslog`    | Send to syslog               | Integration with syslog infrastructure |
| `journald`  | Send to systemd journal      | Systemd-based systems                  |
| `awslogs`   | Send to CloudWatch           | AWS deployments                        |
| `gcplogs`   | Send to Google Cloud Logging | GCP deployments                        |
| `fluentd`   | Send to Fluentd              | Centralized logging                    |

### Preventing Disk Fill with Log Rotation

Without limits, container logs can fill your disk:

```bash
# Configure log rotation (recommended for production)
$ docker run -d \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    myapp
```

Set defaults in daemon configuration:

```json
// /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

### Structured Logging

For production, use structured JSON logging:

```go
// Go application - structured logging
import "log/slog"

func main() {
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
    slog.SetDefault(logger)

    slog.Info("server started",
        "port", 8080,
        "environment", os.Getenv("APP_ENV"),
    )
}
```

Output:

```json
{ "time": "2025-01-15T10:00:00Z", "level": "INFO", "msg": "server started", "port": 8080, "environment": "production" }
```

Benefits:

- Parseable by log aggregation systems
- Searchable and filterable
- Consistent format across services

## Debugging Techniques

### Local Development Debugging

For local development with `docker` or `docker compose`:

```bash
# View logs
$ docker logs -f --tail 100 mycontainer

# Interactive shell
$ docker exec -it mycontainer sh

# Inspect container state
$ docker inspect --format='{{.State.ExitCode}}' mycontainer
```

### Production Debugging Commands

| Task           | ECS Fargate                                                 | Kubernetes                             |
| -------------- | ----------------------------------------------------------- | -------------------------------------- |
| View logs      | `aws logs tail /ecs/service --follow`                       | `kubectl logs -f pod-name`             |
| Shell access   | `aws ecs execute-command --interactive --command "/bin/sh"` | `kubectl exec -it pod-name -- /bin/sh` |
| Check restarts | `aws ecs describe-tasks`                                    | `kubectl describe pod`                 |
| Resource usage | CloudWatch Container Insights                               | `kubectl top pod`                      |
| Previous logs  | CloudWatch Logs history                                     | `kubectl logs --previous`              |

### Debugging Crashed Containers

When a container crashes and restarts, you need to see what happened:

**Local Docker:**

```bash
# View logs from exited container
$ docker logs mycontainer

# Create debug image from stopped container
$ docker commit mycontainer debug-image
$ docker run -it --entrypoint sh debug-image

# Run with entrypoint override
$ docker run -it --entrypoint sh myapp
```

**ECS Fargate:**

```bash
# Check stopped task reason
$ aws ecs describe-tasks \
    --cluster production-cluster \
    --tasks arn:aws:ecs:us-east-1:123456789:task/abc123 \
    --query 'tasks[0].stoppedReason'

# View logs from stopped task (logs persist in CloudWatch)
$ aws logs get-log-events \
    --log-group-name /ecs/my-go-service \
    --log-stream-name ecs/api/abc123
```

**Kubernetes:**

```bash
# Logs from previous crashed container
$ kubectl logs my-pod --previous

# Describe pod for events
$ kubectl describe pod my-pod

# Check exit code
$ kubectl get pod my-pod -o jsonpath='{.status.containerStatuses[0].lastState.terminated.exitCode}'
```

### Network Debugging in Production

**Problem:** Service can't reach another service or external endpoint.

**ECS Fargate:**

```bash
# Use ECS Exec to debug networking
$ aws ecs execute-command \
    --cluster production-cluster \
    --task abc123 \
    --container debug \
    --interactive \
    --command "nslookup other-service.local"

# Check security groups
$ aws ec2 describe-security-groups --group-ids sg-xxx
```

**Kubernetes:**

```bash
# Run network debug pod
$ kubectl run netshoot --rm -it --image=nicolaka/netshoot -- bash

# From inside:
$ nslookup my-service
$ curl http://my-service:8080/health
$ tcpdump -i eth0 port 8080
```

## Common Issues and Solutions

### OOM Killed Container

**Symptoms:** Container restarts unexpectedly, exit code 137.

**Local Docker:**

```bash
$ docker inspect --format='{{.State.OOMKilled}}' mycontainer
true
```

**ECS Fargate:**

```bash
$ aws ecs describe-tasks --cluster my-cluster --tasks abc123 \
    --query 'tasks[0].stoppedReason'
"OutOfMemoryError: Container killed due to memory usage"
```

**Kubernetes:**

```bash
$ kubectl describe pod my-pod | grep -A5 "Last State"
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
```

**Solutions:**

| Approach              | How                                                                           |
| --------------------- | ----------------------------------------------------------------------------- |
| Increase memory limit | ECS: Update task definition memory<br>K8s: Increase `resources.limits.memory` |
| Fix memory leak       | Profile application, check for goroutine leaks                                |
| Tune Go GC            | Set `GOMEMLIMIT` to ~90% of container limit                                   |
| Add memory monitoring | Alert before OOM at 80% threshold                                             |

### Slow Container Performance

**Symptoms:** High latency, slow response times.

**Diagnose:**

```bash
# ECS: Check CloudWatch metrics
$ aws cloudwatch get-metric-statistics \
    --namespace ECS/ContainerInsights \
    --metric-name CpuUtilized \
    --dimensions Name=ServiceName,Value=my-service ...

# Kubernetes: Check resource usage
$ kubectl top pod my-pod
NAME     CPU(cores)   MEMORY(bytes)
my-pod   980m         450Mi         # Near 1000m (1 CPU) limit = throttled!
```

**Common causes and solutions:**

| Cause               | Symptom                    | Solution                                             |
| ------------------- | -------------------------- | ---------------------------------------------------- |
| CPU throttling      | CPU at limit               | Increase CPU limit                                   |
| GOMAXPROCS mismatch | High CPU, poor performance | Use `automaxprocs`                                   |
| Memory pressure     | Near memory limit          | Increase memory or optimize                          |
| Network latency     | Slow external calls        | Check DNS, connection pooling                        |
| Cold starts         | Slow first requests        | Use provisioned concurrency (Lambda) or min replicas |

### Container Keeps Restarting

**Symptoms:** CrashLoopBackOff (K8s), task keeps stopping (ECS).

**Diagnose:**

```bash
# Kubernetes
$ kubectl describe pod my-pod
# Look at Events section

$ kubectl logs my-pod --previous
# Logs from the crashed container

# ECS
$ aws ecs describe-tasks --cluster my-cluster --tasks abc123
# Check stoppedReason

$ aws logs tail /ecs/my-service --since 1h
```

**Common causes:**

| Exit Code | Meaning           | Common Fix                                     |
| --------- | ----------------- | ---------------------------------------------- |
| 1         | Application error | Check logs, fix bug                            |
| 127       | Command not found | Check ENTRYPOINT/CMD, image build              |
| 137       | OOM killed        | Increase memory limit                          |
| 143       | SIGTERM           | Graceful shutdown issue, check signal handling |

### Health Check Failures

**Symptoms:** Container marked unhealthy, removed from load balancer.

**ECS:**

```bash
# Check task health
$ aws ecs describe-tasks --cluster my-cluster --tasks abc123 \
    --query 'tasks[0].containers[0].healthStatus'

# Check target group health (ALB)
$ aws elbv2 describe-target-health --target-group-arn arn:aws:...
```

**Kubernetes:**

```bash
# Check probe status
$ kubectl describe pod my-pod | grep -A10 "Liveness\|Readiness"

# Common issues:
# - Probe timeout too short
# - Wrong port or path
# - App not ready at startup (increase initialDelaySeconds)
```

**Task Definition health check example:**

```json
{
  "healthCheck": {
    "command": ["CMD-SHELL", "wget -q --spider http://localhost:8080/health || exit 1"],
    "interval": 30,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 60
  }
}
```

**Key settings:**

- `startPeriod`: Grace period for app startup (set higher for slow-starting apps)
- `timeout`: Must be less than `interval`
- `retries`: Number of failures before marking unhealthy

### Networking Issues

**Symptoms:** Service can't reach other services or external endpoints.

**ECS Fargate checklist:**

1. Check security groups allow traffic
2. Check VPC routing (NAT Gateway for internet access)
3. Check service discovery configuration
4. Use ECS Exec to debug from inside container

**Kubernetes checklist:**

1. Check NetworkPolicies
2. Check Service and Endpoint objects exist
3. Check DNS resolution (`nslookup service-name`)
4. Check pod is Ready (passing readiness probe)

## Troubleshooting Decision Tree

```
┌─────────────────────────────────────────────────────────────────────┐
│ Production Container Troubleshooting                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Container keeps restarting?                                       │
│          │                                                          │
│          ▼                                                          │
│   Check logs (CloudWatch / kubectl logs --previous)                 │
│          │                                                          │
│          ├── Exit code 137?                                         │
│          │      └── OOM killed → Increase memory limit              │
│          │                                                          │
│          ├── Exit code 1?                                           │
│          │      └── App error → Fix bug, check config               │
│          │                                                          │
│          └── Exit code 143?                                         │
│                 └── SIGTERM → Check graceful shutdown handling      │
│                                                                     │
│   ─────────────────────────────────────────────────────────────     │
│                                                                     │
│   Slow performance?                                                 │
│          │                                                          │
│          ▼                                                          │
│   Check metrics (Container Insights / kubectl top)                  │
│          │                                                          │
│          ├── CPU at limit?                                          │
│          │      └── Throttled → Increase CPU or optimize code       │
│          │                                                          │
│          ├── Memory near limit?                                     │
│          │      └── GC pressure → Increase limit or tune GOMEMLIMIT │
│          │                                                          │
│          └── Resources OK?                                          │
│                 └── Check latency → Profile app, check dependencies │
│                                                                     │
│   ─────────────────────────────────────────────────────────────     │
│                                                                     │
│   Health check failing?                                             │
│          │                                                          │
│          ▼                                                          │
│   Check health endpoint manually (ECS Exec / kubectl exec)          │
│          │                                                          │
│          ├── Endpoint not responding?                               │
│          │      └── App not started → Increase startPeriod          │
│          │                                                          │
│          ├── Timeout?                                               │
│          │      └── Slow response → Increase timeout or optimize   .|
│          │                                                          │
│          └── Wrong port/path?                                       │
│                 └── Fix health check configuration                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Cheatsheet

### Resource Configuration

**ECS Fargate Task Definition:**

```json
{
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "api",
      "cpu": 512,
      "memory": 1024
    }
  ]
}
```

**Kubernetes Pod Spec:**

```yaml
resources:
  requests:
    memory: '256Mi'
    cpu: '250m'
  limits:
    memory: '512Mi'
    cpu: '1000m'
```

**Docker Compose:**

```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 512M
```

### Debugging Commands

**ECS Fargate:**

```bash
# Shell into container
aws ecs execute-command --cluster CLUSTER --task TASK \
    --container CONTAINER --interactive --command "/bin/sh"

# View logs
aws logs tail /ecs/SERVICE --follow

# Check stopped reason
aws ecs describe-tasks --cluster CLUSTER --tasks TASK
```

**Kubernetes:**

```bash
# Shell into container
kubectl exec -it POD -c CONTAINER -- /bin/sh

# View logs (including crashed)
kubectl logs POD --previous

# Check pod status
kubectl describe pod POD

# Resource usage
kubectl top pod POD
```

### Go Application Tuning

```dockerfile
# Match GOMAXPROCS to CPU limit
ENV GOMAXPROCS=2

# Set memory limit hint for GC (90% of container limit)
ENV GOMEMLIMIT=450MiB
```

```go
// Recommended: auto-detect from cgroup limits
import _ "go.uber.org/automaxprocs"
```

### Common Exit Codes

| Code | Signal  | Meaning       | Action                |
| ---- | ------- | ------------- | --------------------- |
| 0    | -       | Success       | Normal                |
| 1    | -       | App error     | Check logs            |
| 137  | SIGKILL | OOM killed    | Increase memory       |
| 143  | SIGTERM | Graceful stop | Check signal handling |

### Health Check Configuration

**ECS:**

```json
{
  "healthCheck": {
    "command": ["CMD-SHELL", "wget -q --spider http://localhost:8080/health || exit 1"],
    "interval": 30,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 60
  }
}
```

**Kubernetes:**

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 60
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3
```

---

## Further Reading

- [AWS ECS Exec](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html)
- [CloudWatch Container Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html)
- [Kubernetes Debugging](https://kubernetes.io/docs/tasks/debug/)
- [automaxprocs Library](https://github.com/uber-go/automaxprocs)
