---
title: Docker Internal
description: Docker Internals - Understanding Containers from the Ground Up
---

# Docker Internals: Understanding Containers from the Ground Up

Understanding what happens under the hood transforms Docker from a "magic black box" into a predictable tool you can debug, optimize, and reason about. This guide covers the core concepts that power containerization—essential knowledge for troubleshooting production issues and technical interviews.

## Why Containers? The Problems They Solve

Before containers, deploying applications was fraught with challenges:

**"Works on my machine"** — An application runs perfectly in development but fails in production due to different OS versions, library versions, or configurations.

**Dependency conflicts** — Application A needs Python 3.8, Application B needs Python 3.11. Installing both on the same server creates conflicts.

**Environment inconsistency** — Development, staging, and production environments drift apart over time, causing unexpected failures.

**Resource inefficiency** — Running each application in its own VM wastes resources. A simple API doesn't need a full operating system.

**Slow deployment** — VMs take minutes to boot. Scaling up during traffic spikes is too slow.

Containers solve these by packaging an application with its dependencies into a standardized, isolated unit that runs consistently anywhere.

## Containers vs Virtual Machines

This is a fundamental concept that's often oversimplified. Let's look at what's actually different.

### Architecture Comparison

```
┌─────────────────────────────────────────────────────────────────────┐
│ Virtual Machines                                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                   │
│  │    App A    │ │    App B    │ │    App C    │                   │
│  ├─────────────┤ ├─────────────┤ ├─────────────┤                   │
│  │   Bins/Libs │ │   Bins/Libs │ │   Bins/Libs │                   │
│  ├─────────────┤ ├─────────────┤ ├─────────────┤                   │
│  │  Guest OS   │ │  Guest OS   │ │  Guest OS   │  ← Full OS each   │
│  │  (Linux)    │ │  (Windows)  │ │  (Linux)    │    (GB of RAM)    │
│  └─────────────┘ └─────────────┘ └─────────────┘                   │
│  ┌─────────────────────────────────────────────┐                   │
│  │              Hypervisor                      │  ← Hardware       │
│  │         (VMware, KVM, Hyper-V)              │    virtualization │
│  └─────────────────────────────────────────────┘                   │
│  ┌─────────────────────────────────────────────┐                   │
│  │              Host OS                         │                   │
│  └─────────────────────────────────────────────┘                   │
│  ┌─────────────────────────────────────────────┐                   │
│  │              Hardware                        │                   │
│  └─────────────────────────────────────────────┘                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Containers                                                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                   │
│  │    App A    │ │    App B    │ │    App C    │                   │
│  ├─────────────┤ ├─────────────┤ ├─────────────┤                   │
│  │   Bins/Libs │ │   Bins/Libs │ │   Bins/Libs │  ← Only app deps  │
│  └─────────────┘ └─────────────┘ └─────────────┘                   │
│  ┌─────────────────────────────────────────────┐                   │
│  │           Container Runtime                  │  ← Process        │
│  │           (containerd, runc)                │    isolation      │
│  └─────────────────────────────────────────────┘                   │
│  ┌─────────────────────────────────────────────┐                   │
│  │              Host OS (Linux)                 │  ← Shared kernel  │
│  └─────────────────────────────────────────────┘                   │
│  ┌─────────────────────────────────────────────┐                   │
│  │              Hardware                        │                   │
│  └─────────────────────────────────────────────┘                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Differences Explained

| Aspect          | Virtual Machines            | Containers                 |
| --------------- | --------------------------- | -------------------------- |
| Isolation level | Hardware-level (hypervisor) | OS-level (kernel features) |
| Guest OS        | Full OS per VM              | Shared host kernel         |
| Startup time    | Minutes                     | Seconds (often < 1s)       |
| Memory overhead | GBs per VM                  | MBs per container          |
| Disk footprint  | GBs per VM                  | MBs per container          |
| Density         | 10s per host                | 100s-1000s per host        |

**Why VMs are slower:** When a VM boots, it goes through the entire OS boot sequence—BIOS, bootloader, kernel initialization, init system, services. A container simply starts a process; the kernel is already running.

**Why containers use less memory:** A VM runs a complete OS kernel, system services (init, logging, networking daemons), and then your application. A container is just your application process—the kernel and system services are shared with the host.

### Isolation and Security Trade-offs

VMs provide **stronger isolation** because each VM has its own kernel. A kernel vulnerability in one VM doesn't affect others. Containers share the host kernel, so a kernel exploit could potentially escape the container.

However, containers have improved significantly:

- **Seccomp** restricts which system calls containers can make
- **AppArmor/SELinux** provides mandatory access control
- **User namespaces** map container root to unprivileged host user
- **Read-only filesystems** prevent runtime modification

**Production reality:** Most organizations run containers inside VMs in production. You get VM-level isolation between tenants or environments, with container efficiency within each VM. AWS ECS, GKE, and EKS all run containers on VM instances.

### When to Choose Each

| Use Case                                  | Choose                             |
| ----------------------------------------- | ---------------------------------- |
| Multi-tenant with untrusted workloads     | VMs (stronger isolation)           |
| Running different operating systems       | VMs (containers share host kernel) |
| Legacy applications requiring specific OS | VMs                                |
| Microservices, stateless applications     | Containers                         |
| High-density deployments                  | Containers                         |
| Rapid scaling, CI/CD pipelines            | Containers                         |
| Development environments                  | Containers                         |

## The Three Pillars of Containers

Containers are not a single technology but a combination of Linux kernel features working together:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Container = Namespaces + Cgroups + Union Filesystem                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Namespaces          Cgroups              Union Filesystem          │
│  ┌────────────┐     ┌────────────┐       ┌────────────┐            │
│  │ Isolation  │     │ Resource   │       │ Layered    │            │
│  │            │     │ Limits     │       │ Filesystem │            │
│  │ • PID      │     │            │       │            │            │
│  │ • Network  │     │ • CPU      │       │ • Image    │            │
│  │ • Mount    │     │ • Memory   │       │   layers   │            │
│  │ • User     │     │ • I/O      │       │ • Copy-on  │            │
│  │ • UTS      │     │ • PIDs     │       │   -write   │            │
│  │ • IPC      │     │            │       │            │            │
│  └────────────┘     └────────────┘       └────────────┘            │
│                                                                     │
│  "What can I see?"  "How much can      "What files do              │
│                      I use?"            I have?"                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Linux Namespaces: Process Isolation

Namespaces provide isolation by giving each container its own view of system resources. A process inside a namespace cannot see or affect processes in other namespaces.

### Namespace Types

| Namespace  | Isolates                    | Effect                                                        |
| ---------- | --------------------------- | ------------------------------------------------------------- |
| **PID**    | Process IDs                 | Container sees only its own processes; PID 1 inside container |
| **NET**    | Network stack               | Own network interfaces, IP addresses, ports, routing tables   |
| **MNT**    | Mount points                | Own filesystem view, mount points                             |
| **UTS**    | Hostname                    | Own hostname and domain name                                  |
| **IPC**    | Inter-process communication | Own shared memory, semaphores, message queues                 |
| **USER**   | User/group IDs              | Map container root (UID 0) to unprivileged host user          |
| **Cgroup** | Cgroup root                 | Own view of cgroup hierarchy                                  |

### PID Namespace in Action

The PID namespace is easiest to understand. Inside a container, processes have their own PID numbering starting from 1:

```bash
# On the host - see all processes
$ ps aux | head -5
USER       PID  ...  COMMAND
root         1  ...  /sbin/init
root         2  ...  [kthreadd]
root       947  ...  /usr/bin/containerd
root     15823  ...  /app/server        ← Container's main process

