---
title: 'Serverless Architecture on AWS'
description: Overview of serverless architecture on AWS, including key services, benefits, and best practices for building scalable applications.
date: 2025-09-02
tags: [architecture, serverless]
---

# Serverless Architecture

Serverless architecture refers to a cloud computing model where you build and run applications without managing the underlying server infrastructure. The cloud provider automatically handles server provisioning, scaling, and maintenance, allowing you to focus purely on your application code and business logic.

You pay only for the actual compute time and resources you consume, rather than for idle server capacity. The term "serverless" doesn't mean there are no servers - it means the servers are abstracted away from you as a developer.

Serverless is ideal for:

- Rapid prototyping and MVPs
- Event-driven and microservices architectures
- Applications with unpredictable or spiky workloads

---

## Quick Comparison of AWS Serverless Services

| Service           | Type          | Typical Use Cases                 | Key Limits/Notes                  |
| ----------------- | ------------- | --------------------------------- | --------------------------------- |
| Lambda            | Compute       | APIs, automation, ETL             | 15 min max, 10GB mem, cold starts |
| DynamoDB          | Database      | NoSQL, session, IoT, gaming       | 400KB item, eventual consistency  |
| API Gateway       | API Gateway   | REST, WebSocket, API mgmt         | 29s timeout, 10MB payload         |
| S3                | Storage       | Static hosting, backup, data lake | 5TB obj, eventual consistency     |
| SNS/SQS           | Messaging     | Pub/sub, queues, decoupling       | 256KB msg (SNS), 14d retention    |
| EventBridge       | Event Bus     | Event-driven, SaaS integration    | 256KB event, rule complexity      |
| CloudFront        | CDN           | Caching, acceleration, DDoS       | Cache invalidation cost           |
| CloudWatch        | Monitoring    | Logs, metrics, alarms             | Cost for high log volume          |
| Aurora Serverless | Database      | Relational, variable workloads    | Cold starts, engine limits        |
| ECS/EKS Fargate   | Containers    | Microservices, batch, K8s         | Higher cost, cold starts          |
| AppSync           | GraphQL API   | Real-time, mobile/web APIs        | GraphQL only, resolver limits     |
| Amplify           | Dev Platform  | Full-stack, rapid prototyping     | Opinionated, vendor lock-in       |
| Step Functions    | Orchestration | Workflows, ETL, automation        | 25k transitions, 32KB state       |
| Kinesis           | Streaming     | Real-time analytics, IoT          | Shard mgmt, ordering              |
| Athena            | Analytics     | SQL on S3, ad-hoc queries         | 30min timeout, partitioning       |

---

## What Makes Up a Serverless Architecture?

1. **Function as a Service (FaaS):** Run code in response to events—no server management. (e.g., AWS Lambda)
2. **Backend as a Service (BaaS):** Offload backend logic and storage to managed services. (e.g., DynamoDB, Amplify)
3. **API Gateway:** Single entry point for APIs, handling routing, auth, and throttling.
4. **Event-driven Design:** Functions and services react to events (data changes, user actions, etc.).
5. **Microservices:** Break your app into small, independently deployable pieces.

> **Tip:** Serverless is not just about Lambda! It’s about using managed services for compute, storage, messaging, and more.

---

## Most Common Serverless Services on AWS

### AWS Lambda

**What it is:**
Event-driven, stateless compute service. Run code in response to HTTP requests, events, or schedules—no servers to manage.

**Main Features:**

- Supports Node.js, Python, Go, Java, and more
- Scales automatically from zero to thousands of executions
- Built-in monitoring and fault tolerance

**Use Cases:**

- API backends and microservices
- Real-time file/data processing
- Scheduled tasks and cron jobs
- Event-driven workflows

**Constraints:**

- 15-minute max execution time
- 10GB memory limit
- Cold start latency (100ms–5s)
- Limited local storage (512MB–10GB)

### Amazon DynamoDB

**What it is:**
Fully managed NoSQL database with single-digit millisecond response times.

