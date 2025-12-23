---
title: Docker Security
description: A guide covers practical security measures to harden the docker deployments for production.
date: 2025-12-14
---

# Docker Security

Containers provide process isolation, but they're not inherently secure. A misconfigured container can expose your host system, leak secrets, or become an attack vector. This guide covers practical security measures to harden your Docker deployments for production.

## Security Layers Overview

Container security is defense in depth—multiple layers working together:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Defense in Depth                                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ Layer 1: Image Security                                      │  │
│   │ • Trusted base images                                        │  │
│   │ • Minimal attack surface                                     │  │
│   │ • No secrets in images                                       │  │
│   │ • Vulnerability scanning                                     │  │
│   └─────────────────────────────────────────────────────────────┘  │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ Layer 2: Build Security                                      │  │
│   │ • Multi-stage builds                                         │  │
│   │ • BuildKit secrets                                           │  │
│   │ • .dockerignore                                              │  │
│   └─────────────────────────────────────────────────────────────┘  │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ Layer 3: Runtime Security                                    │  │
│   │ • Non-root user                                              │  │
│   │ • Read-only filesystem                                       │  │
│   │ • Dropped capabilities                                       │  │
│   │ • Resource limits                                            │  │
│   └─────────────────────────────────────────────────────────────┘  │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │ Layer 4: Network Security                                    │  │
│   │ • Network segmentation                                       │  │
│   │ • Minimal port exposure                                      │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Image Security

### Choosing Base Images

Your base image is your foundation. A compromised or bloated base image undermines everything built on top.

**Base Image Selection:**

| Image Type    | Example                    | Pros                          | Cons                           | Use When                    |
| ------------- | -------------------------- | ----------------------------- | ------------------------------ | --------------------------- |
| Scratch       | `FROM scratch`             | Zero attack surface           | No shell, no debugging         | Static Go binaries          |
| Distroless    | `gcr.io/distroless/static` | Minimal, no shell             | Hard to debug                  | Static binaries, production |
| Alpine        | `alpine:3.21`              | Small (~8MB), shell available | musl libc (rare compat issues) | Need shell, small size      |
| Slim variants | `debian:bookworm-slim`     | Smaller than full, glibc      | Larger than Alpine             | glibc compatibility         |

**Production recommendation:** Use the smallest image that meets your needs. Fewer packages = fewer vulnerabilities.

```dockerfile
# Go: Use scratch or distroless for production
FROM golang:1.25-alpine AS builder
WORKDIR /build
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o /app ./cmd/server

FROM scratch
COPY --from=builder /app /app
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
ENTRYPOINT ["/app"]
```

### Vulnerability Scanning

Scan images for known vulnerabilities before deployment. The two most popular tools are **Trivy** and **Grype**.

**Trivy (recommended):**

```bash
# Install
brew install trivy  # macOS
apt install trivy   # Debian/Ubuntu

# Scan an image
$ trivy image myapp:latest

myapp:latest (alpine 3.21)
============================
Total: 2 (UNKNOWN: 0, LOW: 1, MEDIUM: 1, HIGH: 0, CRITICAL: 0)

┌───────────────┬──────────────────┬──────────┬─────────────────────┐
│    Library    │  Vulnerability   │ Severity │  Installed Version  │
├───────────────┼──────────────────┼──────────┼─────────────────────┤
│ libcrypto3    │ CVE-2024-XXXXX   │ MEDIUM   │ 3.1.4-r0            │
│ libssl3       │ CVE-2024-YYYYY   │ LOW      │ 3.1.4-r0            │
└───────────────┴──────────────────┴──────────┴─────────────────────┘

# Scan and fail on HIGH/CRITICAL (for CI/CD)
$ trivy image --exit-code 1 --severity HIGH,CRITICAL myapp:latest

# Scan Dockerfile for misconfigurations
$ trivy config Dockerfile
```

**Grype:**

```bash
# Install
brew install grype

# Scan an image
$ grype myapp:latest

# Fail on high severity (for CI/CD)
$ grype myapp:latest --fail-on high
```

### Keeping Images Updated

Vulnerabilities are discovered constantly. Stale images accumulate vulnerabilities over time.

**Best practices:**

1. **Rebuild regularly** — Even without code changes, rebuild weekly to pick up base image patches
2. **Pin and update deliberately** — Pin to specific versions, update as part of maintenance
3. **Automate scanning** — Scan in CI/CD and block deployments with critical vulnerabilities

## Build-Time Security

### Never Embed Secrets in Images

Secrets in images are easily extracted. Anyone with image access can see them.