# Inside the container - only see container processes
$ docker exec mycontainer ps aux
USER       PID  ...  COMMAND
app          1  ...  /app/server        ← Same process, but PID 1 inside
app         15  ...  ps aux
```

The container's main process is PID 1 inside the container but has a different PID (15823) on the host. The container cannot see or signal processes outside its namespace.

**Why PID 1 matters:** In Linux, PID 1 is special—it's the init process responsible for reaping zombie processes. If your container's PID 1 doesn't handle this, zombie processes can accumulate. This is why running your app with exec form in Dockerfile is important (see Blog 2).

### Network Namespace in Action

Each container gets its own network stack:

```bash
# Host network interfaces
$ ip link show
1: lo: <LOOPBACK,UP> ...
2: eth0: <BROADCAST,MULTICAST,UP> ...
3: docker0: <BROADCAST,MULTICAST,UP> ...

# Container network interfaces (completely separate)
$ docker exec mycontainer ip link show
1: lo: <LOOPBACK,UP> ...
47: eth0@if48: <BROADCAST,MULTICAST,UP> ...    ← Virtual interface
```

The container has its own `eth0` that's actually a virtual ethernet pair (veth) connected to the Docker bridge. It has its own IP address, routing table, and port space—that's why multiple containers can all listen on port 8080 internally.

### Viewing Namespaces

You can inspect namespaces of running containers:

```bash
# Get the container's main process PID on the host
$ docker inspect --format '{{.State.Pid}}' mycontainer
15823

