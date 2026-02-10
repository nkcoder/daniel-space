---
title: Docker Networking
description: Understanding docker networking.
date: 2025-12-22
---

# Docker Networking Deep Dive

Networking is where containers become useful—connecting services together, exposing APIs, and isolating components. Understanding Docker networking is essential for designing multi-service architectures and debugging connectivity issues.

## Network Drivers Overview

Docker provides several network drivers for different use cases:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Docker Network Drivers                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  bridge (default)     host              none                        │
│  ┌─────────────┐     ┌─────────────┐   ┌─────────────┐              │
│  │ Isolated    │     │ Share host  │   │ No network  │              │
│  │ network     │     │ network     │   │             │              │
│  │ with NAT    │     │ directly    │   │ Fully       │              │
│  │             │     │             │   │ isolated    │              │
│  └─────────────┘     └─────────────┘   └─────────────┘              │
│  Most common         Performance        Security                    │
│                      critical           sensitive                   │
│                                                                     │
│  overlay              macvlan                                       │
│  ┌─────────────┐     ┌─────────────┐                                │
│  │ Multi-host  │     │ Direct      │                                │
│  │ networking  │     │ physical    │                                │
│  │ (Swarm/K8s) │     │ network     │                                │
│  └─────────────┘     └─────────────┘                                │
│  Orchestration       Legacy/special                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Bridge Network (Default)

The bridge driver creates an isolated network on a single host. Containers on the same bridge can communicate; external access requires port mapping.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Bridge Network                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Container A ◄───────────────────────► Container B                 │
│        │            Bridge network            │                     │
│        │           (172.18.0.0/16)           │                      │
│        │                                      │                     │
│        └──────────────┬───────────────────────┘                     │
│                       │                                             │
│                      NAT                                            │
│                       │                                             │
│                  Host Network                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Use Cases:**

- Local development environments
- Multi-container applications on a single host
- Microservices that need to communicate with each other
- Any scenario requiring network isolation between container groups

**Best Practices:**

- Always use user-defined bridge networks, not the default `bridge` (enables DNS resolution by container name)
- Create separate networks for different application tiers (frontend, backend, database)
- Don't expose ports unless necessary—containers on the same network can communicate without port publishing

```bash
# Create a user-defined bridge network
$ docker network create --driver bridge my-app-network

# Run containers on the network
$ docker run -d --name api --network my-app-network my-api
$ docker run -d --name db --network my-app-network postgres:16-alpine

# api can reach db via hostname "db" - no port publishing needed
```

### Host Network

The host driver removes network isolation—the container shares the host's network namespace directly. No NAT, no port mapping, no separate IP.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Host Network                                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Host (192.168.1.100)                                              │
│   ┌───────────────────────────────────────────────────────────┐     │
│   │                                                           │     │
│   │   Container (--network host)                              │     │
│   │   Shares host's network directly                          │     │
│   │   No separate IP, no NAT                                  │     │
│   │   Listens on host's 192.168.1.100:8080                    │     │
│   │                                                           │     │
│   └───────────────────────────────────────────────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Use Cases:**

- Performance-critical applications where NAT overhead matters (high-throughput networking)
- Applications that need to bind to many dynamic ports (e.g., FTP servers)
- Containers that need to see the real client IP without proxy headers
- Network monitoring/debugging tools that need raw network access

**Best Practices:**

- Use sparingly—you lose container network isolation
- Avoid in production unless you have a specific performance requirement
- Be aware of port conflicts with host services
- Not available on Docker Desktop (Mac/Windows)—only works on Linux

```bash
# Run with host networking
$ docker run -d --network host nginx
# nginx is now accessible at host's IP:80, not container IP

# Useful for network debugging tools
$ docker run --rm --network host nicolaka/netshoot tcpdump -i eth0
```

**When NOT to use:**

