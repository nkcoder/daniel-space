---
title: Docker in CI/CD
description: Building production-ready CI/CD pipelines using Github Actions using docker
date: 2025-12-22
---

# Docker in CI/CD

Automating Docker image builds, tests, and deployments is essential for modern software delivery. This guide covers building production-ready CI/CD pipelines using GitHub Actions, from basic builds to advanced multi-platform images with security scanning.

## GitHub Actions Docker Ecosystem

GitHub Actions provides official Docker actions that handle the complexity of building and pushing images:

| Action                       | Purpose                                  |
| ---------------------------- | ---------------------------------------- |
| `docker/setup-buildx-action` | Set up Docker Buildx for advanced builds |
| `docker/build-push-action`   | Build and push Docker images             |
| `docker/login-action`        | Authenticate with container registries   |
| `docker/metadata-action`     | Generate image tags and labels           |

These actions work together to create robust pipelines:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Typical CI/CD Pipeline Flow                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐           │
│   │ Checkout│──▶│  Setup  │──▶│  Login  │──▶│Metadata │           │
│   │  Code   │   │ Buildx  │   │Registry │   │  Tags   │           │
│   └─────────┘   └─────────┘   └─────────┘   └────┬────┘           │
│                                                   │                 │
│                                                   ▼                 │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐           │
│   │  Push   │◀──│  Scan   │◀──│  Test   │◀──│  Build  │           │
│   │ to Reg  │   │ Vulns   │   │  Image  │   │  Image  │           │
│   └─────────┘   └─────────┘   └─────────┘   └─────────┘           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Basic Build and Push Pipeline

Let's start with a simple pipeline that builds and pushes to GitHub Container Registry (ghcr.io):

```yaml
# .github/workflows/docker-build.yml
name: Build and Push Docker Image

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build:
    runs-on: ubuntu-latest

    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata (tags, labels)
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

### Understanding Each Step

**Permissions:**

```yaml
permissions:
  contents: read # Read repository contents
  packages: write # Push to GitHub Container Registry
```

GitHub Actions uses the `GITHUB_TOKEN` to authenticate. The `packages: write` permission is required to push images to ghcr.io.

**Buildx Setup:**

```yaml
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3
```

Buildx is Docker's extended build capabilities (BuildKit). It enables advanced features like multi-platform builds and better caching.

**Conditional Push:**

```yaml
push: ${{ github.event_name != 'pull_request' }}
```

Build on all events, but only push on `main` branch (not on PRs). This validates PRs without publishing potentially broken images.

## Image Tagging Strategies

The `docker/metadata-action` automatically generates tags based on Git context. Understanding tagging strategies is crucial for production workflows.

### Default Behavior

```yaml
- name: Extract metadata
  id: meta
  uses: docker/metadata-action@v5
  with:
    images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
```

This generates tags based on the Git event:

| Event          | Ref                     | Tags Generated     |
| -------------- | ----------------------- | ------------------ |
| Push to branch | `refs/heads/main`       | `main`             |
| Push to branch | `refs/heads/feat/login` | `feat-login`       |
| Push tag       | `refs/tags/v1.2.3`      | `v1.2.3`, `latest` |
| Pull request   | `refs/pull/123/merge`   | `pr-123`           |

### Custom Tagging Rules

For production, you typically want more control:

```yaml
- name: Extract metadata
  id: meta
  uses: docker/metadata-action@v5
  with:
    images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
    tags: |
      # Set latest tag for default branch
      type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      # Branch name
      type=ref,event=branch

      # Semantic versioning from git tag
      type=semver,pattern={{version}}
      type=semver,pattern={{major}}.{{minor}}
      type=semver,pattern={{major}},enable=${{ !startsWith(github.ref, 'refs/tags/v0.') }}

      # Short commit SHA
      type=sha,prefix=sha-

      # Pull request number
      type=ref,event=pr
