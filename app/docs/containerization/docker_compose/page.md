---
title: Docker Compose
description: Comprehensive guide on writing docker compose file
---

# Docker Compose

Docker Compose enables you to define and run multi-container applications with a single configuration file. It's the standard tool for local development environments that mirror production architecture—running your application alongside databases, caches, message brokers, and other services.

This guide covers Compose from fundamentals through advanced patterns, with examples reflecting real microservice architectures.

## Compose File Fundamentals

### The Basics

A Compose file is a YAML file (typically `docker-compose.yml` or `compose.yml`) that defines services, networks, and volumes:

```yaml
# compose.yml
services:
  api:
    build: .
    ports:
      - '8080:8080'
    environment:
      - DATABASE_URL=postgres://db:5432/myapp
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=myapp
      - POSTGRES_USER=app
      - POSTGRES_PASSWORD=secret

volumes:
  postgres_data:
```

```bash
# Start all services
docker compose up

# Start in detached mode (background)
docker compose up -d

# Stop and remove containers
docker compose down

# Stop and remove containers, volumes, and images
docker compose down -v --rmi local
```

### Version History and Modern Practice

Older Compose files started with a `version:` key:

```yaml
# Legacy format (avoid)
version: '3.8'
services: ...
```

**Modern practice:** Omit the `version` key entirely. Docker Compose now uses the Compose Specification, which doesn't require versioning. The `version` key is ignored in recent Docker Compose versions.

```yaml
# Modern format (recommended)
services:
  api: ...
```

### File Naming Conventions

Docker Compose automatically loads files in this order:

1. `compose.yml` (preferred modern name)
2. `docker-compose.yml` (legacy but still common)

You can specify a different file with `-f`:

```bash
docker compose -f docker-compose.prod.yml up
```

## Service Configuration

### Building Images

```yaml
services:
  api:
    # Simple build from Dockerfile in context directory
    build: ./api

    # Extended build configuration
    build:
      context: ./api
      dockerfile: Dockerfile.dev
      args:
        VERSION: "1.2.3"
        GIT_COMMIT: ${GIT_COMMIT:-unknown}
      target: development    # Multi-stage build target

    # Use a pre-built image instead of building
    image: myregistry/api:1.2.3
```

**When to use `build` vs `image`:**

| Scenario              | Use     | Example                                |
| --------------------- | ------- | -------------------------------------- |
| Local development     | `build` | Build from source with hot reload      |
| Third-party services  | `image` | `postgres:16-alpine`, `redis:7-alpine` |
| CI/CD testing         | `image` | Test against pre-built images          |
| Production-like local | `image` | Pull same images as production         |

You can specify both—`image` becomes the tag for the built image:

```yaml
services:
  api:
    build: .
    image: myapp:dev # Built image tagged as myapp:dev
```

### Environment Variables

Compose has **two different mechanisms** for environment variables that are often confused:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Two Different Mechanisms                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 1. .env (project root) ──▶ Substitution in compose.yml              │
│    Read by: Docker Compose CLI (before processing)                  │
│    Use for: Image tags, ports, paths in the compose file            │
│                                                                     │
│ 2. env_file directive ──▶ Variables passed INTO container           │
│    Read by: Container at runtime                                    │
│    Use for: Application config (DB URLs, API keys, feature flags)   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Mechanism 1: `.env` for Compose File Substitution

Compose automatically loads `.env` from the project directory and substitutes variables in `compose.yml`:

```bash
# .env (same directory as compose.yml)
POSTGRES_VERSION=16
APP_PORT=8080
```

```yaml
# compose.yml - ${} variables are substituted BEFORE processing
services:
  db:
    image: postgres:${POSTGRES_VERSION}-alpine # → postgres:16-alpine

  api:
    ports:
      - '${APP_PORT}:8080' # → "8080:8080"
```

The container never sees `POSTGRES_VERSION`—substitution happens before the container starts.

#### Mechanism 2: `env_file` for Container Runtime

The `env_file` directive passes variables **into the container** for your application to read:

```bash
# config/api.env
DATABASE_URL=postgres://app:secret@db:5432/myapp
LOG_LEVEL=debug
API_KEY=secret123
```