- Multi-tenant environments (no isolation)
- When running multiple instances of the same service (port conflicts)
- On Docker Desktop (doesn't work as expected)

### None Network

The none driver provides complete network isolation—no network interface except loopback.

```
┌─────────────────────────────────────────────────────────────────────┐
│ None Network                                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Container                                                         │
│   ┌───────────────────────────────────────────────────────────┐     │
│   │                                                           │     │
│   │   Only loopback (127.0.0.1)                               │     │
│   │   No external network access                              │     │
│   │   Cannot communicate with other containers                │     │
│   │   Cannot access internet                                  │     │
│   │                                                           │     │
│   └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│   ✗ No connection to host network                                   │
│   ✗ No connection to other containers                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Use Cases:**

- Batch processing jobs that don't need network access
- Security-sensitive workloads that must be isolated
- Containers that only process local files
- Cryptographic operations or secret generation

**Best Practices:**

- Use for maximum security when network access isn't required
- Combine with read-only filesystem for defense in depth
- Useful for running untrusted code in isolation

```bash
# Run with no network
$ docker run --rm --network none alpine ping google.com
# ping: bad address 'google.com' - no network access

# Process files without network access
$ docker run --rm --network none -v $(pwd)/data:/data my-processor
```

### Overlay Network

The overlay driver enables communication between containers across multiple Docker hosts. Used primarily with Docker Swarm or Kubernetes.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Overlay Network                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Host A                              Host B                        │
│   ┌─────────────────────┐            ┌─────────────────────┐        │
│   │ Container 1         │            │ Container 2         │        │
│   │ (10.0.0.2)         │            │ (10.0.0.3)         │          │
│   └─────────┬───────────┘            └─────────┬───────────┘        │
│             │                                  │                    │
│             └──────────────┬───────────────────┘                    │
│                            │                                        │
│                    Overlay Network                                  │
│                    (VXLAN tunnel)                                   │
│                    (10.0.0.0/24)                                    │
│                                                                     │
│   Containers communicate as if on the same network                  │
│   even though they're on different physical hosts                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Use Cases:**

- Docker Swarm services that span multiple nodes
- Multi-host container orchestration
- Kubernetes networking (via CNI plugins)
- Distributed applications requiring cross-host communication

**Best Practices:**

- Use with Docker Swarm or Kubernetes, not standalone containers
- Enable encryption for sensitive traffic (`--opt encrypted`)
- Plan your subnet allocation to avoid conflicts
- For single-host development, bridge networks are simpler

```bash
# Create an encrypted overlay network (requires Swarm mode)
$ docker network create --driver overlay --opt encrypted my-overlay

# For most local development, you don't need overlay networks
# Use bridge networks instead
```

**When NOT to use:**

- Single-host deployments (use bridge instead)
- Local development environments
- When not using Docker Swarm or Kubernetes

### Macvlan Network

The macvlan driver assigns a MAC address to each container, making it appear as a physical device on your network. Containers get IPs directly from your physical network.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Macvlan Network                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Physical Network (192.168.1.0/24)                                 │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                                                             │   │
│   │   Router          Host              Container               │   │
│   │   192.168.1.1     192.168.1.100     192.168.1.50            │   │
│   │        │               │                 │                  │   │
│   │        └───────────────┴─────────────────┘                  │   │
│   │                                                             │   │
│   │   Container appears as a physical device on the LAN         │   │
│   │   with its own MAC address and IP                           │   │
│   │                                                             │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Use Cases:**

- Legacy applications that expect to be on the physical network
- Applications that need to be accessible via LAN without port forwarding
- Migrating from VMs to containers (same network behavior)
- IoT or embedded systems that need direct network access

**Best Practices:**

- Use only when you need containers to have IPs on your physical network
- Requires network infrastructure that supports multiple MAC addresses per port
- Plan IP allocation carefully to avoid conflicts
- Note: container cannot communicate with host via macvlan interface (Linux kernel limitation)

```bash
# Create a macvlan network
$ docker network create -d macvlan \
    --subnet=192.168.1.0/24 \
    --gateway=192.168.1.1 \
    -o parent=eth0 \
    my-macvlan

# Container gets an IP on your physical network
$ docker run -d --network my-macvlan --ip 192.168.1.50 nginx
```

**When NOT to use:**

- Cloud environments (usually not supported by cloud providers)
- When bridge networking meets your needs
- Docker Desktop (not supported on Mac/Windows)

### Network Driver Comparison

| Driver      | Isolation       | Performance | Multi-Host | Complexity | Use Case                              |
| ----------- | --------------- | ----------- | ---------- | ---------- | ------------------------------------- |
| **bridge**  | Container-level | Good        | No         | Low        | Default, local dev, most applications |
| **host**    | None            | Best        | No         | Low        | Performance-critical, network tools   |
| **none**    | Complete        | N/A         | No         | Low        | Security-sensitive, batch jobs        |
| **overlay** | Container-level | Good        | Yes        | Medium     | Swarm/K8s, distributed apps           |
| **macvlan** | Network-level   | Good        | No         | Medium     | Legacy apps, direct LAN access        |

### Quick Decision Guide

```
┌─────────────────────────────────────────────────────────────────────┐
│ Which Network Driver Should I Use?                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Start here: Do you need network access?                           │
│                    │                                                │
│            ┌──────┴──────┐                                         │
│            No            Yes                                        │
│            │              │                                         │
│            ▼              ▼                                         │
│         "none"     Single host or multi-host?                       │
│                           │                                         │
│                   ┌───────┴───────┐                                │
│              Single host     Multi-host                             │
│                   │              │                                  │
│                   ▼              ▼                                  │
│        Need max performance?  "overlay"                             │
│                   │         (with Swarm/K8s)                       │
│           ┌──────┴──────┐                                          │
│           No            Yes                                         │
│           │              │                                          │
│           ▼              ▼                                          │
│       "bridge"       "host"                                         │
│    (user-defined)  (Linux only)                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Bridge Networking Internals

When you install Docker, it creates a default bridge network called `bridge` (shown as `docker0` on Linux hosts):

```bash
$ docker network ls
NETWORK ID     NAME      DRIVER    SCOPE
a1b2c3d4e5f6   bridge    bridge    local
f6e5d4c3b2a1   host      host      local
1a2b3c4d5e6f   none      null      local
```

**Note:** The following `ip` commands are Linux-specific. On macOS/Windows, Docker runs inside a Linux VM, so you won't see `docker0` on your host. You can still inspect networks using `docker network inspect`.

```bash
# Linux only: view the docker0 bridge interface
$ ip link show docker0
3: docker0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ...
    link/ether 02:42:ac:11:00:01 brd ff:ff:ff:ff:ff:ff
```

### How Containers Connect to Bridge

When a container starts on a bridge network, Docker:

1. Creates a **veth pair** (virtual ethernet pair)
2. Attaches one end to the container (as `eth0`)
3. Attaches the other end to the bridge (`docker0`)

```
┌──────────────────────────────────────────────────────────────────┐
│ Bridge Network Architecture                                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Host                                                           │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                                                          │  │
│   │   Container A           Container B                      │  │
│   │   ┌───────────┐        ┌───────────┐                    │  │
│   │   │   eth0    │        │   eth0    │                    │  │
│   │   │172.17.0.2 │        │172.17.0.3 │                    │  │
│   │   └─────┬─────┘        └─────┬─────┘                    │  │
│   │         │ veth              │ veth                      │  │
│   │         │                    │                           │  │
│   │   ┌─────┴────────────────────┴─────┐                    │  │
│   │   │         docker0 bridge         │                    │  │
│   │   │          172.17.0.1            │                    │  │
│   │   └─────────────┬──────────────────┘                    │  │
│   │                 │                                        │  │
│   │                 │ NAT (iptables)                        │  │
│   │                 │                                        │  │
│   │   ┌─────────────┴──────────────────┐                    │  │
│   │   │          eth0 (host)           │                    │  │
│   │   │         192.168.1.100          │                    │  │
│   │   └────────────────────────────────┘                    │  │
│   │                                                          │  │
│   └──────────────────────────────────────────────────────────┘  │
│                         │                                        │
│                         ▼                                        │
│                    Physical Network                              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Viewing Container Network Configuration

```bash
# Start a container
$ docker run -d --name web nginx

# View container's IP address (works on all platforms)
$ docker inspect web --format '{{.NetworkSettings.IPAddress}}'
172.17.0.2

# View from inside the container
$ docker exec web ip addr show eth0
47: eth0@if48: <BROADCAST,MULTICAST,UP,LOWER_UP> ...
    inet 172.17.0.2/16 brd 172.17.255.255 scope global eth0

# Linux only: view the veth pair on the host
$ ip link show | grep veth
48: vethc3d4e5f@if47: <BROADCAST,MULTICAST,UP,LOWER_UP> ...
```

### NAT and Port Mapping

Containers on bridge networks use private IPs (172.17.x.x). To make them accessible externally, Docker uses **NAT (Network Address Translation)** via iptables:

```bash
# Run container with port mapping
$ docker run -d -p 8080:80 --name web nginx

# Docker creates iptables rules
$ sudo iptables -t nat -L -n | grep 8080
DNAT tcp -- 0.0.0.0/0  0.0.0.0/0  tcp dpt:8080 to:172.17.0.2:80
```

**What happens when you access localhost:8080:**

1. Request arrives at host port 8080
2. iptables DNAT rule rewrites destination to 172.17.0.2:80
3. Request routed through docker0 bridge to container
4. Response follows reverse path

## Container DNS and Service Discovery

Docker provides built-in DNS for container-to-container communication. This is one of Docker's most useful features.

### Default Bridge vs User-Defined Bridge

The **default bridge** (`docker0`) and **user-defined bridges** behave differently:

| Feature                 | Default Bridge          | User-Defined Bridge             |
| ----------------------- | ----------------------- | ------------------------------- |
| DNS resolution by name  | No                      | Yes                             |
| Automatic DNS           | No                      | Yes                             |
| Network isolation       | Shared with all default | Only containers on same network |
| Live connect/disconnect | No                      | Yes                             |

**This is why you should always create user-defined networks:**

```bash
# Default bridge - DNS doesn't work
$ docker run -d --name db postgres:16-alpine
$ docker run --rm alpine ping db
ping: bad address 'db'    # FAILS

# User-defined bridge - DNS works
$ docker network create mynet
$ docker run -d --name db --network mynet postgres:16-alpine
$ docker run --rm --network mynet alpine ping -c 2 db
PING db (172.18.0.2): 56 data bytes
64 bytes from 172.18.0.2: seq=0 ttl=64 time=0.089 ms    # WORKS
```

### How Docker DNS Works

Docker runs an embedded DNS server at `127.0.0.11` inside each container:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Docker DNS Resolution                                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Container: api                                                    │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │                                                           │    │
│   │   Application code:                                       │    │
│   │   db, _ := sql.Open("postgres", "postgres://db:5432/app") │    │
│   │                           │                               │    │
│   │                           ▼                               │    │
│   │   ┌─────────────────────────────────────────┐            │    │
│   │   │ /etc/resolv.conf                         │            │    │
│   │   │ nameserver 127.0.0.11                    │            │    │
│   │   └─────────────────────────────────────────┘            │    │
│   │                           │                               │    │
│   └───────────────────────────┼───────────────────────────────┘    │
│                               ▼                                     │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │ Docker Embedded DNS (127.0.0.11)                          │    │
│   │                                                           │    │
│   │   "db" → Is this a container name on the same network?   │    │
│   │        → Yes: Return 172.18.0.2                          │    │
│   │        → No: Forward to host DNS                         │    │
│   │                                                           │    │
│   └───────────────────────────────────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

```bash
# View DNS configuration inside container
$ docker run --rm --network mynet alpine cat /etc/resolv.conf
nameserver 127.0.0.11
options ndots:0
```

### Network Aliases

Give containers additional DNS names:

```yaml
# compose.yml
services:
  postgres-primary:
    image: postgres:16-alpine
    networks:
      backend:
        aliases:
          - db
          - database
          - postgres
```

Now other containers can reach this service as `postgres-primary`, `db`, `database`, or `postgres`.

**Use case:** Database migrations—switch from `db` pointing to old database to new database without changing application config.

## Port Publishing Strategies

### Port Mapping Options

```bash
# Map host port to container port
# Format: -p HOST_PORT:CONTAINER_PORT
$ docker run -p 8080:80 nginx           # Host 8080 → Container 80

# Map to specific interface (localhost only)
$ docker run -p 127.0.0.1:8080:80 nginx # Only accessible from localhost

# Random host port (Docker assigns available port)
$ docker run -p 80 nginx                # Random port → Container 80
$ docker port <container>               # See assigned port

# Multiple ports
$ docker run -p 8080:80 -p 8443:443 nginx

# UDP protocol
$ docker run -p 5000:5000/udp myapp

# Port range
$ docker run -p 8080-8090:8080-8090 myapp
```

### Viewing Port Mappings

```bash
$ docker run -d -p 8080:80 -p 8443:443 --name web nginx

$ docker port web
80/tcp -> 0.0.0.0:8080
443/tcp -> 0.0.0.0:8443

$ docker ps
PORTS
0.0.0.0:8080->80/tcp, 0.0.0.0:8443->443/tcp
```

### Security Consideration: Interface Binding

By default, ports bind to `0.0.0.0` (all interfaces), making them accessible from other machines on your network:

```bash
# EXPOSED TO NETWORK - anyone can access
$ docker run -p 8080:80 nginx

# LOCALHOST ONLY - only you can access
$ docker run -p 127.0.0.1:8080:80 nginx
```

For local development, prefer binding to `127.0.0.1`:

```yaml
# compose.yml
services:
  api:
    ports:
      - '127.0.0.1:8080:8080'

  db:
    ports:
      - '127.0.0.1:5432:5432' # For local DB tools, not exposed to network
```

## Custom Networks

### Creating and Managing Networks

```bash
# Create a network
$ docker network create mynet

# Create with specific subnet
$ docker network create --subnet=172.20.0.0/16 mynet

# Create with specific gateway
$ docker network create --subnet=172.20.0.0/16 --gateway=172.20.0.1 mynet

# List networks
$ docker network ls

# Inspect network
$ docker network inspect mynet

# Remove network
$ docker network rm mynet

# Remove all unused networks
$ docker network prune
```

### Connecting Containers to Networks

```bash
# Run container on specific network
$ docker run -d --name api --network mynet myapp

# Connect running container to additional network
$ docker network connect frontend api

# Disconnect from network
$ docker network disconnect frontend api

# Container on multiple networks
$ docker run -d --name api --network backend myapp
$ docker network connect frontend api
# Now 'api' is on both backend and frontend networks
```

### Network Isolation Patterns

**Pattern 1: Frontend/Backend Separation**

```yaml
services:
  nginx:
    networks:
      - frontend

  api:
    networks:
      - frontend
      - backend

  db:
    networks:
      - backend

networks:
  frontend:
  backend:
```

**Pattern 2: Per-Service Databases**

```yaml
services:
  user-service:
    networks:
      - user-db-net
      - shared

  user-db:
    networks:
      - user-db-net # Only user-service can access

  order-service:
    networks:
      - order-db-net
      - shared

  order-db:
    networks:
      - order-db-net # Only order-service can access

networks:
  user-db-net:
  order-db-net:
  shared: # For inter-service communication
```

## Host Network Mode

In host mode, the container shares the host's network namespace—no isolation, no NAT:

```bash
$ docker run --network host nginx
# nginx now listens on host's port 80 directly
```

```
┌─────────────────────────────────────────────────────────────────────┐
│ Host Network Mode                                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Host                                                              │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │                                                           │    │
│   │   Container (--network host)                              │    │
│   │   ┌───────────────────────────────────────────────────┐  │    │
│   │   │                                                   │  │    │
│   │   │   nginx listening on port 80                      │  │    │
│   │   │   (directly on host's network interface)          │  │    │
│   │   │                                                   │  │    │
│   │   └───────────────────────────────────────────────────┘  │    │
│   │                                                           │    │
│   │   Host's eth0: 192.168.1.100:80 ← nginx is here          │    │
│   │                                                           │    │
│   └───────────────────────────────────────────────────────────┘    │
│                                                                     │
│   No NAT, no port mapping, no network namespace                     │
│   Container uses host's network directly                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**When to use host networking:**

- Performance-critical applications (eliminates NAT overhead)
- Applications that need to see real client IPs
- Applications that need to bind to many ports dynamically

**Trade-offs:**

- No network isolation
- Port conflicts with host services
- Less portable (depends on host network config)
- Doesn't work on Docker Desktop (Mac/Windows)

## Connecting to Host Services

Sometimes containers need to access services running on the host machine (e.g., a database running locally, an IDE debugger).

### The Problem

Containers have their own network namespace. `localhost` inside a container refers to the container itself, not your host machine. You need a way to address the host from within a container.

### Solution: host.docker.internal

Docker provides a special DNS name `host.docker.internal` that resolves to the host machine's IP address.

**Docker Desktop (Mac/Windows):** Works out of the box.

```bash
$ docker run --rm alpine ping host.docker.internal
PING host.docker.internal (192.168.65.254): 56 data bytes
64 bytes from 192.168.65.254: seq=0 ttl=64 time=0.456 ms
```

**Linux (Docker Engine 20.10+):** Requires explicit configuration using `host-gateway`:

```bash
# CLI
$ docker run --rm --add-host=host.docker.internal:host-gateway alpine ping host.docker.internal
```

```yaml
# compose.yml (works on all platforms)
services:
  api:
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    environment:
      DATABASE_URL: postgres://host.docker.internal:5432/mydb
```

The `host-gateway` is a special value that Docker resolves to the host's gateway IP (typically `172.17.0.1` for the default bridge).

**Tip:** For cross-platform compatibility, always include the `extra_hosts` configuration—it works on all platforms and makes your Compose files portable.

## Debugging Network Issues

### Common Debugging Commands

```bash
# Check container's network settings
$ docker inspect <container> --format '{{json .NetworkSettings}}' | jq

# Check container's IP address
$ docker inspect <container> --format '{{.NetworkSettings.IPAddress}}'

# Check which networks a container is connected to
$ docker inspect <container> --format '{{json .NetworkSettings.Networks}}' | jq

# List containers on a network
$ docker network inspect mynet --format '{{json .Containers}}' | jq

# Test connectivity from inside a container
$ docker exec <container> ping -c 2 other-container
$ docker exec <container> wget -q --spider http://other-container:8080/health

# Test DNS resolution
$ docker exec <container> nslookup other-container

# Check if port is listening inside container
$ docker exec <container> netstat -tlnp
```

### Network Debug Container

When your app container lacks networking tools, use a debug container:

```bash
# Run a debug container on the same network
$ docker run -it --rm --network mynet nicolaka/netshoot

# Now you have full networking tools
netshoot$ ping api
netshoot$ curl http://api:8080/health
netshoot$ dig db
netshoot$ tcpdump -i eth0 port 5432
netshoot$ nmap -p 1-1000 api
```

### Common Issues and Solutions

**Issue: "Connection refused" between containers**

```bash
# Check if target container is running
$ docker ps | grep target-container

# Check if service is listening on correct interface
$ docker exec target-container netstat -tlnp
# Service should listen on 0.0.0.0, not 127.0.0.1

# Check if containers are on the same network
$ docker network inspect mynet
```

**Issue: DNS resolution fails**

```bash
# Are you using default bridge? Switch to user-defined network
$ docker network create mynet
$ docker run --network mynet ...

# Check DNS server in container
$ docker exec <container> cat /etc/resolv.conf
# Should show: nameserver 127.0.0.11
```

**Issue: Can't access container from host**

```bash
# Check port mapping
$ docker port <container>

# Check if service is running inside
$ docker exec <container> curl -s localhost:8080

# Check iptables (Linux)
$ sudo iptables -t nat -L -n | grep <port>
```

**Issue: Containers can't reach internet**

```bash
# Check DNS resolution
$ docker exec <container> nslookup google.com

# Check routing
$ docker exec <container> ip route

# Check if host can reach internet
$ ping google.com

# Check Docker daemon DNS settings
$ docker info | grep -i dns
```

## Docker Compose Networking

### Default Behavior

Compose creates a default network for each project:

```yaml
# compose.yml in directory "myapp"
services:
  api:
    build: .
  db:
    image: postgres:16-alpine
```

```bash
$ docker compose up -d

# Compose creates network: myapp_default
$ docker network ls
NETWORK ID     NAME           DRIVER
...            myapp_default  bridge

# Both services are on myapp_default
# api can reach db via hostname "db"
```

### Custom Networks in Compose

```yaml
services:
  api:
    networks:
      - frontend
      - backend

  db:
    networks:
      - backend

  nginx:
    networks:
      - frontend

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true # No external access
```

The `internal: true` option creates a network with no gateway—containers cannot reach the internet, only each other.

### External Networks

Connect to networks created outside Compose:

```bash
# Create network manually
$ docker network create shared-services
```

```yaml
# compose.yml
services:
  api:
    networks:
      - default
      - shared

networks:
  shared:
    external: true
    name: shared-services
```

---

## Cheatsheet

### Network Commands

```bash
# List networks
docker network ls

# Create network
docker network create mynet
docker network create --subnet=172.20.0.0/16 mynet

# Inspect network
docker network inspect mynet

# Connect/disconnect container
docker network connect mynet <container>
docker network disconnect mynet <container>

# Remove network
docker network rm mynet
docker network prune    # Remove all unused
```

### Container Network Info

```bash
# Container IP address
docker inspect <container> --format '{{.NetworkSettings.IPAddress}}'

# Container networks
docker inspect <container> --format '{{json .NetworkSettings.Networks}}'

# Port mappings
docker port <container>
```

### Port Mapping

```bash
# Standard mapping
docker run -p HOST:CONTAINER image

# Localhost only
docker run -p 127.0.0.1:8080:80 image

# Random host port
docker run -p 80 image

# UDP
docker run -p 5000:5000/udp image
```

### Debugging

```bash
# Test connectivity
docker exec <container> ping other-container
docker exec <container> curl http://other:8080

# DNS lookup
docker exec <container> nslookup other-container

# Network debug container
docker run -it --rm --network mynet nicolaka/netshoot
```

### Compose Networks

```yaml
services:
  api:
    networks:
      - frontend
      - backend

networks:
  frontend:
  backend:
    internal: true # No external access
  external-net:
    external: true
    name: existing-network
```

---

## Further Reading

- [Docker Networking Overview](https://docs.docker.com/network/)
- [Bridge Network Driver](https://docs.docker.com/network/bridge/)
- [Compose Networking](https://docs.docker.com/compose/networking/)
- [netshoot - Network Debug Container](https://github.com/nicolaka/netshoot)