```dockerfile
# NEVER DO THIS
ENV API_KEY=supersecret123
COPY credentials.json /app/

# Even if you delete later, it's still in a previous layer
COPY secret.key /tmp/
RUN ./setup.sh && rm /tmp/secret.key  # Still in image history!
```

**Verify secrets aren't in your image:**

```bash
# View image history - secrets in ENV or COPY are visible
$ docker history myapp:latest

# Export and inspect image layers
$ docker save myapp:latest | tar -xf - -C /tmp/image
$ find /tmp/image -name "*.tar" -exec tar -tf {} \; | grep -i secret
```

### BuildKit Secrets

For secrets needed only during build (e.g., private repo access), use BuildKit secret mounts:

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS builder

# Secret is mounted only during this RUN command
# Never written to any layer
RUN --mount=type=secret,id=github_token \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) && \
    git config --global url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/" && \
    go mod download

COPY . .
RUN go build -o /app ./cmd/server

FROM scratch
COPY --from=builder /app /app
ENTRYPOINT ["/app"]
```

```bash
# Build with secret
$ docker build --secret id=github_token,src=$HOME/.github_token -t myapp .

# The secret is NOT in the final image or any layer
$ docker history myapp:latest  # No trace of github_token
```

### .dockerignore for Secret Prevention

Prevent secrets from entering the build context:

```dockerignore
# .dockerignore

# Secrets and credentials
.env
.env.*
*.pem
*.key
*credentials*
*secret*
.aws/
.ssh/

# Git (may contain secrets in history)
.git

# IDE configs (may contain tokens)
.idea/
.vscode/

# Local development
docker-compose*.yml
```

### Multi-Stage Builds for Security

Multi-stage builds naturally exclude build tools and intermediate files:

```dockerfile
FROM golang:1.25-alpine AS builder
# Build tools, source code, dependencies all here
WORKDIR /build
COPY . .
RUN go build -o /app ./cmd/server

FROM scratch
# Only the binary - no Go toolchain, no source code
COPY --from=builder /app /app
ENTRYPOINT ["/app"]
```

What stays out of the final image:

- Go compiler and toolchain (~500MB)
- Source code
- Test files
- Build-time dependencies
- Any secrets used during build (if using BuildKit mounts)

## Runtime Security

### Running as Non-Root

By default, containers run as root. If an attacker escapes the container, they have root on the host.

```dockerfile
FROM golang:1.25-alpine AS builder
WORKDIR /build
COPY . .
RUN CGO_ENABLED=0 go build -o /app ./cmd/server

FROM alpine:3.21

# Create non-root user
RUN addgroup -S -g 1001 appgroup && \
    adduser -S -u 1001 -G appgroup -H -D appuser

# Copy binary with correct ownership
COPY --from=builder --chown=appuser:appgroup /app /app

# Switch to non-root user
USER appuser:appgroup

ENTRYPOINT ["/app"]
```

**Verify container runs as non-root:**

```bash
$ docker run myapp:latest whoami
appuser

$ docker run myapp:latest id
uid=1001(appuser) gid=1001(appgroup) groups=1001(appgroup)
```

### Read-Only Root Filesystem

Prevent runtime modifications to the container filesystem:

```bash
# Run with read-only filesystem
$ docker run --read-only myapp:latest

# If your app needs to write temp files, add tmpfs mounts
$ docker run --read-only \
    --tmpfs /tmp:rw,noexec,nosuid \
    --tmpfs /app/cache:rw,noexec,nosuid \
    myapp:latest
```

In Compose:

```yaml
services:
  api:
    image: myapp:latest
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid
```

**Why this matters:** If an attacker gains code execution, they can't:

- Modify application binaries
- Install additional tools
- Create persistence mechanisms

### Dropping Capabilities

Linux capabilities grant specific privileges. Containers get a default set that's often more than needed.

```bash
# See default capabilities
$ docker run --rm alpine cat /proc/1/status | grep Cap
CapPrm: 00000000a80425fb
CapEff: 00000000a80425fb

# Drop all capabilities, add only what's needed
$ docker run --cap-drop=ALL --cap-add=NET_BIND_SERVICE myapp:latest
```

**Common capabilities:**

| Capability         | Purpose               | Usually Needed?           |
| ------------------ | --------------------- | ------------------------- |
| `NET_BIND_SERVICE` | Bind to ports < 1024  | Only if binding to 80/443 |
| `CHOWN`            | Change file ownership | Rarely                    |
| `SETUID`, `SETGID` | Change UID/GID        | Rarely                    |
| `NET_RAW`          | Raw sockets (ping)    | Rarely                    |
| `SYS_ADMIN`        | Many admin operations | Almost never (dangerous)  |

**Production recommendation:** Start with `--cap-drop=ALL` and add back only what your application actually needs.

### No New Privileges

Prevent processes from gaining additional privileges through setuid binaries or capabilities:

```bash
$ docker run --security-opt=no-new-privileges:true myapp:latest
```

In Compose:

```yaml
services:
  api:
    image: myapp:latest
    security_opt:
      - no-new-privileges:true