# View its namespaces
$ ls -la /proc/15823/ns/
lrwxrwxrwx 1 root root 0 Dec 10 10:00 cgroup -> 'cgroup:[4026532513]'
lrwxrwxrwx 1 root root 0 Dec 10 10:00 ipc -> 'ipc:[4026532445]'
lrwxrwxrwx 1 root root 0 Dec 10 10:00 mnt -> 'mnt:[4026532443]'
lrwxrwxrwx 1 root root 0 Dec 10 10:00 net -> 'net:[4026532448]'
lrwxrwxrwx 1 root root 0 Dec 10 10:00 pid -> 'pid:[4026532446]'
lrwxrwxrwx 1 root root 0 Dec 10 10:00 user -> 'user:[4026531837]'
lrwxrwxrwx 1 root root 0 Dec 10 10:00 uts -> 'uts:[4026532444]'
```

Each namespace has an inode number. Processes with the same inode share that namespace.

## Control Groups (cgroups): Resource Limits

While namespaces control what a container can **see**, cgroups control what it can **use**. Without cgroups, a container could consume all host CPU and memory, affecting other containers.

### What Cgroups Control

| Resource    | What It Limits                    |
| ----------- | --------------------------------- |
| **CPU**     | CPU time, which cores to use      |
| **Memory**  | RAM usage, swap usage             |
| **I/O**     | Disk read/write bandwidth         |
| **PIDs**    | Maximum number of processes       |
| **Network** | Bandwidth (with additional tools) |

### cgroups v1 vs v2

Linux has two versions of cgroups:

| Aspect           | cgroups v1                                | cgroups v2                            |
| ---------------- | ----------------------------------------- | ------------------------------------- |
| Structure        | Multiple hierarchies (one per controller) | Single unified hierarchy              |
| Configuration    | Scattered across multiple directories     | Single directory tree                 |
| Pressure metrics | Limited                                   | Full PSI (Pressure Stall Information) |
| Default in       | Older systems, some distros               | Ubuntu 21.10+, Fedora 31+, RHEL 9+    |

**Current state:** cgroups v2 is now the default in most modern Linux distributions. Docker supports both, with v2 providing better resource monitoring and control.

### How Docker Uses Cgroups

When you set resource limits with `docker run`:

```bash
docker run --memory=512m --cpus=2 myapp
```

Docker creates a cgroup for the container and writes limits to cgroup files:

```bash
# Find the container's cgroup (cgroups v2)
$ docker inspect --format '{{.Id}}' mycontainer
a1b2c3d4e5f6...

# View memory limit (cgroups v2 unified hierarchy)
$ cat /sys/fs/cgroup/docker/a1b2c3d4e5f6*/memory.max
536870912    # 512MB in bytes