```yaml
# compose.yml
services:
  api:
    env_file:
      - ./config/api.env # Variables available inside container
```

Your application reads these with `os.Getenv("DATABASE_URL")`.

#### Using Both Together

```bash
# .env (project root - Compose substitution)
IMAGE_TAG=1.2.3
```

```bash
# config/api.env (container runtime)
DATABASE_URL=postgres://app:secret@db:5432/myapp
```

```yaml
services:
  api:
    image: myapp:${IMAGE_TAG} # Substituted → myapp:1.2.3
    env_file:
      - ./config/api.env # Passed into container
    environment:
      APP_ENV: production # Also passed into container
```

#### Other Environment Patterns

```yaml
services:
  api:
    environment:
      # Static value
      LOG_FORMAT: json

      # Substituted from .env, then passed to container
      APP_ENV: ${ENVIRONMENT:-development}

      # Pass through from host (no value = use host's env var)
      - AWS_REGION

      # Required variable (error if not set)
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL must be set}

    env_file:
      - ./config/base.env
      - ./config/local.env    # Later files override earlier ones
```

### Port Mapping

```yaml
services:
  api:
    ports:
      # HOST:CONTAINER
      - '8080:8080' # Map host 8080 to container 8080

      # Different ports
      - '3000:8080' # Access via localhost:3000

      # Bind to specific interface
      - '127.0.0.1:8080:8080' # Only accessible from localhost

      # Random host port (useful for scaling)
      - '8080' # Maps random host port to 8080

      # UDP protocol
      - '5000:5000/udp'

      # Port range
      - '8080-8090:8080-8090'
```

**Security consideration:** By default, ports bind to `0.0.0.0` (all interfaces), making them accessible from other machines on your network. For local development, consider binding to `127.0.0.1`:

```yaml
ports:
  - '127.0.0.1:8080:8080'
```

### Resource Limits

Prevent runaway containers from consuming all host resources:

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: '2' # Maximum 2 CPU cores
          memory: 512M # Maximum 512MB memory
        reservations:
          cpus: '0.5' # Guaranteed 0.5 CPU cores
          memory: 256M # Guaranteed 256MB memory
```

**Note:** `deploy` configuration requires `docker compose up` (not the legacy `docker-compose`). For development, limits help catch memory leaks early.

## Networking

Compose networking is where multi-service architectures come together. Understanding it is essential for designing realistic local environments.

### Default Network Behavior

When you run `docker compose up`, Compose creates a default network for your project:

```yaml
services:
  api:
    build: .
  db:
    image: postgres:16-alpine
```

```
┌─────────────────────────────────────────────────────────────┐
│ Default Network: myproject_default                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐          DNS          ┌─────────┐             │
│  │   api   │◄──────────────────────│   db    │             │
│  │         │   db:5432             │         │             │
│  └─────────┘   api:8080            └─────────┘             │
│                                                             │
│  Services can reach each other by service name              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Key points:

- Containers can reach each other using **service names as hostnames**
- The DNS name `db` resolves to the database container's IP
- No port publishing needed for inter-container communication
- External access requires explicit `ports` mapping

### Custom Networks

Define custom networks for isolation and organization:

```yaml
services:
  api:
    networks:
      - frontend
      - backend

  db:
    networks:
      - backend # Not accessible from frontend network

  nginx:
    networks:
      - frontend # Can reach api, cannot reach db directly

networks:
  frontend:
  backend:
```

```
┌─────────────────────────────────────────────────────────────┐
│ Network Isolation                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  frontend network          backend network                  │
│  ┌─────────────────┐      ┌─────────────────┐              │
│  │                 │      │                 │              │
│  │  ┌───────┐      │      │      ┌────┐    │              │
│  │  │ nginx │──────┼──────┼─────▶│ api│    │              │
│  │  └───────┘      │      │      └──┬─┘    │              │
│  │                 │      │         │      │              │
│  └─────────────────┘      │         ▼      │              │
│                           │      ┌────┐    │              │
│   nginx cannot reach db   │      │ db │    │              │
│   directly (isolation)    │      └────┘    │              │
│                           │                 │              │
│                           └─────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

**Why isolate networks?** This mirrors production architecture where databases aren't directly accessible from the internet. It helps catch configuration errors early—if your nginx accidentally tries to connect directly to the database, it will fail locally just as it would in production.

### Network Aliases

Give services additional DNS names:

```yaml
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

