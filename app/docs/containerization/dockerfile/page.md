---
title: Dockerfile guide
description: Comprehensive guide on writing production-grade dockerfiles
---

# Dockerfile

Writing a Dockerfile that works is easy. Writing one that's secure, efficient, and maintainable for production requires understanding the nuances of image building. This guide covers the essential concepts with focused examples in Go.

## The Build Context

When you run `docker build`, the first thing Docker does is send the **build context** to the daemon. Understanding this is crucial for build performance.

```
$ docker build -t myapp .
Sending build context to Docker daemon  245.8MB   --> This can be slow!
```

The build context is the directory you specify (`.` in the example above). Docker packages this entire directory and sends it to the daemon, which may be on a remote machine. This happens on every build, regardless of what changed.

### Why This Matters

Consider a typical project structure:

```
my-project/
├── cmd/
├── internal/
├── Dockerfile
├── .git/              # 100MB+ of history
├── vendor/            # Dependencies (if vendored)
├── bin/               # Local build outputs
├── *.log              # Log files
└── testdata/          # Test fixtures (potentially large)
```

Without proper exclusions, you're sending gigabytes of irrelevant data on every build, even if you only changed one line of code.

### The Solution: `.dockerignore`

Create a `.dockerignore` file in your build context root. The syntax mirrors `.gitignore`:

```dockerignore
# .dockerignore

# Version control
.git
.gitignore

# Build outputs (will be created inside container)
bin/
dist/

# IDE and editor files
.idea/
.vscode/
*.swp

# Local environment
.env
.env.local
*.log

# Test files (not needed in production image)
*_test.go
testdata/
coverage/

# Documentation
docs/
*.md
!README.md

# Docker files themselves
Dockerfile*
docker-compose*.yml
.dockerignore
```

**Production Best Practice:** Start with a restrictive allowlist approach for sensitive projects:

```dockerignore
# Ignore everything
*

# Allow only what's needed
!cmd/
!internal/
!pkg/
!go.mod
!go.sum
```

This approach ensures new files are excluded by default, preventing accidental inclusion of secrets or unnecessary files.

## Dockerfile Instructions Deep Dive

### FROM: Choosing Your Base Image

Every Dockerfile starts with `FROM`. This choice significantly impacts image size, security, and debugging capability.

```dockerfile
# Syntax
FROM <image>[:<tag>|@<digest>] [AS <name>]

# Examples
FROM golang:1.25                    # Tag-based, may change with patch releases
FROM golang:1.25.0                  # Pinned patch version
FROM golang:1.25.0-alpine3.21       # Alpine variant, smaller size
FROM golang@sha256:abc123...        # Digest-pinned, completely immutable
FROM golang:1.25 AS builder         # Named stage for multi-stage builds
```

#### Base Image Comparison

| Base Image          | Size   | Security  | Debugging | Best For                         |
| ------------------- | ------ | --------- | --------- | -------------------------------- |
| `scratch`           | 0 MB   | Excellent | Very Hard | Static Go binaries               |
| `distroless/static` | ~2 MB  | Excellent | Hard      | Static binaries needing CA certs |
| `alpine`            | ~8 MB  | Good      | Medium    | When you need a shell            |
| `debian-slim`       | ~75 MB | Good      | Easy      | Compatibility, glibc apps        |

**scratch** is an empty image—literally nothing. It's ideal for Go because Go can compile to fully static binaries with no external dependencies. The downside is there's no shell, no debugging tools, and no way to exec into the container. When something goes wrong in production, you can't `docker exec` to investigate.

**distroless** images from Google contain only your application and its runtime dependencies—no shell, no package manager. They include essential files like CA certificates and timezone data that `scratch` lacks. Choose `distroless/static` for Go applications that need HTTPS or timezone handling.

**alpine** uses musl libc instead of glibc, which occasionally causes compatibility issues with certain C libraries. However, it provides a shell and package manager (`apk`) in just ~8MB, making it excellent for debugging while staying small.

**debian-slim** is a stripped-down Debian with glibc. It's larger but offers maximum compatibility and familiar tooling. Choose this when you need specific packages or encounter musl compatibility issues.

#### Tag Pinning Strategy

```dockerfile
# Development: Minor version, accepts patch updates
FROM golang:1.25-alpine

# Production: Pin patch and OS version
FROM golang:1.25.3-alpine3.21

# Strict reproducibility (compliance, regulated environments)
FROM golang:1.25.3-alpine3.21@sha256:a1b2c3d4...
```

