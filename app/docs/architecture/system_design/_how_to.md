## Prepare

1. Repeat the question and confirm you understand it with the interviewer.
2. Clarify requirements

- Ask lots of questions, think out loud.
- Break down, clarify and narrow scope requirements
- Working backwards, starts from the customer experience

3. Your interviewer wants to see that you can think about problems from a **business perspective** and not a purely technical one.

## Consistency Models

**Eventual consistency**: is the weakest consistency model. The applications that don't have strict ordering requirements and don't require reads to return the latest write choose this model. Eventual consistency ensures that all the replicas converge on a final value after a finite time and when no more writes are coming in.
Eventual consistency ensures high availability.
Example: Domain Name System (DNS), Cassandra.

**Strict Consistency (linearizability)**: is the strongest consistency model. It ensures that a read request from any replicas will get the latest write value. Once the client receives the acknowledgment that the write operation has been performed, other clients can read that value.
Strict consistency is challenging to achieve in a distributed system because of network delays and failures. Usually synchronous replication, consensus algorithms such Paxos and Raft are the ingredients for achieving strong consistency. Applications with strong consistency requirements use techniques like quorum-based replications to increase the system's availability.
Example: Updating bank account's password requires strict consistency.

## Reliability

How often the system produces correct results - the probability that a system will work correctly over a given time period.

- Focus on correctness and data integrity
- Measures: can the system be trusted to deliver accurate results?
- A reliable system avoids errors, data loss, and incorrect behavior
- Example: a database that never loses data or corrupts transactions is highly reliable

## Availability

How often the system is operational and accessible - the percentage of time a system is up and able to respond to requests.

- Focuses on uptime and accessibility
- Measures: is the system ready to serve requests right now?
- Calculated as `uptime / (uptime + downtime) (often expressed as `nines` - 99.99% etc.)
- Example: a web server that responds to requests 99.99% of the time has high availability

## Reliability vs Availability

A system can be highly available but not reliable - it's always accessible but sometimes returns wrong answers or loses data.
Conversely, a system could be reliable but not highly available - when it works, it's always correct, but it has frequent downtime.
Example for a payment processing system:

- High availability, low reliability: system is always up (99.99%) but occasionally processes duplicate charges due to bugs.
- High reliability, low availability: System never makes mistakes when processing payments, but goes down frequently for maintenance.