# View CPU limit
$ cat /sys/fs/cgroup/docker/a1b2c3d4e5f6*/cpu.max
200000 100000    # 200ms per 100ms period = 2 CPUs
```

### Memory Limits and OOM Behavior

When a container exceeds its memory limit, the kernel's OOM (Out of Memory) killer terminates it:

```bash
# Container killed for exceeding memory limit
$ docker run --memory=100m alpine sh -c "dd if=/dev/zero of=/dev/null bs=200m"
$ docker inspect --format '{{.State.OOMKilled}}' <container_id>
true
```

**Production tip:** Always set memory limits. Without them, a memory leak in one container can bring down the entire host by triggering the host's OOM killer.

### CPU Limits Explained

CPU limits can be confusing. There are several mechanisms:

```bash
# CPU shares (relative weight, soft limit)
docker run --cpu-shares=512 myapp    # Half of default 1024

# CPU quota (hard limit)
docker run --cpus=2 myapp            # Maximum 2 CPU cores

# CPU pinning (specific cores)
docker run --cpuset-cpus="0,1" myapp # Only use cores 0 and 1
```

**`--cpu-shares`** is a relative weight used when containers compete for CPU. A container with 512 shares gets half the CPU time of one with 1024 shares, but only when there's contention. If the host is idle, both containers can use 100% CPU.

**`--cpus`** is a hard limit. `--cpus=2` means the container can never use more than 2 cores worth of CPU time, regardless of host load.

## Union Filesystems: Image Layers

Union filesystems are what make Docker images efficient. They allow multiple read-only layers to be stacked, with a thin writable layer on top.

### How Layers Work

```
┌─────────────────────────────────────────────────────────────────────┐
│ Container Filesystem View                                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Container sees unified view:                                       │
│  /                                                                  │
│  ├── app/                                                           │
│  │   └── server          (from Layer 3)                            │
│  ├── etc/                                                           │
│  │   └── config.yaml     (from Layer 2)                            │
│  ├── lib/                                                           │
│  │   └── libc.so         (from Layer 1)                            │
│  └── tmp/                                                           │
│      └── data.txt        (written at runtime → Container Layer)    │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Actual Layer Stack                                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────┐                       │
│  │ Container Layer (R/W)                    │ ← Thin writable layer │
│  │ • /tmp/data.txt (new file)              │   Unique per container │
│  │ • /etc/config.yaml (modified copy)      │                       │
│  └─────────────────────────────────────────┘                       │
│  ┌─────────────────────────────────────────┐                       │
│  │ Layer 3: COPY ./server /app/ (R/O)      │                       │
│  └─────────────────────────────────────────┘                       │
│  ┌─────────────────────────────────────────┐                       │
│  │ Layer 2: COPY config.yaml /etc/ (R/O)   │ ← Shared across       │
│  └─────────────────────────────────────────┘   all containers      │
│  ┌─────────────────────────────────────────┐   from this image     │
│  │ Layer 1: Base image - alpine (R/O)      │                       │
│  └─────────────────────────────────────────┘                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Copy-on-Write (CoW)

When a container modifies a file from a lower layer, the union filesystem creates a copy in the container's writable layer:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Copy-on-Write Example                                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 1. Container reads /etc/config.yaml                                 │
│    → Reads from Layer 2 (no copy needed)                           │
│                                                                     │
│ 2. Container modifies /etc/config.yaml                              │
│    → File copied to Container Layer                                 │
│    → Modification applied to copy                                   │
│    → Layer 2 unchanged (other containers unaffected)               │
│                                                                     │
│  Container Layer:  /etc/config.yaml (modified copy)                │
│  Layer 2:          /etc/config.yaml (original, untouched)          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Why this matters:**

1. **Efficiency:** 100 containers from the same image share the same read-only layers, using disk space only once
2. **Speed:** Starting a container doesn't require copying the entire image
3. **Isolation:** Container modifications don't affect the image or other containers

### Inspecting Image Layers