**Understanding tag mutability:** All tags—including fully specified versions like `golang:1.25.3-alpine3.21`—are technically mutable. Tags are pointers that can be reassigned when base images receive security patches or Dockerfile bugs are fixed. Only the digest (`@sha256:...`) is truly immutable.

```
┌─────────────────────────────────────────────────────────────┐
│ Tag Mutability Example                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ golang:1.25.3-alpine3.21 (tag can be reassigned)           │
│     │                                                       │
│     ├── Dec 1:  sha256:abc123... (original)                │
│     └── Dec 15: sha256:def456... (Alpine security patch)   │
│                                                             │
│ golang:1.25.3-alpine3.21@sha256:abc123... (immutable)      │
│     └── Always this exact image, content-addressed          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Practical recommendation:** For most production environments, pinning to a specific patch and OS version (`golang:1.25.3-alpine3.21`) provides a good balance. Tag reassignments at this level are infrequent and typically beneficial (security patches).

Reserve digest pinning for environments with strict compliance requirements or where bit-for-bit reproducibility is mandatory. Note that digest-pinned images won't receive automatic security updates—you must actively manage digest updates through tools like Dependabot or Renovate.

### RUN: Executing Commands and Layer Optimization

`RUN` executes commands and creates a new layer. Understanding layers is crucial for both image size and build performance.

#### The Layer Problem

```dockerfile
# Problem: Each RUN creates a layer
RUN apt-get update
RUN apt-get install -y curl git
RUN rm -rf /var/lib/apt/lists/*
```

This creates three layers. The critical issue: **deleting files in a later layer doesn't reduce image size**. The files still exist in the earlier layer; they're just marked as deleted in the overlay filesystem.

```
┌─────────────────────────────────────────────────────────────┐
│ Image Layer Stack (Problematic Approach)                    │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: rm -rf /var/lib/apt/lists/*                        │
│          (marks files as deleted, but they're still in L1)  │
│                                                             │
│ Layer 2: apt-get install curl git         +80MB             │
│                                                             │
│ Layer 1: apt-get update                   +40MB             │
│          (package lists stored here, never truly removed)   │
│                                                             │
│ Layer 0: base image                                         │
├─────────────────────────────────────────────────────────────┤
│ Total: Base + 120MB                                         │
└─────────────────────────────────────────────────────────────┘
```

#### The Solution: Single-Layer Operations

```dockerfile
# Solution: Combine into single layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*
```

Now the cleanup happens in the same layer as the installation, so the deleted files never appear in the final image.

```
┌─────────────────────────────────────────────────────────────┐
│ Image Layer Stack (Optimized Approach)                      │
├─────────────────────────────────────────────────────────────┤
│ Layer 1: update + install + cleanup       +80MB             │
│          (lists downloaded, used, deleted in same layer)    │
│                                                             │
│ Layer 0: base image                                         │
├─────────────────────────────────────────────────────────────┤
│ Total: Base + 80MB (40MB saved)                             │
└─────────────────────────────────────────────────────────────┘
```

**Production Best Practice:** For Alpine, use `apk add --no-cache` which combines update and cleanup automatically:

```dockerfile
RUN apk add --no-cache curl git
```

### COPY vs ADD: Understanding the Difference

Both instructions copy files into the image, but they have different behaviors.

```dockerfile
# COPY: Simple, predictable file copying
COPY go.mod go.sum ./
COPY --chown=appuser:appgroup config.yaml /etc/app/

# ADD: Has additional features
ADD https://example.com/file.tar.gz /tmp/      # Downloads URLs
ADD archive.tar.gz /app/                        # Auto-extracts archives
```

#### When to Use Each

**COPY** does exactly one thing: copies files from the build context to the image. It's explicit and predictable.

**ADD** has two additional behaviors: it can download files from URLs, and it automatically extracts recognized archive formats (tar, gzip, bzip2, xz). These "magic" behaviors can lead to unexpected results.

**Production Best Practice:** Always use `COPY` unless you specifically need ADD's features. When you need to download and extract, be explicit:

```dockerfile
# Explicit is better than implicit
RUN curl -fsSL https://example.com/file.tar.gz | tar -xzf - -C /app/
```

This approach makes the operation visible, allows error handling with `curl` flags, and doesn't cache the downloaded file in a layer (unlike ADD).

### ARG vs ENV: Build-Time vs Runtime Variables

This distinction confuses many developers. Understanding it is essential for proper configuration management.

```dockerfile
# ARG: Available only during build
ARG GO_VERSION=1.25
FROM golang:${GO_VERSION}-alpine

ARG APP_VERSION=dev
RUN echo "Building version: ${APP_VERSION}"
# After build completes, APP_VERSION no longer exists

# ENV: Available during build AND at runtime
ENV APP_ENV=production
ENV PORT=8080
# These are baked into the image and available when container runs
```

#### The Scope Rules

```
┌─────────────────────────────────────────────────────────────┐
│ ARG and ENV Scope                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ARG GLOBAL_VAR=value     ◄── Available before FROM          │
│                                                             │
│ FROM golang:1.25                                            │
│                                                             │
│ ARG GLOBAL_VAR           ◄── Must redeclare after FROM      │
│ ARG BUILD_VAR=default    ◄── Only available during build    │
│                                                             │
│ ENV RUNTIME_VAR=value    ◄── Available build + runtime      │
│                                                             │
│ RUN echo ${BUILD_VAR}    ◄── Works during build             │
│ RUN echo ${RUNTIME_VAR}  ◄── Works during build             │
│                                                             │
│ ─── Image Complete ─────────────────────────────────────────│
│                                                             │
│ Container runs:                                             │
│   echo ${BUILD_VAR}      ◄── Empty (ARG gone)               │
│   echo ${RUNTIME_VAR}    ◄── Works (ENV persists)           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Combining ARG and ENV

A common pattern is using ARG for build-time configuration that should also be available at runtime:

```dockerfile
ARG APP_VERSION=dev
ARG GIT_COMMIT=unknown

# Promote build args to runtime environment
ENV APP_VERSION=${APP_VERSION} \
    GIT_COMMIT=${GIT_COMMIT}
```

Build with:

```bash
docker build \
  --build-arg APP_VERSION=1.2.3 \
  --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) \
  -t myapp:1.2.3 .
```

**Security Note:** ARG values are visible in the image history (`docker history`). Never use ARG for secrets — use BuildKit secret mounts instead (covered later).

### ENTRYPOINT vs CMD: The Execution Model

This is one of the most misunderstood aspects of Dockerfiles. Both define what runs when the container starts, but they serve different purposes.

#### CMD: The Default Command

```dockerfile
CMD ["./myapp", "--port", "8080"]
```

CMD sets the default command, but it's easily overridden:

```bash
docker run myimage                    # Runs: ./myapp --port 8080
docker run myimage ./other-command    # Runs: ./other-command (CMD replaced)
```

#### ENTRYPOINT: The Fixed Executable

```dockerfile
ENTRYPOINT ["./myapp"]
CMD ["--port", "8080"]
```

ENTRYPOINT sets the executable, CMD provides default arguments:

```bash
docker run myimage                    # Runs: ./myapp --port 8080
docker run myimage --port 9090        # Runs: ./myapp --port 9090
docker run myimage --help             # Runs: ./myapp --help
```

The key insight: **ENTRYPOINT + CMD together create a command where CMD acts as default arguments**.

#### Shell Form vs Exec Form

This distinction has critical implications for signal handling:

```dockerfile
# Exec form (use this): Direct execution, proper signal handling
ENTRYPOINT ["./myapp"]
CMD ["./myapp", "--config", "/etc/app/config.yaml"]

# Shell form (avoid): Wrapped in /bin/sh -c
ENTRYPOINT ./myapp
CMD ./myapp --config /etc/app/config.yaml
```

Why does this matter? Signal handling:

```
┌─────────────────────────────────────────────────────────────┐
│ Exec Form: ENTRYPOINT ["./myapp"]                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Process tree:                                               │
│   PID 1: ./myapp                                            │
│                                                             │
│ docker stop → SIGTERM → myapp receives it → graceful exit   │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Shell Form: ENTRYPOINT ./myapp                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Process tree:                                               │
│   PID 1: /bin/sh -c "./myapp"                               │
│   PID 2: ./myapp                                            │
│                                                             │
│ docker stop → SIGTERM → shell receives it (ignores!) →      │
│ 10 second timeout → SIGKILL → hard termination              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Production Best Practice:** Always use exec form for proper signal handling and graceful shutdown.

#### Wrapper Script Pattern

Sometimes you need initialization before starting the main process:

```dockerfile
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["serve"]
```

```bash
#!/bin/sh
# docker-entrypoint.sh
set -e

# Initialization logic
echo "Starting with environment: ${APP_ENV:-development}"

# The exec replaces the shell with your app, so it becomes PID 1
exec ./myapp "$@"
```

The `exec "$@"` is crucial — it replaces the shell process with your application, ensuring proper signal handling.

### USER: Running as Non-Root

Running containers as root is a significant security risk. If an attacker escapes the container, they have root on the host. The `USER` instruction mitigates this.

```dockerfile
# Create non-root user and group with specific IDs
RUN addgroup -S -g 1001 appgroup && \
    adduser -S -u 1001 -G appgroup -H -D appuser

# Copy files with proper ownership
COPY --chown=appuser:appgroup ./app /app/

# Switch to non-root user
USER appuser:appgroup

# All subsequent commands run as appuser
CMD ["./app"]
```

#### Why Specific UIDs?

Using specific UIDs (like 1001) instead of letting the system assign them ensures consistency across builds and environments. Some orchestrators also use UID-based security policies.

**Alpine Linux flags explained:**

- `-S`: Create a system user/group
- `-g 1001` / `-u 1001`: Specific GID/UID
- `-G appgroup`: Add user to group
- `-H`: Don't create home directory
- `-D`: Don't assign password

**Production Best Practice:** Always run production containers as non-root. The only exception is when the application genuinely requires root privileges (rare).

### HEALTHCHECK: Container Health Monitoring

Health checks enable orchestrators to detect unhealthy containers and take action (restart, remove from load balancer).

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1
```

#### Parameters Explained

| Parameter        | Default | Description                                        |
| ---------------- | ------- | -------------------------------------------------- |
| `--interval`     | 30s     | Time between health checks                         |
| `--timeout`      | 30s     | Maximum time for a check to complete               |
| `--start-period` | 0s      | Grace period during startup (failures don't count) |
| `--retries`      | 3       | Consecutive failures before marking unhealthy      |

**Choosing values:**

- `interval`: Balance between quick detection and overhead. 30s is reasonable for most services.
- `timeout`: Should be less than interval. Set based on your endpoint's expected response time.
- `start-period`: Set to your application's typical startup time. Critical for JVM apps or services that load data on startup.
- `retries`: 3 is standard. Lower values cause flapping; higher values delay detection.

**Production Best Practice:** Implement a dedicated `/health` endpoint that checks actual service health (database connections, dependencies) rather than just returning 200.

## Multi-Stage Builds

Multi-stage builds are essential for production images. They allow you to use full build toolchains without including them in the final image.

```
┌─────────────────────────────────────────────────────────────┐
│ Multi-Stage Build Flow                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Stage 1: builder                Stage 2: runtime           │
│  ┌─────────────────────┐        ┌─────────────────────┐    │
│  │ Full Go toolchain   │        │ Minimal base        │    │
│  │ Source code         │        │ Binary only         │    │
│  │ Dependencies        │───────▶│ CA certificates     │    │
│  │ Build artifacts     │ COPY   │ Non-root user       │    │
│  │                     │        │                     │    │
│  │ ~1GB                │        │ ~10-20MB            │    │
│  └─────────────────────┘        └─────────────────────┘    │
│                                                             │
│  (discarded after build)        (shipped to production)     │
└─────────────────────────────────────────────────────────────┘
```

### Production Go Dockerfile

```dockerfile
# ============================================
# Stage 1: Build
# ============================================
FROM golang:1.25-alpine AS builder

# Install CA certificates and timezone data (needed at runtime)
RUN apk add --no-cache ca-certificates tzdata

# Create non-root user (we'll copy the passwd file to final stage)
RUN addgroup -S -g 1001 appgroup && \
    adduser -S -u 1001 -G appgroup -H -D appuser

WORKDIR /build

# Copy dependency files first for better caching
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Copy source code
COPY . .

# Build arguments for version embedding
ARG VERSION=dev
ARG GIT_COMMIT=unknown

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -X main.version=${VERSION} -X main.gitCommit=${GIT_COMMIT}" \
    -o /build/app \
    ./cmd/server

# ============================================
# Stage 2: Runtime
# ============================================
FROM scratch

# Import from builder
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group

# Copy binary
COPY --from=builder /build/app /app

# Use non-root user
USER appuser:appgroup

EXPOSE 8080

ENTRYPOINT ["/app"]
```

#### Key Build Flags Explained

| Flag                  | Purpose                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `CGO_ENABLED=0`       | Disable cgo for a fully static binary. Required for `scratch` base. |
| `GOOS=linux`          | Target Linux, regardless of build machine OS                        |
| `GOARCH=amd64`        | Target architecture. Use `arm64` for ARM-based systems.             |
| `-w`                  | Omit DWARF debug information. Reduces binary size.                  |
| `-s`                  | Omit symbol table. Further reduces binary size.                     |
| `-X main.version=...` | Embed values into variables at compile time                         |

**When you need CGO:** Some packages require cgo (e.g., certain database drivers, image processing). In that case, use `alpine` or `distroless` instead of `scratch`, and ensure the C libraries are present.

### Targeting Specific Stages

Multi-stage builds allow building different variants from one Dockerfile:

```dockerfile
FROM golang:1.25-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app ./cmd/server

# Development stage with hot reload
FROM golang:1.25-alpine AS development
RUN go install github.com/air-verse/air@latest
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
# Source mounted as volume at runtime
CMD ["air", "-c", ".air.toml"]

# Production stage
FROM scratch AS production
COPY --from=builder /app /app
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
ENTRYPOINT ["/app"]
```

```bash
# Build for different targets
docker build --target development -t myapp:dev .
docker build --target production -t myapp:prod .
docker build -t myapp:prod .  # Last stage is default
```

## BuildKit Features

BuildKit is Docker's modern build engine, enabled by default since Docker 23.0. It provides significant improvements over the legacy builder.

```bash
# Verify BuildKit is enabled
docker buildx version

# Explicitly enable if needed
export DOCKER_BUILDKIT=1
```

### Cache Mounts

Cache mounts persist directories between builds, dramatically speeding up dependency installation:

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./

# Cache Go module downloads
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

# Cache both modules and build cache
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -o /app ./cmd/server
```

**How it works:** The cache mount creates a directory that persists across builds on the same machine. Unlike regular layers, the cache isn't part of the image—it's build-machine-local. This is perfect for package manager caches that shouldn't be in the final image anyway.

**Note:** The `# syntax=docker/dockerfile:1` directive at the top enables the latest Dockerfile syntax features.

### Secret Mounts

Safely use secrets during build without embedding them in the image:

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build
COPY go.mod go.sum ./

# Use secret for private repo access
RUN --mount=type=secret,id=github_token \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) && \
    git config --global url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/" && \
    go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /app ./cmd/server
```

```bash
# Build with secret
docker build --secret id=github_token,src=$HOME/.github_token -t myapp .

# Or from environment
echo "$GITHUB_TOKEN" | docker build --secret id=github_token -t myapp -
```

**Why this matters:** Secrets mounted this way never appear in any layer. They're only available during the specific RUN instruction and are completely absent from the final image and build history.

### SSH Mounts

Access private repositories using SSH agent forwarding:

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git openssh-client

# Add known hosts
RUN mkdir -p -m 0700 ~/.ssh && \
    ssh-keyscan github.com >> ~/.ssh/known_hosts

WORKDIR /build
COPY go.mod go.sum ./

# Use SSH for private repos
RUN --mount=type=ssh \
    go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /app ./cmd/server
```

```bash
# Build with SSH agent
docker build --ssh default -t myapp .
```

## Layer Caching Strategies

Understanding layer caching is essential for fast builds.

### Cache Invalidation Rules

The key rule: **If a layer changes, all subsequent layers are invalidated and rebuilt.**

```
┌─────────────────────────────────────────────────────────────┐
│ Cache Invalidation Example                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Layer 1: FROM golang:1.25          ✓ cached                 │
│ Layer 2: COPY go.mod go.sum ./     ✓ cached (files same)    │
│ Layer 3: RUN go mod download       ✓ cached                 │
│ Layer 4: COPY . .                  ✗ CHANGED (code changed) │
│ Layer 5: RUN go build              ✗ REBUILT (invalidated)  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Optimal Instruction Ordering

Order instructions from least to most frequently changing:

```dockerfile
# GOOD: Dependencies before source code
FROM golang:1.25-alpine
WORKDIR /build

# 1. Dependency files change infrequently
COPY go.mod go.sum ./
RUN go mod download

# 2. Source code changes frequently (but doesn't invalidate dep cache)
COPY . .
RUN go build -o /app ./cmd/server

# ─────────────────────────────────────────────────

# BAD: Source code before dependencies
FROM golang:1.25-alpine
WORKDIR /build

# Any code change invalidates everything below
COPY . .
RUN go mod download
RUN go build -o /app ./cmd/server
```

In the good example, changing your source code only rebuilds the `COPY . .` and `go build` layers. The `go mod download` layer remains cached because `go.mod` and `go.sum` haven't changed.

## Development vs Production Dockerfiles

Development optimizes for fast iteration; production optimizes for security and size.

### Development Dockerfile

```dockerfile
# Dockerfile.dev
FROM golang:1.25-alpine

# Install development tools
RUN go install github.com/air-verse/air@latest && \
    go install github.com/go-delve/delve/cmd/dlv@latest

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Source code mounted as volume (not copied)
# See docker-compose.yml

EXPOSE 8080 2345

CMD ["air", "-c", ".air.toml"]
```

Used with Docker Compose:

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.dev
    volumes:
      - .:/app # Mount source for hot reload
      - go-mod-cache:/go/pkg/mod # Persist module cache
    ports:
      - '8080:8080' # Application
      - '2345:2345' # Debugger

volumes:
  go-mod-cache:
```

### Production Dockerfile

The multi-stage Dockerfile shown earlier is production-ready. Key differences from development:

| Aspect      | Development                     | Production                        |
| ----------- | ------------------------------- | --------------------------------- |
| Base image  | Full SDK (`golang:1.25-alpine`) | Minimal (`scratch`, `distroless`) |
| Source code | Volume mounted                  | Copied and compiled               |
| Tools       | Debugger, hot reload            | None                              |
| User        | Often root for simplicity       | Non-root                          |
| Size        | ~1GB                            | ~10-20MB                          |

---

## Cheatsheet

### Instruction Quick Reference

| Instruction   | Purpose                       | Example                                                         |
| ------------- | ----------------------------- | --------------------------------------------------------------- |
| `FROM`        | Base image                    | `FROM golang:1.25-alpine AS builder`                            |
| `WORKDIR`     | Set working directory         | `WORKDIR /app`                                                  |
| `COPY`        | Copy files                    | `COPY --chown=user:group src/ dest/`                            |
| `RUN`         | Execute command               | `RUN apk add --no-cache curl`                                   |
| `ENV`         | Runtime environment variable  | `ENV APP_ENV=production`                                        |
| `ARG`         | Build-time variable           | `ARG VERSION=dev`                                               |
| `EXPOSE`      | Document port (metadata only) | `EXPOSE 8080`                                                   |
| `USER`        | Set runtime user              | `USER appuser:appgroup`                                         |
| `ENTRYPOINT`  | Container executable          | `ENTRYPOINT ["./app"]`                                          |
| `CMD`         | Default arguments             | `CMD ["--port", "8080"]`                                        |
| `HEALTHCHECK` | Health monitoring             | `HEALTHCHECK CMD wget -q --spider http://localhost:8080/health` |

### BuildKit Mount Types

| Mount    | Purpose                | Example                                 |
| -------- | ---------------------- | --------------------------------------- |
| `cache`  | Persist between builds | `--mount=type=cache,target=/go/pkg/mod` |
| `secret` | Temporary secrets      | `--mount=type=secret,id=token`          |
| `ssh`    | SSH agent access       | `--mount=type=ssh`                      |

### Go Build Flags

```dockerfile
# Production static binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o /app ./cmd/server
```

### Common Patterns

```dockerfile
# Non-root user (Alpine)
RUN addgroup -S -g 1001 appgroup && \
    adduser -S -u 1001 -G appgroup -H -D appuser
USER appuser:appgroup

# Layer-efficient apk
RUN apk add --no-cache curl git

# Cache mounts for Go
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -o /app ./cmd/server
```

### Base Image Sizes

| Image                      | Size   | Shell | Use Case                   |
| -------------------------- | ------ | ----- | -------------------------- |
| `scratch`                  | 0 MB   | No    | Static Go binaries         |
| `gcr.io/distroless/static` | ~2 MB  | No    | Static binaries + CA certs |
| `alpine:3.21`              | ~8 MB  | Yes   | Need shell/debugging       |
| `debian:bookworm-slim`     | ~75 MB | Yes   | glibc compatibility        |

---

## Further Reading

- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [BuildKit documentation](https://docs.docker.com/build/buildkit/)
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Best practices for writing Dockerfiles](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