```

### Resource Limits

Prevent denial-of-service through resource exhaustion:

```bash
$ docker run \
    --memory=512m \
    --memory-swap=512m \
    --cpus=1 \
    --pids-limit=100 \
    myapp:latest
```

| Limit  | Flag                 | Purpose                  |
| ------ | -------------------- | ------------------------ |
| Memory | `--memory=512m`      | Prevent OOM on host      |
| Swap   | `--memory-swap=512m` | Same as memory = no swap |
| CPU    | `--cpus=1`           | Prevent CPU starvation   |
| PIDs   | `--pids-limit=100`   | Prevent fork bombs       |

In Compose:

```yaml
services:
  api:
    image: myapp:latest
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 128M
```

### Combining Runtime Security Options

A hardened production container:

```bash
$ docker run -d \
    --name api \
    --user 1001:1001 \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --cap-drop=ALL \
    --security-opt=no-new-privileges:true \
    --memory=512m \
    --cpus=1 \
    --pids-limit=100 \
    --health-cmd="wget -q --spider http://localhost:8080/health || exit 1" \
    --health-interval=30s \
    myapp:latest
```

In Compose:

```yaml
services:
  api:
    image: myapp:latest
    user: '1001:1001'
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=64m
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
    healthcheck:
      test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:8080/health']
      interval: 30s
      timeout: 10s
      retries: 3
```

## Network Security

### Minimal Port Exposure

Only expose ports that need external access:

```yaml
services:
  api:
    ports:
      - '8080:8080' # Exposed to host

  db:
    # No ports - only accessible from other containers
    # api can reach db:5432 via Docker network

  redis:
    # No ports - internal only
```

**Common mistake:** Exposing database ports for debugging and forgetting to remove them.

### Bind to Localhost

For local development, bind to localhost to prevent network exposure:

```yaml
services:
  api:
    ports:
      - '127.0.0.1:8080:8080' # Only accessible from localhost
```

### Network Segmentation

Isolate services that don't need to communicate:

```yaml
services:
  api:
    networks:
      - frontend
      - backend

  db:
    networks:
      - backend # Not on frontend - can't be reached from nginx

  nginx:
    networks:
      - frontend # Can reach api, cannot reach db

networks:
  frontend:
  backend:
```

```
┌─────────────────────────────────────────────────────────────────────┐
│ Network Segmentation                                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Internet                                                          │
│       │                                                             │
│       ▼                                                             │
│   ┌───────┐     frontend      ┌─────┐     backend      ┌────┐     │
│   │ nginx │◄─────────────────▶│ api │◄────────────────▶│ db │     │
│   └───────┘     network       └─────┘     network      └────┘     │
│       │                          │                                  │
│       └──────────────────────────┘                                  │
│              nginx can reach api                                    │
│              nginx CANNOT reach db (different network)              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Secrets Management

### The Problem with Environment Variables

Environment variables are visible in many places:

```bash
# Anyone with Docker access can see env vars
$ docker inspect mycontainer --format '{{.Config.Env}}'
[API_KEY=supersecret DATABASE_URL=postgres://user:pass@db/app]

# They appear in /proc inside the container
$ docker exec mycontainer cat /proc/1/environ
```

**Environment variables are acceptable for:**

- Non-sensitive configuration (log level, feature flags)
- Development environments

**Use proper secrets management for:**

- API keys, tokens
- Database passwords
- TLS certificates

### Runtime Secret Injection

**Option 1: Mount secrets as files**

```bash
# Create secret file on host (not in image)
$ echo "supersecret" > /run/secrets/api_key
$ chmod 600 /run/secrets/api_key

# Mount into container
$ docker run -v /run/secrets/api_key:/run/secrets/api_key:ro myapp:latest
```

Application reads from file:

```go
apiKey, err := os.ReadFile("/run/secrets/api_key")
```

**Option 2: External secrets manager**

In production, use a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.):

```go
// Application fetches secrets at startup
func getSecret(name string) (string, error) {
    // AWS Secrets Manager example
    client := secretsmanager.NewFromConfig(cfg)
    result, err := client.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
        SecretId: aws.String(name),
    })
    return *result.SecretString, err
}
```