```

**Resulting tags for `git tag v1.2.3`:**

- `v1.2.3` (full version)
- `1.2` (major.minor)
- `1` (major only, for v1.0.0+)
- `sha-abc1234` (commit SHA)

### The `latest` Tag Debate

**Should you use `latest`?**

| Approach               | Pros                       | Cons                        |
| ---------------------- | -------------------------- | --------------------------- |
| Use `latest`           | Convenient for development | Ambiguous, not reproducible |
| Avoid `latest`         | Explicit versioning        | Harder for quick testing    |
| `latest` = stable only | Clear meaning              | Requires discipline         |

**Production recommendation:** Use `latest` to point to the most recent stable release, not every main branch build. Tag releases explicitly:

```yaml
tags: |
  # latest only on semantic version tags (releases)
  type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}
  type=semver,pattern={{version}}
  type=sha,prefix=sha-
```

## Layer Caching for Faster Builds

Without caching, every CI build downloads dependencies and rebuilds all layers. Caching can reduce build times from minutes to seconds.

### GitHub Actions Cache

```yaml
- name: Build and push
  uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    tags: ${{ steps.meta.outputs.tags }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

`type=gha` uses GitHub Actions' built-in cache storage. The `mode=max` exports all layers, not just the final image layers.

### Registry Cache

Store cache layers in a container registry:

```yaml
- name: Build and push
  uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    tags: ${{ steps.meta.outputs.tags }}
    cache-from: type=registry,ref=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:buildcache
    cache-to: type=registry,ref=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:buildcache,mode=max
```

**Comparison:**

| Cache Type      | Speed            | Storage         | Cross-Workflow | Cross-Branch |
| --------------- | ---------------- | --------------- | -------------- | ------------ |
| `type=gha`      | Fast             | 10GB limit      | Yes            | Limited      |
| `type=registry` | Slower (network) | Registry limits | Yes            | Yes          |

**Recommendation:** Start with `type=gha` for simplicity. Switch to registry cache if you hit the 10GB limit or need cross-branch caching.

### Optimizing Dockerfile for Caching

Caching is only effective if your Dockerfile is structured properly (see Blog 2):

```dockerfile
# Dependencies change infrequently - cached
COPY go.mod go.sum ./
RUN go mod download

# Source changes frequently - rebuild only this layer
COPY . .
RUN go build -o /app ./cmd/server
```

## Multi-Platform Builds

Build images for multiple architectures (amd64, arm64) to support different deployment targets:

```yaml
name: Multi-Platform Build

on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.ref_name }}
```

**Key additions:**

- `docker/setup-qemu-action` — Enables emulation for cross-platform builds
- `platforms: linux/amd64,linux/arm64` — Build for both x86 and ARM

**When to use multi-platform builds:**

- Deploying to ARM-based servers (AWS Graviton, Apple Silicon Macs)
- Supporting diverse development environments
- Kubernetes clusters with mixed node architectures

**Trade-off:** Multi-platform builds take longer. Consider building platforms in parallel jobs for faster pipelines.

## Registry Authentication

### GitHub Container Registry (ghcr.io)

```yaml
- name: Login to GitHub Container Registry
  uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}
```

No secrets configuration needed—`GITHUB_TOKEN` is automatically available.

### Docker Hub

```yaml
- name: Login to Docker Hub
  uses: docker/login-action@v3
  with:
    username: ${{ secrets.DOCKERHUB_USERNAME }}
    password: ${{ secrets.DOCKERHUB_TOKEN }}
```

Create secrets in repository settings: Settings → Secrets and variables → Actions.

### AWS Elastic Container Registry (ECR)

```yaml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: us-east-1

- name: Login to Amazon ECR
  id: login-ecr
  uses: aws-actions/amazon-ecr-login@v2

- name: Build and push
  uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    tags: ${{ steps.login-ecr.outputs.registry }}/my-app:${{ github.sha }}
```

### Google Artifact Registry

```yaml
- name: Authenticate to Google Cloud
  uses: google-github-actions/auth@v2
  with:
    credentials_json: ${{ secrets.GCP_CREDENTIALS }}

- name: Login to Artifact Registry
  uses: docker/login-action@v3
  with:
    registry: us-docker.pkg.dev
    username: _json_key
    password: ${{ secrets.GCP_CREDENTIALS }}
```

## Security Scanning in CI

Integrate vulnerability scanning to catch issues before deployment.

### Trivy Scanner

```yaml
- name: Build image
  uses: docker/build-push-action@v6
  with:
    context: .
    load: true # Load image into Docker daemon
    tags: ${{ env.IMAGE_NAME }}:test

- name: Run Trivy vulnerability scanner
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: ${{ env.IMAGE_NAME }}:test
    format: 'table'
    exit-code: '1' # Fail pipeline on vulnerabilities
    ignore-unfixed: true # Only fail on fixable vulnerabilities
    severity: 'CRITICAL,HIGH' # Fail on HIGH and CRITICAL only
```

### Scanning with SARIF Upload

Upload results to GitHub Security tab:

```yaml
- name: Run Trivy vulnerability scanner
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: ${{ env.IMAGE_NAME }}:test
    format: 'sarif'
    output: 'trivy-results.sarif'

- name: Upload Trivy scan results to GitHub Security tab
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: 'trivy-results.sarif'
```

This enables vulnerability tracking in the GitHub Security tab and creates alerts for new vulnerabilities.

## Testing in CI

### Running Tests in Docker

```yaml
- name: Run tests
  run: |
    docker build --target test -t ${{ env.IMAGE_NAME }}:test .
    docker run --rm ${{ env.IMAGE_NAME }}:test
```

This requires a test stage in your Dockerfile:

```dockerfile
FROM golang:1.25-alpine AS builder
WORKDIR /build
COPY . .
RUN go build -o /app ./cmd/server

FROM builder AS test
RUN go test -v ./...

FROM scratch AS production
COPY --from=builder /app /app
ENTRYPOINT ["/app"]
```

### Integration Testing with Service Containers

GitHub Actions supports service containers for integration tests:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: testdb
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v6

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.25'

      - name: Run integration tests
        env:
          DATABASE_URL: postgres://postgres:testpass@localhost:5432/testdb
          REDIS_URL: redis://localhost:6379
        run: go test -v -tags=integration ./...
```

### Testing with Docker Compose

For complex test scenarios:

```yaml
- name: Run integration tests
  run: |
    docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test

- name: Cleanup
  if: always()
  run: docker compose -f docker-compose.test.yml down -v
```

```yaml
# docker-compose.test.yml
services:
  test:
    build:
      context: .
      target: test
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/testdb
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: testdb
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U app -d testdb']
      interval: 5s
      timeout: 5s
      retries: 5
```

## Optimizing CI Performance

### Conditional Builds

Skip builds when only documentation changes:

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - '**.md'
      - 'docs/**'
      - '.github/ISSUE_TEMPLATE/**'
```

Or only build when relevant files change:

```yaml
on:
  push:
    paths:
      - 'src/**'
      - 'Dockerfile'
      - 'go.mod'
      - 'go.sum'
      - '.github/workflows/docker-build.yml'
```

### Parallel Jobs

Split builds across multiple jobs:

```yaml
jobs:
  build-amd64:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/build-push-action@v6
        with:
          platforms: linux/amd64
          # ...

  build-arm64:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/build-push-action@v6
        with:
          platforms: linux/arm64
          # ...

  merge-manifests:
    needs: [build-amd64, build-arm64]
    runs-on: ubuntu-latest
    steps:
      - name: Create multi-arch manifest
        run: |
          docker buildx imagetools create -t $IMAGE:latest \
            $IMAGE:amd64 \
            $IMAGE:arm64
```

### Self-Hosted Runners

For large images or frequent builds, self-hosted runners can be faster:

```yaml
jobs:
  build:
    runs-on: self-hosted
    steps:
      # Build steps - uses local Docker cache
```

Benefits:

- Persistent Docker layer cache
- Faster network to private registries
- Custom hardware (more CPU/RAM)

---

## Complete Example: Go Application to AWS ECS Fargate

Here's a comprehensive, production-ready pipeline that builds a Go application and deploys it to AWS ECS Fargate. This example includes all best practices covered in this blog.

Project structure:

```
my-go-service/
├── .github/
│   └── workflows/
│       └── ci-cd.yml
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   └── ...
├── Dockerfile
├── .dockerignore
└── go.mod
```

Production Dockerfile:

```
# Dockerfile
# ============================================
# Stage 1: Build
# ============================================
FROM golang:1.25-alpine AS builder

RUN apk add --no-cache ca-certificates tzdata git

RUN addgroup -S -g 1001 appgroup && \
    adduser -S -u 1001 -G appgroup -H -D appuser

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download && go mod verify

COPY . .

ARG VERSION=dev
ARG GIT_COMMIT=unknown

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -X main.version=${VERSION} -X main.gitCommit=${GIT_COMMIT}" \
    -o /build/server \
    ./cmd/server

# ============================================
# Stage 2: Test (optional target)
# ============================================
FROM builder AS test
RUN go test -v -race ./...

# ============================================
# Stage 3: Production
# ============================================
FROM scratch

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group

COPY --from=builder /build/server /server

USER appuser:appgroup

EXPOSE 8080

ENTRYPOINT ["/server"]
```

CI/CD Pipeline:

```
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: my-go-service
  ECS_CLUSTER: production-cluster
  ECS_SERVICE: my-go-service
  ECS_TASK_DEFINITION: .aws/task-definition.json
  CONTAINER_NAME: my-go-service

permissions:
  contents: read
  id-token: write        # Required for OIDC authentication with AWS
  security-events: write # Required for uploading Trivy results

jobs:
  # ═══════════════════════════════════════════════════════════════════
  # Job 1: Lint and Test
  # ═══════════════════════════════════════════════════════════════════
  test:
    name: Lint & Test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.25'
          cache: true

      - name: Run golangci-lint
        uses: golangci/golangci-lint-action@v6
        with:
          version: latest

      - name: Run tests
        run: go test -v -race -coverprofile=coverage.out ./...

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage.out
          fail_ci_if_error: false

  # ═══════════════════════════════════════════════════════════════════
  # Job 2: Build, Scan, and Push
  # ═══════════════════════════════════════════════════════════════════
  build:
    name: Build & Push
    runs-on: ubuntu-latest
    needs: test

    outputs:
      image: ${{ steps.build.outputs.imageid }}
      digest: ${{ steps.build.outputs.digest }}
      tags: ${{ steps.meta.outputs.tags }}
      version: ${{ steps.meta.outputs.version }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      # ─────────────────────────────────────────────────────────────
      # AWS Authentication using OIDC (recommended)
      # ─────────────────────────────────────────────────────────────
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      # ─────────────────────────────────────────────────────────────
      # Generate Image Tags
      # ─────────────────────────────────────────────────────────────
      - name: Extract metadata for Docker
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}
          tags: |
            # Branch name (e.g., main)
            type=ref,event=branch
            # PR number (e.g., pr-123)
            type=ref,event=pr
            # Semantic version from tag (e.g., v1.2.3 → 1.2.3)
            type=semver,pattern={{version}}
            # Major.minor from tag (e.g., v1.2.3 → 1.2)
            type=semver,pattern={{major}}.{{minor}}
            # Short SHA (e.g., sha-a1b2c3d)
            type=sha,prefix=sha-
            # Latest tag only for version tags
            type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}

      # ─────────────────────────────────────────────────────────────
      # Build and Push Image
      # ─────────────────────────────────────────────────────────────
      - name: Build and push Docker image
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: ${{ github.event_name != 'pull_request' }}
          load: ${{ github.event_name == 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          platforms: linux/amd64
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            VERSION=${{ steps.meta.outputs.version }}
            GIT_COMMIT=${{ github.sha }}
          provenance: false  # Disable provenance for simpler image manifest

      # ─────────────────────────────────────────────────────────────
      # Security Scanning
      # ─────────────────────────────────────────────────────────────
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:${{ steps.meta.outputs.version }}
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          ignore-unfixed: true

      - name: Upload Trivy scan results to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'

      - name: Fail on critical vulnerabilities
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:${{ steps.meta.outputs.version }}
          format: 'table'
          exit-code: '1'
          severity: 'CRITICAL'
          ignore-unfixed: true

  # ═══════════════════════════════════════════════════════════════════
  # Job 3: Deploy to Staging (on main branch)
  # ═══════════════════════════════════════════════════════════════════
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'

    environment:
      name: staging
      url: https://staging.example.com

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Download task definition
        run: |
          aws ecs describe-task-definition \
            --task-definition ${{ env.ECS_SERVICE }}-staging \
            --query taskDefinition \
            > task-definition.json

      - name: Update task definition with new image
        id: task-def
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: task-definition.json
          container-name: ${{ env.CONTAINER_NAME }}
          image: ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:sha-${{ github.sha }}

      - name: Deploy to ECS Staging
        uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: ${{ steps.task-def.outputs.task-definition }}
          service: ${{ env.ECS_SERVICE }}-staging
          cluster: ${{ env.ECS_CLUSTER }}-staging
          wait-for-service-stability: true
          wait-for-minutes: 10

      - name: Verify deployment
        run: |
          echo "Deployed image: ${{ needs.build.outputs.version }}"
          echo "Image digest: ${{ needs.build.outputs.digest }}"

  # ═══════════════════════════════════════════════════════════════════
  # Job 4: Deploy to Production (on version tags)
  # ═══════════════════════════════════════════════════════════════════
  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: build
    if: startsWith(github.ref, 'refs/tags/v')

    environment:
      name: production
      url: https://api.example.com

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN_PROD }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Download current task definition
        run: |
          aws ecs describe-task-definition \
            --task-definition ${{ env.ECS_SERVICE }} \
            --query taskDefinition \
            > task-definition.json

      - name: Update task definition with new image
        id: task-def
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: task-definition.json
          container-name: ${{ env.CONTAINER_NAME }}
          image: ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:${{ needs.build.outputs.version }}

      - name: Deploy to ECS Production
        uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: ${{ steps.task-def.outputs.task-definition }}
          service: ${{ env.ECS_SERVICE }}
          cluster: ${{ env.ECS_CLUSTER }}
          wait-for-service-stability: true
          wait-for-minutes: 15

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          body: |
            ## Deployment Info
            - **Image:** `${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:${{ needs.build.outputs.version }}`
            - **Digest:** `${{ needs.build.outputs.digest }}`
            - **Cluster:** `${{ env.ECS_CLUSTER }}`
            - **Service:** `${{ env.ECS_SERVICE }}`
```

## Cheatsheet

### Workflow Triggers

```yaml
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0' # Weekly rebuild
  workflow_dispatch: # Manual trigger
```

### Common Actions

```yaml
# Setup Buildx
- uses: docker/setup-buildx-action@v3

# Multi-platform support
- uses: docker/setup-qemu-action@v3

# Registry login
- uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}

# Generate tags
- uses: docker/metadata-action@v5
  with:
    images: ghcr.io/${{ github.repository }}

# Build and push
- uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    tags: ${{ steps.meta.outputs.tags }}
    cache-from: type=gha
    cache-to: type=gha,mode=max

# Scan for vulnerabilities
- uses: aquasecurity/trivy-action@master
  with:
    image-ref: myimage:latest
    exit-code: '1'
    severity: 'CRITICAL,HIGH'
```

### Cache Configuration

```yaml
# GitHub Actions cache (recommended)
cache-from: type=gha
cache-to: type=gha,mode=max

# Registry cache
cache-from: type=registry,ref=myimage:buildcache
cache-to: type=registry,ref=myimage:buildcache,mode=max
```

### Metadata Tags

```yaml
tags: |
  type=ref,event=branch
  type=ref,event=pr
  type=semver,pattern={{version}}
  type=semver,pattern={{major}}.{{minor}}
  type=sha,prefix=sha-
  type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}
```

---

## Further Reading

- [GitHub Actions Docker documentation](https://docs.github.com/en/actions/publishing-packages/publishing-docker-images)
- [docker/build-push-action](https://github.com/docker/build-push-action)
- [docker/metadata-action](https://github.com/docker/metadata-action)
- [Trivy GitHub Action](https://github.com/aquasecurity/trivy-action)
