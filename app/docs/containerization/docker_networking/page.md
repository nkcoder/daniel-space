---
title: Docker Networking
description: Understanding docker networking.
---

# Docker Networking

Networking is where containers become useful—connecting services together, exposing APIs, and isolating components. Understanding Docker networking is essential for designing multi-service architectures and debugging connectivity issues.

## Network Drivers Overview

Docker provides several network drivers for different use cases:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Docker Network Drivers                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  bridge (default)     host              none                        │
│  ┌─────────────┐     ┌─────────────┐   ┌─────────────┐             │
│  │ Isolated    │     │ Share host  │   │ No network  │             │
│  │ network     │     │ network     │   │             │             │
│  │ with NAT    │     │ directly    │   │ Fully       │             │
│  │             │     │             │   │ isolated    │             │
│  └─────────────┘     └─────────────┘   └─────────────┘             │
│  Most common         Performance        Security                    │
│                      critical           sensitive                   │
│                                                                     │
│  overlay              macvlan                                       │
│  ┌─────────────┐     ┌─────────────┐                               │
│  │ Multi-host  │     │ Direct      │                               │
│  │ networking  │     │ physical    │                               │
│  │ (Swarm/K8s) │     │ network     │                               │
│  └─────────────┘     └─────────────┘                               │
│  Orchestration       Legacy/special                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

| Driver      | Use Case                                  | Isolation       | Performance |
| ----------- | ----------------------------------------- | --------------- | ----------- |
| **bridge**  | Default, single-host containers           | Container-level | Good        |
| **host**    | Performance-critical, no isolation needed | None            | Best        |
| **none**    | Security-sensitive, no network needed     | Complete        | N/A         |
| **overlay** | Multi-host (Swarm, Kubernetes)            | Container-level | Good        |
| **macvlan** | Containers need physical network IPs      | Network-level   | Good        |

For most use cases, you'll use **bridge** networking. Let's dive deep into how it works.

## Bridge Networking Internals

When you install Docker, it creates a default bridge network called `bridge` (shown as `docker0` on the host):

```bash
$ docker network ls
NETWORK ID     NAME      DRIVER    SCOPE
a1b2c3d4e5f6   bridge    bridge    local
f6e5d4c3b2a1   host      host      local
1a2b3c4d5e6f   none      null      local

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
┌─────────────────────────────────────────────────────────────────────┐
│ Bridge Network Architecture                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Host                                                              │
│   ┌───────────────────────────────────────────────────────────┐    │
│   │                                                           │    │
│   │   Container A           Container B                       │    │
│   │   ┌───────────┐        ┌───────────┐                     │    │
│   │   │   eth0    │        │   eth0    │                     │    │
│   │   │172.17.0.2 │        │172.17.0.3 │                     │    │
│   │   └─────┬─────┘        └─────┬─────┘                     │    │
│   │         │ veth              │ veth                       │    │
│   │         │                    │                            │    │
│   │   ┌─────┴────────────────────┴─────┐                     │    │
│   │   │         docker0 bridge         │                     │    │
│   │   │          172.17.0.1            │                     │    │
│   │   └─────────────┬──────────────────┘                     │    │
│   │                 │                                         │    │
│   │                 │ NAT (iptables)                         │    │
│   │                 │                                         │    │
│   │   ┌─────────────┴──────────────────┐                     │    │
│   │   │          eth0 (host)           │                     │    │
│   │   │         192.168.1.100          │                     │    │
│   │   └────────────────────────────────┘                     │    │
│   │                                                           │    │
│   └───────────────────────────────────────────────────────────┘    │
│                         │                                           │
│                         ▼                                           │
│                    Physical Network                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Viewing Container Network Configuration

```bash
# Start a container
$ docker run -d --name web nginx

# View container's IP address
$ docker inspect web --format '{{.NetworkSettings.IPAddress}}'
172.17.0.2

# View from inside the container
$ docker exec web ip addr show eth0
47: eth0@if48: <BROADCAST,MULTICAST,UP,LOWER_UP> ...
    inet 172.17.0.2/16 brd 172.17.255.255 scope global eth0

# View the veth pair on the host
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

Sometimes containers need to access services running on the host machine (e.g., a database running locally, IDE debugger).

### Docker Desktop (Mac/Windows)

Docker Desktop provides a special DNS name:

```bash
$ docker run --rm alpine ping host.docker.internal
PING host.docker.internal (192.168.65.254): 56 data bytes
64 bytes from 192.168.65.254: seq=0 ttl=64 time=0.456 ms
```

```yaml
# compose.yml
services:
  api:
    environment:
      # Connect to service running on host
      DATABASE_URL: postgres://host.docker.internal:5432/mydb
```

### Linux

On Linux, `host.docker.internal` doesn't exist by default. Add it manually:

```yaml
# compose.yml
services:
  api:
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    environment:
      DATABASE_URL: postgres://host.docker.internal:5432/mydb
```

Or use host network mode, or the host's actual IP address.

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