```bash
# View image layers
$ docker history golang:1.25-alpine
IMAGE          CREATED       CREATED BY                                      SIZE
abc123def456   2 days ago    CMD ["sh"]                                      0B
<missing>      2 days ago    RUN apk add --no-cache ca-certificates          512kB
<missing>      2 days ago    COPY /usr/local/go /usr/local/go                450MB
<missing>      2 days ago    ENV PATH=/usr/local/go/bin:/usr/local/sbin...   0B
...

# View layer details with dive (third-party tool)
$ dive golang:1.25-alpine
```

### Storage Drivers

Docker supports multiple union filesystem implementations:

| Driver             | Filesystem | Notes                                  |
| ------------------ | ---------- | -------------------------------------- |
| **overlay2**       | OverlayFS  | Default, best performance, recommended |
| **fuse-overlayfs** | FUSE       | For rootless Docker                    |
| **btrfs**          | Btrfs      | When host uses Btrfs                   |
| **zfs**            | ZFS        | When host uses ZFS                     |

**Current best practice:** Use `overlay2` (the default). It's the most performant and well-tested option for production workloads.

```bash
# Check current storage driver
$ docker info | grep "Storage Driver"
 Storage Driver: overlay2
```

## Docker Architecture

Now let's see how all these pieces fit together in Docker's architecture.

### Component Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ Docker Architecture                                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Client (CLI)                                                      │
│   ┌─────────────────┐                                              │
│   │ docker build    │                                              │
│   │ docker run      │                                              │
│   │ docker pull     │                                              │
│   └────────┬────────┘                                              │
│            │ REST API                                               │
│            ▼                                                        │
│   Docker Daemon (dockerd)                                           │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ • API server                                                 │  │
│   │ • Image management                                           │  │
│   │ • Network management                                         │  │
│   │ • Volume management                                          │  │
│   └────────┬────────────────────────────────────────────────────┘  │
│            │ gRPC                                                   │
│            ▼                                                        │
│   containerd                                                        │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ • Container lifecycle (create, start, stop, delete)         │  │
│   │ • Image pull/push                                            │  │
│   │ • Snapshot management (layers)                               │  │
│   └────────┬────────────────────────────────────────────────────┘  │
│            │                                                        │
│            ▼                                                        │
│   runc (OCI Runtime)                                                │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ • Actually creates the container                             │  │
│   │ • Sets up namespaces, cgroups                                │  │
│   │ • Spawns container process                                   │  │
│   │ • Exits after container starts                               │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

**Docker CLI (`docker`):** The command-line interface you interact with. It's just an API client—it doesn't manage containers directly.

**Docker Daemon (`dockerd`):** The main service that exposes the Docker API. Handles high-level operations like building images, managing networks and volumes, and orchestrating containers.

**containerd:** An industry-standard container runtime. Manages the complete container lifecycle. Kubernetes can use containerd directly, bypassing dockerd.

**runc:** The low-level runtime that actually creates containers. It configures namespaces, cgroups, and starts the container process. Once the container is running, runc exits—the container process runs independently.

### What Happens During `docker run`