**Main Features:**

- Automatic scaling based on traffic
- Global tables for multi-region replication

**Use Cases:**

- Session storage and user profiles
- Real-time apps (gaming, IoT)
- Mobile/web app backends
- Content metadata storage

**Constraints:**

- 400KB item size limit
- Eventually consistent reads by default
- Complex queries require careful data modeling
- Can be expensive for large, low-access datasets

### API Gateway

**What it is:**
Fully managed API proxy and gateway service. Handles authentication, authorization, throttling, and more.

**Main Features:**

- REST, HTTP, and WebSocket API support
- Request/response transformation
- Built-in caching

**Use Cases:**

- REST and HTTP API endpoints
- Real-time WebSocket APIs
- Modernizing legacy systems
- Rate limiting and API monetization

**Constraints:**

- 29-second timeout
- 10MB payload size
- Adds 100–200ms latency
- Costs can add up with high request volume

### SNS & SQS

**What they are:**

- **SNS:** Pub/sub messaging for event notifications
- **SQS:** Message queuing for decoupling and buffering

**Main Features:**

- Dead letter queues and message durability
- FIFO and standard queue support (SQS)

**Use Cases:**

- Microservices communication
- Event notifications and alerts
- Workflow coordination
- Load leveling and buffering

**Constraints:**

- SNS: 256KB message size
- SQS: 15-min visibility timeout, 14-day retention
- Careful design needed for ordering and delivery guarantees

### Amazon S3

**What it is:**
Virtually unlimited object storage for any type of data.

**Main Features:**

- Multiple storage classes for cost optimization
- Event notifications for object changes
- Built-in versioning and lifecycle management

**Use Cases:**

- Static website hosting
- Data archiving and backup
- Content distribution
- Data lake storage

**Constraints:**

- 5TB max object size
- Eventually consistent for overwrites/deletes
- Not ideal for high-frequency small file ops
- Cross-region transfer costs

### EventBridge

**What it is:**
Event bus for integrating AWS services and custom applications using events.

**Main Features:**

- Schema registry for event structure
- Rule-based event routing
- Integrates with 100+ AWS services

**Use Cases:**

- Event-driven architectures
- Application and SaaS integration
- Custom event workflows

**Constraints:**

- 256KB event size
- Limited batch processing
- Eventual consistency in rule evaluation
- Can get complex with many rules

### CloudFront

**What it is:**
Global content delivery network (CDN) for caching and accelerating content.

**Main Features:**

- Edge computing with Lambda@Edge
- Origin failover and caching
- Real-time metrics and logs

**Use Cases:**

- Website and API acceleration
- Video streaming and large file distribution
- Dynamic content caching
- DDoS protection

**Constraints:**

- Cache invalidation costs
- Complex for dynamic content
- Limited real-time purging
- Geographic restrictions can be tricky

### CloudWatch

**What it is:**
Comprehensive monitoring and observability for AWS resources and applications.

**Main Features:**

- Custom metrics and dashboards
- Log aggregation and analysis
- Automated actions based on alarms

**Use Cases:**

- Application performance monitoring
- Infrastructure health tracking
- Automated scaling triggers
- Troubleshooting and debugging

**Constraints:**

- Cost can escalate with high log volumes
- Limited retention without extra config
- Querying less advanced than specialized tools
- Real-time processing limitations

---

## Less Common Serverless Services on AWS

### RDS Aurora Serverless

**What it is:**
Auto-scaling relational database compatible with MySQL and PostgreSQL.

**Main Features:**

- Automatic start/stop based on usage
- Data API for HTTP-based access

**Use Cases:**

- Variable workload applications
- Dev/test environments
- Infrequent or unpredictable access
- Cost optimization for sporadic usage

**Constraints:**

- Cold start delays (30+ seconds)
- Limited to specific engine versions
- Connection pooling limitations
- Not ideal for consistent high-traffic apps

### ECS Fargate

**What it is:**
Serverless container orchestration—run containers without managing EC2 instances.