### Connecting to Host Services

Sometimes you need containers to access services running on your host machine (e.g., a locally running API, IDE debugger).

```yaml
services:
  api:
    # On Docker Desktop (Mac/Windows)
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    environment:
      EXTERNAL_SERVICE_URL: http://host.docker.internal:3000
```

**Docker Desktop:** `host.docker.internal` is available by default.

**Linux:** Add the `extra_hosts` mapping shown above (Docker 20.10+), or use the host's actual IP address.

## Volume Management

Volumes persist data beyond container lifecycle and enable code sharing for development.

### Volume Types Comparison

```
┌─────────────────────────────────────────────────────────────┐
│ Volume Types                                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Named Volume                 Bind Mount                     │
│ ┌─────────────────┐         ┌─────────────────┐            │
│ │ Managed by      │         │ Direct mapping   │            │
│ │ Docker          │         │ to host path     │            │
│ │                 │         │                  │            │
│ │ postgres_data:  │         │ ./src:/app/src   │            │
│ │ /var/lib/pg/data│         │                  │            │
│ └─────────────────┘         └─────────────────┘            │
│                                                             │
│ • Docker manages location   • You control location          │
│ • Survives compose down     • See changes immediately       │
│ • Better I/O performance    • Essential for hot reload      │
│ • Use for: databases,       • Use for: source code,         │
│   caches, persistent data     config files                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Named Volumes

```yaml
services:
  db:
    image: postgres:16-alpine
    volumes:
      # Format: VOLUME_NAME:CONTAINER_PATH
      #
      # postgres_data           → Docker-managed volume (not a path)
      # /var/lib/postgresql/data → inside the container
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

# Declare named volumes at the top level
volumes:
  postgres_data:
  redis_data:
```

**How to distinguish named volumes from bind mounts:** If the left side starts with `.` or `/`, it's a bind mount (host path). Otherwise, it's a named volume.

```yaml
volumes:
  - ./src:/app/src # Starts with ./ → bind mount
  - /data/files:/app/files # Starts with /  → bind mount
  - postgres_data:/var/lib/pg # No path prefix → named volume
```

**Lifecycle behavior:**

- `docker compose down` → Containers removed, **volumes preserved**
- `docker compose down -v` → Containers and **volumes removed**

This means your database data survives restarts but can be cleared when needed.

### Bind Mounts

```yaml
services:
  api:
    build: .
    volumes:
      # Format: HOST_PATH:CONTAINER_PATH[:OPTIONS]
      #
      # ./src       → your local machine
      # /app/src    → inside the container

      # Mount source code for hot reload
      - ./src:/app/src

      # Mount config file (read-only)
      - ./config/app.yaml:/etc/app/config.yaml:ro

      # Mount entire project (common for development)
      - .:/app
```

Think of it like `cp` or `scp`: **source (host) first, destination (container) second**.

**The read-only flag (`:ro`):** Prevents the container from modifying mounted files. Use for configuration files that should never be changed by the application.

### Caching Go Modules

For Go development, cache modules to avoid re-downloading on every build:

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.dev
    volumes:
      - .:/app
      - go-mod-cache:/go/pkg/mod # Cache downloaded modules
      - go-build-cache:/root/.cache/go-build # Cache build artifacts

volumes:
  go-mod-cache:
  go-build-cache:
```

This dramatically speeds up builds after the first run.

### tmpfs Mounts

For sensitive data that should never be written to disk:

```yaml
services:
  api:
    tmpfs:
      - /tmp
      - /run:size=64M # With size limit
```

## Dependencies and Startup Order

In multi-service architectures, startup order matters. Your API shouldn't start accepting requests before the database is ready.

### depends_on: Basic Ordering

```yaml
services:
  api:
    depends_on:
      - db
      - redis
    # ...

  db:
    image: postgres:16-alpine

  redis:
    image: redis:7-alpine
```

**What `depends_on` does:**

- Starts `db` and `redis` before `api`
- On shutdown, stops `api` before `db` and `redis`