```
┌─────────────────────────────────────────────────────────────────────┐
│ docker run -d --name myapp -p 8080:8080 myimage                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 1. CLI sends request to dockerd                                     │
│    POST /containers/create                                          │
│                                                                     │
│ 2. dockerd checks/pulls image                                       │
│    → Image exists locally? Use it                                   │
│    → Otherwise, pull from registry                                  │
│                                                                     │
│ 3. dockerd creates container config                                 │
│    → Network settings (bridge, port mapping)                        │
│    → Volume mounts                                                  │
│    → Resource limits                                                │
│                                                                     │
│ 4. dockerd calls containerd (gRPC)                                  │
│    → Create container                                               │
│    → Prepare rootfs (union mount of layers)                        │
│                                                                     │
│ 5. containerd calls runc                                            │
│    → runc creates namespaces                                        │
│    → runc configures cgroups                                        │
│    → runc starts container process                                  │
│    → runc exits (container runs independently)                      │
│                                                                     │
│ 6. containerd monitors container                                    │
│    → Tracks state (running, stopped, etc.)                         │
│    → Reports back to dockerd                                        │
│                                                                     │
│ 7. CLI receives container ID                                        │
│    → Container is running                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### OCI Specifications

The **Open Container Initiative (OCI)** defines industry standards for containers:

**Runtime Specification (runtime-spec):** How to run a container. Defines the configuration format and lifecycle operations (create, start, kill, delete). runc is the reference implementation.

**Image Specification (image-spec):** How container images are structured. Defines the layer format, manifest, and configuration. Ensures images built with Docker can run on any OCI-compliant runtime.

**Distribution Specification (distribution-spec):** How to push and pull images from registries.

**Why this matters:** OCI standards mean you're not locked into Docker. Images built with Docker run on containerd, Podman, CRI-O, and other OCI-compliant runtimes.

## Docker Client-Daemon Communication

Understanding how the CLI communicates with the daemon is useful for remote Docker access and troubleshooting.

**Terminology note:** "Docker daemon" and "dockerd" are the same thing—`dockerd` is the binary name, and it runs as the Docker daemon (a long-running background service).

### Default: CLI and Daemon on the Same Machine

When you install Docker locally, both the CLI and daemon run on your machine:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Your Machine                                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌────────┐      /var/run/docker.sock      ┌──────────┐           │
│   │ docker │ ─────────────────────────────▶ │ dockerd  │           │
│   │ (CLI)  │        (Unix socket)           │ (daemon) │           │
│   └────────┘                                └──────────┘           │
│                                                                     │
│   $ docker ps         → shows containers on YOUR machine            │
│   $ docker run nginx  → runs nginx on YOUR machine                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Remote Access: CLI and Daemon on Different Machines

You can also use your local CLI to control a Docker daemon on a remote server:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Remote Docker Access                                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Your Local Machine              Remote Server                     │
│   ┌──────────────────┐           ┌──────────────────┐              │
│   │                  │           │                  │              │
│   │   ┌────────┐     │   SSH/TCP │   ┌──────────┐  │              │
│   │   │ docker │─────────────────────▶│ dockerd  │  │              │
│   │   │ (CLI)  │     │ (network) │   │ (daemon) │  │              │
│   │   └────────┘     │           │   └──────────┘  │              │
│   │                  │           │        │        │              │
│   │   No daemon      │           │   ┌────┴─────┐  │              │
│   │   needed here    │           │   │containers│  │              │
│   │                  │           │   └──────────┘  │              │
│   └──────────────────┘           └──────────────────┘              │
│                                                                     │
│   $ docker -H ssh://user@server ps    → shows containers on SERVER  │
│   $ docker -H ssh://user@server run nginx → runs nginx on SERVER    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Why is remote access useful?**

| Use Case                    | Benefit                                              |
| --------------------------- | ---------------------------------------------------- |
| Managing production servers | Run commands from your laptop without SSH-ing in     |
| CI/CD pipelines             | Build server deploys to remote Docker hosts          |
| Multiple environments       | Switch between dev/staging/prod with Docker contexts |
| Remote development          | Run containers on a powerful remote machine          |

### Communication Channels

```
┌─────────────────────────────────────────────────────────────────────┐
│ Client-Daemon Communication Options                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 1. Unix Socket (Default on Linux)                                   │
│    ┌────────┐    /var/run/docker.sock    ┌──────────┐              │
│    │ docker │ ──────────────────────────▶ │ dockerd  │              │
│    │ CLI    │      (local only)          │          │              │
│    └────────┘                            └──────────┘              │
│                                                                     │
│ 2. TCP Socket (Remote access)                                       │
│    ┌────────┐       tcp://host:2376      ┌──────────┐              │
│    │ docker │ ──────────────────────────▶ │ dockerd  │              │
│    │ CLI    │      (network, + TLS)      │          │              │
│    └────────┘                            └──────────┘              │
│                                                                     │
│ 3. SSH (Secure remote access)                                       │
│    ┌────────┐       ssh://user@host      ┌──────────┐              │
│    │ docker │ ──────────────────────────▶ │ dockerd  │              │
│    │ CLI    │    (tunneled via SSH)      │          │              │
│    └────────┘                            └──────────┘              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Unix Socket (Default)