The container only needs IAM credentials (via instance role) or Vault token to access secrets.

## CI/CD Security

### Scanning in Pipelines

Integrate vulnerability scanning into your CI/CD pipeline:

```yaml
# .github/workflows/docker.yml
name: Build and Scan

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: docker build -t myapp:${{ github.sha }} .

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: myapp:${{ github.sha }}
          format: 'table'
          exit-code: '1' # Fail pipeline on vulnerabilities
          ignore-unfixed: true # Only fail on fixable vulnerabilities
          severity: 'CRITICAL,HIGH' # Fail on HIGH and CRITICAL

      - name: Push image
        if: github.ref == 'refs/heads/main'
        run: |
          docker tag myapp:${{ github.sha }} registry.example.com/myapp:latest
          docker push registry.example.com/myapp:latest
```

### Image Signing (Optional)

For high-security environments, sign images to verify authenticity:

```bash
# Sign with cosign
$ cosign sign --key cosign.key registry.example.com/myapp:latest

# Verify before deployment
$ cosign verify --key cosign.pub registry.example.com/myapp:latest
```

## Security Scanning Tools Comparison

| Tool             | Type                  | Strengths                                   | Best For             |
| ---------------- | --------------------- | ------------------------------------------- | -------------------- |
| **Trivy**        | Vulnerability scanner | Fast, comprehensive, easy CI/CD integration | General use, CI/CD   |
| **Grype**        | Vulnerability scanner | Fast, good accuracy                         | Alternative to Trivy |
| **Docker Scout** | Vulnerability scanner | Built into Docker Desktop                   | Docker Desktop users |
| **Hadolint**     | Dockerfile linter     | Best practice enforcement                   | Dockerfile quality   |
| **Dockle**       | Image linter          | CIS benchmark checks                        | Compliance           |

**Recommended combination:**

- **Trivy** for vulnerability scanning
- **Hadolint** for Dockerfile linting

```bash
# Lint Dockerfile
$ hadolint Dockerfile

# Scan image for vulnerabilities
$ trivy image myapp:latest

# Scan for CIS benchmark compliance
$ dockle myapp:latest
```

## Security Checklist

### Image Security

- [ ] Use minimal base images (scratch, distroless, alpine)
- [ ] Pin base image versions
- [ ] Scan for vulnerabilities in CI/CD
- [ ] Rebuild images regularly for security patches
- [ ] No secrets in images (verify with `docker history`)

### Build Security

- [ ] Use `.dockerignore` to exclude secrets
- [ ] Use BuildKit secret mounts for build-time secrets
- [ ] Use multi-stage builds to exclude build tools
- [ ] Scan Dockerfiles with hadolint

### Runtime Security

- [ ] Run as non-root user
- [ ] Use read-only root filesystem
- [ ] Drop all capabilities, add only needed ones
- [ ] Set `no-new-privileges`
- [ ] Set resource limits (memory, CPU, PIDs)

### Network Security

- [ ] Expose only necessary ports
- [ ] Use network segmentation
- [ ] Bind to localhost in development

### Secrets Management

- [ ] No secrets in environment variables (production)
- [ ] Use file mounts or secrets manager
- [ ] Rotate secrets regularly

---

## Cheatsheet

### Dockerfile Security

```dockerfile
# Minimal base image
FROM scratch
# or
FROM gcr.io/distroless/static

# Non-root user
RUN addgroup -S -g 1001 appgroup && \
    adduser -S -u 1001 -G appgroup -H -D appuser
USER appuser:appgroup

# BuildKit secrets (never stored in layer)
RUN --mount=type=secret,id=token \
    TOKEN=$(cat /run/secrets/token) && ./setup.sh
```

### Runtime Security Flags

```bash
docker run \
    --user 1001:1001 \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid \
    --cap-drop=ALL \
    --security-opt=no-new-privileges:true \
    --memory=512m \
    --cpus=1 \
    --pids-limit=100 \
    myapp:latest
```

### Compose Security

```yaml
services:
  api:
    image: myapp:latest
    user: '1001:1001'
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
```

### Scanning Commands

```bash
# Vulnerability scan
trivy image myapp:latest
trivy image --exit-code 1 --severity HIGH,CRITICAL myapp:latest

# Dockerfile lint
hadolint Dockerfile

# CIS benchmark
dockle myapp:latest
```

---

## Further Reading

- [Docker Security Documentation](https://docs.docker.com/engine/security/)
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker)
- [Trivy Documentation](https://aquasecurity.github.io/trivy/)
- [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