**What `depends_on` does NOT do:**

- Wait for services to be "ready" (healthy)
- Guarantee the database is accepting connections

### depends_on with Health Checks

For true readiness ordering, combine `depends_on` with health checks:

```yaml
services:
  api:
    build: .
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/myapp

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U app -d myapp']
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 10s

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5
```

```
┌─────────────────────────────────────────────────────────────┐
│ Startup Sequence with Health Checks                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Time ──────────────────────────────────────────────────────▶│
│                                                             │
│ db:     [starting]──[running]──[healthy]                    │
│                                       │                     │
│ redis:  [starting]──[running]──[healthy]                    │
│                                       │                     │
│ api:    [waiting]─────────────────────┴──[starting]──[run]  │
│                                                             │
│         ◄── api waits for both db AND redis to be healthy   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Condition options:**

- `service_started` — Default, just wait for container to start
- `service_healthy` — Wait for health check to pass
- `service_completed_successfully` — Wait for container to exit with code 0 (for init containers)

### Common Health Check Commands

| Service       | Health Check                                                  |
| ------------- | ------------------------------------------------------------- |
| PostgreSQL    | `pg_isready -U user -d dbname`                                |
| MySQL         | `mysqladmin ping -h localhost`                                |
| Redis         | `redis-cli ping`                                              |
| MongoDB       | `mongosh --eval "db.adminCommand('ping')"`                    |
| Elasticsearch | `curl -f http://localhost:9200/_cluster/health`               |
| Kafka         | `kafka-broker-api-versions --bootstrap-server localhost:9092` |

## YAML Anchors and Extensions

Reduce duplication in Compose files using YAML features.

### YAML Anchors

```yaml
# Define common configuration
x-common-env: &common-env
  LOG_LEVEL: info
  APP_ENV: development

x-healthcheck-defaults: &healthcheck-defaults
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 10s

services:
  api:
    build: ./api
    environment:
      <<: *common-env # Merge common environment
      SERVICE_NAME: api
    healthcheck:
      <<: *healthcheck-defaults
      test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:8080/health']

  worker:
    build: ./worker
    environment:
      <<: *common-env # Same common environment
      SERVICE_NAME: worker
    healthcheck:
      <<: *healthcheck-defaults
      test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:8081/health']
```

**How it works:**

- `&anchor-name` defines an anchor
- `*anchor-name` references it
- `<<:` merges the referenced content into the current mapping

### Extension Fields

Fields starting with `x-` are ignored by Compose but can be used as anchors:

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: '10m'
    max-file: '3'

services:
  api:
    logging: *default-logging

  worker:
    logging: *default-logging
```

## Compose Profiles

Profiles let you selectively start services based on the use case.

```yaml
services:
  api:
    build: .
    # No profile = always starts

  db:
    image: postgres:16-alpine
    # No profile = always starts

  redis:
    image: redis:7-alpine
    profiles:
      - cache # Only starts with 'cache' profile

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    profiles:
      - events # Only starts with 'events' profile

  debug-tools:
    image: alpine
    profiles:
      - debug # Only starts with 'debug' profile
    command: sleep infinity
```

```bash
# Start only services without profiles (api, db)
docker compose up

# Start with cache profile (api, db, redis)
docker compose --profile cache up

# Start with multiple profiles (api, db, redis, kafka)
docker compose --profile cache --profile events up

# Start all profiles
docker compose --profile "*" up
```

**Use cases:**

- **debug** — Tools for troubleshooting (network utilities, database clients)
- **monitoring** — Prometheus, Grafana (heavy, not always needed)
- **events** — Kafka, message brokers (complex, only when testing event flows)
- **full** — Everything for integration testing

## Override Files

Compose automatically merges multiple files, enabling environment-specific configuration.

### Automatic Override

If `compose.override.yml` exists, it's automatically merged with `compose.yml`:

```yaml
# compose.yml (base configuration)
services:
  api:
    image: myapp:latest
    environment:
      APP_ENV: production
```

```yaml
# compose.override.yml (development overrides)
services:
  api:
    build: . # Build instead of using image
    volumes:
      - .:/app # Mount source code
    environment:
      APP_ENV: development # Override environment
      DEBUG: 'true'
    ports:
      - '8080:8080'
      - '2345:2345' # Debugger port