By default, Docker uses `/var/run/docker.sock`:

```bash
# Default communication
$ docker ps
# Equivalent to:
$ docker -H unix:///var/run/docker.sock ps
```

The socket file is owned by root and the `docker` group. Adding your user to the `docker` group grants Docker access:

```bash
sudo usermod -aG docker $USER
```

**Security note:** Access to the Docker socket is equivalent to root access on the host. A user who can run `docker` can mount the host filesystem, access host networking, and more. Treat Docker socket access as root access.

### TCP Socket (Remote Access)

For remote Docker access, dockerd can listen on a TCP port:

```bash
# On the remote host (configure dockerd)
# /etc/docker/daemon.json
{
  "hosts": ["unix:///var/run/docker.sock", "tcp://0.0.0.0:2376"],
  "tls": true,
  "tlscacert": "/etc/docker/ca.pem",
  "tlscert": "/etc/docker/server-cert.pem",
  "tlskey": "/etc/docker/server-key.pem",
  "tlsverify": true
}

# From your local machine
$ docker -H tcp://remote-host:2376 --tlsverify ps

# Or set environment variable
$ export DOCKER_HOST=tcp://remote-host:2376
$ export DOCKER_TLS_VERIFY=1
$ docker ps
```

**Security warning:** Never expose the Docker TCP port without TLS authentication. An unauthenticated Docker socket gives attackers full control of the host.

### SSH (Recommended for Remote Access)

SSH is the easiest and most secure way to access a remote Docker:

```bash
# Connect via SSH (no daemon configuration needed)
$ docker -H ssh://user@remote-host ps

# Or set environment variable
$ export DOCKER_HOST=ssh://user@remote-host
$ docker ps

# Use Docker context for persistent configuration
$ docker context create remote --docker "host=ssh://user@remote-host"
$ docker context use remote
$ docker ps    # Now uses remote Docker
```

**Why SSH is preferred:**

- No daemon configuration changes needed
- Uses existing SSH authentication (keys)
- Encrypted by default
- Works through firewalls with SSH access

### Docker Contexts

Docker contexts let you switch between multiple Docker endpoints:

```bash
# List contexts
$ docker context ls
NAME       DESCRIPTION                               DOCKER ENDPOINT
default *  Current DOCKER_HOST based configuration   unix:///var/run/docker.sock
remote     Remote server                             ssh://user@remote-host

# Create a new context
$ docker context create staging --docker "host=ssh://deploy@staging-server"

# Switch context
$ docker context use staging

# Run command with specific context
$ docker --context production ps
```

## Container Lifecycle

Understanding the container lifecycle helps with debugging and proper signal handling.

### Container States

```
┌─────────────────────────────────────────────────────────────────────┐
│ Container State Machine                                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                     docker create                                   │
│                          │                                          │
│                          ▼                                          │
│                    ┌──────────┐                                    │
│                    │ Created  │                                    │
│                    └────┬─────┘                                    │
│                         │ docker start                              │
│                         ▼                                          │
│   docker restart  ┌──────────┐  docker pause   ┌──────────┐       │
│        ┌─────────▶│ Running  │────────────────▶│  Paused  │       │
│        │          └────┬─────┘◀────────────────└──────────┘       │
│        │               │           docker unpause                  │
│        │               │                                           │
│        │               │ docker stop (SIGTERM, then SIGKILL)       │
│        │               │ docker kill (SIGKILL immediately)         │
│        │               │ Process exits                             │
│        │               ▼                                           │
│        │          ┌──────────┐                                    │
│        └──────────│ Stopped  │ (Exited)                           │
│                   └────┬─────┘                                    │
│                        │ docker rm                                 │
│                        ▼                                          │
│                   ┌──────────┐                                    │
│                   │ Removed  │                                    │
│                   └──────────┘                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### docker stop vs docker kill

```bash
# docker stop - Graceful shutdown
$ docker stop mycontainer
# 1. Sends SIGTERM to PID 1 in container
# 2. Waits for graceful shutdown (default 10 seconds)
# 3. Sends SIGKILL if still running