**Main Features:**

- VPC networking integration
- Supports both ECS and EKS

**Use Cases:**

- Containerized microservices
- Batch jobs
- Long-running apps
- Migrating from traditional containers

**Constraints:**

- Higher cost than EC2-based containers
- Limited infra customization
- Resource allocation granularity
- Cold start times for new tasks

### AWS AppSync

**What it is:**
Managed GraphQL service for building real-time APIs.

**Main Features:**

- Real-time subscriptions
- Offline sync
- Built-in caching and security

**Use Cases:**

- Mobile/web APIs
- Real-time collaboration
- Offline-first apps
- Unified data access layer

**Constraints:**

- GraphQL learning curve
- GraphQL only
- Resolver complexity for advanced logic
- Subscription connection limits

### AWS Amplify

**What it is:**
Full-stack development platform for building and deploying web/mobile apps quickly.

**Main Features:**

- CI/CD for frontend
- Backend provisioning
- Built-in auth and hosting

**Use Cases:**

- Rapid prototyping and MVPs
- Full-stack web/mobile apps
- Static site hosting with dynamic backends
- Boosting developer productivity

**Constraints:**

- Opinionated architecture
- Limited customization for complex needs
- Vendor lock-in
- Learning curve for Amplify CLI

### Step Functions

**What it is:**
Visual workflow orchestration for automating business processes.

**Main Features:**

- State machine definition (JSON)
- Error handling and retries
- Integrates with 200+ AWS services

**Use Cases:**

- Complex business workflows
- ETL pipeline orchestration
- Microservices choreography
- Human approval workflows

**Constraints:**

- 25,000 state transitions per execution
- 32KB state data size
- Cost per state transition
- Debugging complexity for large workflows

### Amazon Kinesis

**What it is:**
Real-time data streaming platform (Data Streams, Firehose, Analytics).

**Main Features:**

- Automatic scaling and durability
- Real-time processing

**Use Cases:**

- Real-time analytics and monitoring
- IoT data ingestion
- Log/event streaming
- ML data pipelines

**Constraints:**

- Shard management complexity
- Data ordering considerations
- Cost optimization needs planning
- Limited data transformation

### Amazon Athena

**What it is:**
Serverless SQL query service for analyzing data directly in S3.

**Main Features:**

- Pay-per-query pricing
- Integrates with AWS Glue for cataloging

**Use Cases:**

- Ad-hoc data analysis
- Log file analysis
- Data lake querying
- Business intelligence reporting

**Constraints:**

- 30-min query timeout
- No indexing for performance
- Limited data types
- Partitioning strategy is critical

### Amazon EKS Fargate

**What it is:**
Serverless Kubernetes pods—run K8s workloads without managing worker nodes.

**Main Features:**

- Native Kubernetes experience
- Automatic scaling and patching
- Pod-level isolation and security

**Use Cases:**

- Kubernetes workloads without infra management
- Microservices on Kubernetes
- CI/CD pipelines
- Dev/test environments
- Batch processing with K8s Jobs

**Constraints:**

- Higher cost than managed node groups
- Limited to specific instance types/sizes
- No access to underlying EC2 instances
- Some K8s features not supported (DaemonSets, HostNetwork, etc.)
- Pod startup time can be longer
- Storage: only EFS and EBS CSI drivers

**Key Differences from ECS Fargate:**

- EKS Fargate provides the full Kubernetes API/ecosystem
- More complex but more flexible for K8s-native apps
- Best for teams already using Kubernetes tooling

---

## Conclusion & Best Practices

Serverless on AWS is a powerful way to build scalable, cost-effective, and maintainable applications. By leveraging managed services, you can focus on delivering value—not managing infrastructure.

**Best Practices:**

- Start small: Use serverless for new features or prototypes
- Monitor costs: Pay attention to usage and optimize
- Design for events: Embrace event-driven patterns
- Use managed services wherever possible
- Understand service limits and constraints

> **Remember:** Serverless is a mindset—think managed, event-driven, and scalable!