```

```bash
# Uses compose.yml + compose.override.yml automatically
docker compose up

# Use only base (ignore override)
docker compose -f compose.yml up
```

**Convention:**

- `compose.yml` — Production-like base configuration
- `compose.override.yml` — Development overrides (gitignored by some teams)

### Explicit Multiple Files

```bash
# Explicitly specify files (merged in order)
docker compose -f compose.yml -f compose.prod.yml up
```

Later files override earlier ones. This enables patterns like:

```
compose.yml           # Base configuration
compose.override.yml  # Local development (auto-loaded)
compose.prod.yml      # Production overrides
compose.test.yml      # Testing configuration
```

## Multi-Service Architecture Example

Let's put it all together with a realistic microservices example:

```yaml
# compose.yml
services:
  # ─────────────────────────────────────────────────────────
  # Application Services
  # ─────────────────────────────────────────────────────────
  api-gateway:
    build:
      context: ./services/api-gateway
      target: development
    ports:
      - '8080:8080'
    environment:
      USER_SERVICE_URL: http://user-service:8081
      ORDER_SERVICE_URL: http://order-service:8082
    depends_on:
      user-service:
        condition: service_healthy
      order-service:
        condition: service_healthy
    networks:
      - frontend
      - backend

  user-service:
    build:
      context: ./services/user-service
      target: development
    volumes:
      - ./services/user-service:/app
      - go-mod-cache:/go/pkg/mod
    environment:
      DATABASE_URL: postgres://app:secret@postgres:5432/users
      REDIS_URL: redis://redis:6379/0
    healthcheck:
      test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:8081/health']
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - backend

  order-service:
    build:
      context: ./services/order-service
      target: development
    volumes:
      - ./services/order-service:/app
      - go-mod-cache:/go/pkg/mod
    environment:
      DATABASE_URL: postgres://app:secret@postgres:5432/orders
      KAFKA_BROKERS: kafka:9092
    healthcheck:
      test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:8082/health']
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s
    depends_on:
      postgres:
        condition: service_healthy
      kafka:
        condition: service_healthy
    networks:
      - backend

  # ─────────────────────────────────────────────────────────
  # Infrastructure Services
  # ─────────────────────────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infrastructure/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U app']
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - backend

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - backend

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      CLUSTER_ID: MkU3OEVBNTcwNTJENDM2Qk
    volumes:
      - kafka_data:/var/lib/kafka/data
    healthcheck:
      test: ['CMD-SHELL', 'kafka-broker-api-versions --bootstrap-server localhost:9092']
      interval: 10s
      timeout: 10s
      retries: 5
      start_period: 30s
    profiles:
      - events
    networks:
      - backend

  # ─────────────────────────────────────────────────────────
  # Development Tools
  # ─────────────────────────────────────────────────────────
  pgadmin:
    image: dpage/pgadmin4:latest
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@local.dev
      PGADMIN_DEFAULT_PASSWORD: admin
      PGADMIN_CONFIG_SERVER_MODE: 'False'
    ports:
      - '5050:80'
    profiles:
      - tools
    networks:
      - backend

networks:
  frontend:
  backend:

volumes:
  postgres_data:
  redis_data:
  kafka_data:
  go-mod-cache:
```

### Project Directory Structure

```
myproject/
├── compose.yml
├── compose.override.yml         # Local dev overrides (optional)
├── .env                         # Environment variables
├── .env.example                 # Template for .env
├── services/
│   ├── api-gateway/
│   │   ├── Dockerfile
│   │   ├── Dockerfile.dev
│   │   └── ...
│   ├── user-service/
│   │   ├── Dockerfile
│   │   └── ...
│   └── order-service/
│       ├── Dockerfile
│       └── ...
└── infrastructure/
    └── postgres/
        └── init/
            └── 01-init.sql      # Creates databases on first run
```

### Common Workflows

```bash
# Start core services (api-gateway, user-service, postgres, redis)
docker compose up

# Start with event streaming (adds kafka)
docker compose --profile events up

# Start with dev tools (adds pgadmin)
docker compose --profile tools up