# docker stop with custom timeout
$ docker stop -t 30 mycontainer    # Wait 30 seconds before SIGKILL

# docker kill - Immediate termination
$ docker kill mycontainer
# 1. Sends SIGKILL immediately (cannot be caught)
# 2. Process terminates instantly

# docker kill with custom signal
$ docker kill -s SIGTERM mycontainer    # Send SIGTERM instead
```

**Production best practice:** Always use `docker stop` to allow graceful shutdown. Your application should handle SIGTERM to close connections, flush buffers, and clean up resources. Use `docker kill` only when a container is unresponsive.

### Viewing Container State

```bash
# Check container status
$ docker ps -a
CONTAINER ID   IMAGE     COMMAND       STATUS
abc123         myapp     "/app"        Up 2 hours                 # Running
def456         myapp     "/app"        Exited (0) 5 minutes ago   # Clean exit
ghi789         myapp     "/app"        Exited (137) 1 minute ago  # Killed (128+9)
jkl012         myapp     "/app"        Exited (1) 10 minutes ago  # Error exit

# Detailed state information
$ docker inspect --format '{{.State.Status}}' mycontainer
running

$ docker inspect --format '{{json .State}}' mycontainer | jq
{
  "Status": "running",
  "Running": true,
  "Paused": false,
  "Restarting": false,
  "OOMKilled": false,
  "Dead": false,
  "Pid": 12345,
  "ExitCode": 0,
  "StartedAt": "2024-12-10T10:00:00.000000000Z"
}
```

**Exit code meanings:**

- `0` — Clean exit (success)
- `1-125` — Application error (defined by your app)
- `126` — Command cannot be invoked
- `127` — Command not found
- `128+N` — Fatal signal N (e.g., 137 = 128+9 = SIGKILL)

---

## Cheatsheet

### Namespace Commands

```bash
# View container's PID on host
docker inspect --format '{{.State.Pid}}' <container>

# View container's namespaces
ls -la /proc/<pid>/ns/

# Enter container's namespaces (debug)
nsenter -t <pid> -n ip addr    # Enter network namespace
nsenter -t <pid> -p -r ps aux  # Enter PID namespace
```

### Cgroup Commands

```bash
# View container cgroup (cgroups v2)
cat /sys/fs/cgroup/docker/<container_id>/memory.max
cat /sys/fs/cgroup/docker/<container_id>/cpu.max

# Check if container was OOM killed
docker inspect --format '{{.State.OOMKilled}}' <container>

# View container resource usage
docker stats <container>
```

### Image Layer Commands

```bash
# View image layers
docker history <image>

# View image size breakdown
docker image inspect <image> --format '{{.Size}}'

# Analyze layers interactively (install dive first)
dive <image>
```

### Architecture Commands

```bash
# Check Docker system info
docker info

# Check component versions
docker version

# View daemon configuration
cat /etc/docker/daemon.json
```

### Client-Daemon Commands

```bash
# List Docker contexts
docker context ls

# Create SSH context
docker context create <name> --docker "host=ssh://user@host"

# Use a context
docker context use <name>

# Run with specific context
docker --context <name> ps
```

### Container Lifecycle Commands

```bash
# Graceful stop (SIGTERM, wait, SIGKILL)
docker stop <container>

# Graceful stop with custom timeout
docker stop -t 30 <container>

# Immediate kill (SIGKILL)
docker kill <container>

# Send specific signal
docker kill -s SIGTERM <container>

# View container state
docker inspect --format '{{.State.Status}}' <container>
```

---

## Further Reading

- [Docker Documentation: Storage drivers](https://docs.docker.com/storage/storagedriver/)
- [Linux namespaces man page](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [cgroups v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [OCI Runtime Specification](https://github.com/opencontainers/runtime-spec)
- [OCI Image Specification](https://github.com/opencontainers/image-spec)