# View logs for specific service
docker compose logs -f user-service

# Execute command in running container
docker compose exec user-service sh

# Rebuild single service after code changes
docker compose up --build user-service

# Scale a service (stateless services only)
docker compose up --scale worker=3

# Full reset (remove everything including volumes)
docker compose down -v
```

## Development Workflow Tips

### Hot Reload Setup

For Go development with Air:

```yaml
# compose.override.yml
services:
  user-service:
    build:
      context: ./services/user-service
      dockerfile: Dockerfile.dev
    volumes:
      - ./services/user-service:/app
      - go-mod-cache:/go/pkg/mod
    command: air -c .air.toml
```

```dockerfile
# services/user-service/Dockerfile.dev
FROM golang:1.25-alpine

RUN go install github.com/air-verse/air@latest

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

# Source mounted as volume, not copied
CMD ["air", "-c", ".air.toml"]
```

### Remote Debugging

```yaml
# compose.override.yml
services:
  user-service:
    build:
      context: ./services/user-service
      dockerfile: Dockerfile.dev
    ports:
      - '8081:8081' # Application
      - '2345:2345' # Delve debugger
    security_opt:
      - 'seccomp:unconfined' # Required for Delve
    command: >
      dlv debug ./cmd/server
      --headless
      --listen=:2345
      --api-version=2
      --accept-multiclient
```

### Database Initialization

Place SQL files in a mounted directory for automatic execution on first start:

```sql
-- infrastructure/postgres/init/01-init.sql
CREATE DATABASE users;
CREATE DATABASE orders;

\c users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

\c orders
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Files in `/docker-entrypoint-initdb.d/` run alphabetically on first container start (when volume is empty).

---

## Cheatsheet

### Essential Commands

| Command                              | Description                    |
| ------------------------------------ | ------------------------------ |
| `docker compose up`                  | Start all services             |
| `docker compose up -d`               | Start detached (background)    |
| `docker compose up --build`          | Rebuild images before starting |
| `docker compose down`                | Stop and remove containers     |
| `docker compose down -v`             | Also remove volumes            |
| `docker compose ps`                  | List running services          |
| `docker compose logs -f [service]`   | Follow logs                    |
| `docker compose exec <service> sh`   | Shell into container           |
| `docker compose run <service> <cmd>` | Run one-off command            |
| `docker compose pull`                | Pull latest images             |
| `docker compose --profile <name> up` | Start with profile             |

### Service Configuration Quick Reference

```yaml
services:
  myservice:
    image: image:tag                    # Use pre-built image
    build: ./path                       # Or build from Dockerfile
    build:
      context: ./path
      dockerfile: Dockerfile.dev
      target: stage-name
      args:
        KEY: value

    ports:
      - "HOST:CONTAINER"
      - "127.0.0.1:8080:8080"           # Localhost only

    volumes:
      - ./local:/container              # Bind mount
      - named_vol:/container            # Named volume
      - ./config.yaml:/etc/config:ro    # Read-only

    environment:
      KEY: value
    env_file:
      - .env

    depends_on:
      service:
        condition: service_healthy

    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

    networks:
      - network_name
    profiles:
      - profile_name

    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M

volumes:
  named_vol:

networks:
  network_name:
```

### Health Check Commands

| Service          | Command                                         |
| ---------------- | ----------------------------------------------- |
| PostgreSQL       | `pg_isready -U user -d db`                      |
| MySQL            | `mysqladmin ping -h localhost`                  |
| Redis            | `redis-cli ping`                                |
| HTTP endpoint    | `wget -q --spider http://localhost:PORT/health` |
| HTTP (with curl) | `curl -f http://localhost:PORT/health`          |

### Environment Variable Syntax

```yaml
environment:
  SIMPLE: value # Direct value
  FROM_HOST: ${HOST_VAR} # From host environment
  WITH_DEFAULT: ${VAR:-default} # Default if unset
  REQUIRED: ${VAR:?error message} # Error if unset
```

---

## Further Reading

- [Compose Specification](https://docs.docker.com/compose/compose-file/)
- [Networking in Compose](https://docs.docker.com/compose/networking/)
- [Environment variables in Compose](https://docs.docker.com/compose/environment-variables/)
