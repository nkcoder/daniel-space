---
title: Practical SQL
description: Practical SQL Concepts with examples
date: 2026-02-10
tags: [SQL]
---

## Core Query Mechanics

SELECT fundamentals: Retrieve columns from tables. Use SELECT \* sparingly in production—specify columns for performance and clarity.

```sql
-- SELECT: Specify columns explicitly
SELECT user_id, email, created_at
FROM users;
```

FROM & JOIN: Combine data from multiple tables. Master INNER, LEFT, RIGHT, and FULL OUTER joins. Understand the difference between JOIN (explicit) and WHERE-based joins (implicit, avoid in modern code).

```sql
-- INNER JOIN: Only matching rows from both tables
SELECT u.user_id, u.email, o.order_id, o.total
FROM users u
INNER JOIN orders o ON u.user_id = o.user_id;

-- LEFT JOIN: All users, even without orders
SELECT u.user_id, u.email, o.order_id
FROM users u
LEFT JOIN orders o ON u.user_id = o.user_id;

-- Multiple joins
SELECT u.email, o.order_id, oi.product_id, oi.quantity
FROM users u
INNER JOIN orders o ON u.user_id = o.user_id
INNER JOIN order_items oi ON o.order_id = oi.order_id;
```

> `JOIN` defaults to `INNER JOIN` if no join type is specified. Explicitly writing `INNER JOIN` is clearer and makes intent obvious, especially in queries with multiple joins mixing INNER and LEFT/RIGHT joins

WHERE clause: Filter rows before aggregation. Supports comparison operators, pattern matching (LIKE, ILIKE), range checks (BETWEEN), and set membership (IN).

```sql
-- WHERE: Basic filtering
SELECT * FROM orders
WHERE total > 100 AND status = 'completed';

-- Pattern matching
SELECT * FROM users
WHERE email ILIKE '%@gmail.com'; -- case-insensitive

-- Range and set membership
SELECT * FROM orders
WHERE created_at BETWEEN '2024-01-01' AND '2024-12-31'
  AND status IN ('pending', 'processing');
```

DISTINCT: Remove duplicate rows. Often signals a data modeling issue if overused.

```sql
-- DISTINCT: Remove duplicates
SELECT DISTINCT country FROM users;
```

## Filtering & Sorting

WHERE vs HAVING: WHERE filters rows; HAVING filters aggregated results after GROUP BY.

```sql
-- WHERE filters before aggregation, HAVING filters after
SELECT
    status,
    COUNT(*) as order_count,
    SUM(total) as total_revenue
FROM orders
WHERE created_at >= '2024-01-01' -- WHERE filters rows
GROUP BY status
HAVING COUNT(*) > 10 -- HAVING filters groups
ORDER BY total_revenue DESC;
```

ORDER BY: Sort results. Use ASC (default) or DESC. Can order by multiple columns, expressions, or column positions (though explicit names are clearer).

```sql
-- ORDER BY: Sorting
SELECT * FROM users
ORDER BY created_at DESC, email ASC;
```

LIMIT & OFFSET: Paginate results. Be cautious with OFFSET on large datasets—performance degrades linearly.

```sql
-- LIMIT & OFFSET: Pagination
SELECT * FROM products
ORDER BY price DESC
LIMIT 20 OFFSET 40; -- Get 3rd page (20 items per page)
```

NULL handling: Use IS NULL / IS NOT NULL. Remember NULL != NULL in comparisons. Use COALESCE for default values.

```sql
-- NULL handling
SELECT * FROM users
WHERE last_login IS NULL;

SELECT COALESCE(phone_number, 'N/A') AS phone FROM users;
```

## Aggregation & Grouping

Aggregate functions: COUNT, SUM, AVG, MIN, MAX. COUNT(\*) vs COUNT(column)—the latter excludes NULLs.

```sql
-- Aggregate functions
SELECT
    COUNT(*) as total_users,
    COUNT(email) as users_with_email,
    SUM(order_total) as total_revenue,
    AVG(order_total) as avg_order_value,
    MIN(created_at) as oldest_user,
    MAX(created_at) as newest_user
FROM orders;
```

GROUP BY: Combine rows sharing common values. Every non-aggregated column in SELECT must appear in GROUP BY.

```sql
-- GROUP BY
SELECT country, COUNT(*) AS user_count
FROM users
GROUP BY country
ORDER BY user_count DESC;

-- Multiple aggregations
SELECT
  user_id,
  COUNT(*) AS order_count,
  SUM(total) AS total_spent,
  AVG(total) AS avg_order_value,
  MAX(total) AS largest_order
FROM orders
GROUP BY user_id;
```

HAVING: Filter aggregated results after GROUP BY.

```sql
-- HAVING: Filter aggregated results
SELECT
    status,
    COUNT(*) as order_count,
    SUM(total) as total_revenue
FROM orders
WHERE created_at >= '2024-01-01'
GROUP BY status
HAVING COUNT(*) > 10
ORDER BY total_revenue DESC;
```

Window functions: Perform calculations across row sets without collapsing them (unlike GROUP BY). Common ones: ROW_NUMBER(), RANK(), LAG(), LEAD(), SUM() OVER().

```sql
-- Window functions: Running totals without collapsing rows
-- PARTITION BY: Like GROUP BY, but just for the calculation. It restarts the calculation for each group.
-- ORDER BY: Defines the sequence in which the calculation happens (crucial for running totals or ranking).
SELECT
  order_id,
  user_id,
  total,
  -- Calculates running total by date (earliest first)
  SUM(total) OVER (PARTITION BY user_id ORDER BY created_at) AS running_total,
  -- Calculates order rank by date (latest first)
  ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS order_rank
FROM orders;

-- LAG/LEAD: Access previous/next row values
-- LAG: Accesses the value from the previous row in the window.
-- LEAD: Accesses the value from the next row in the window.
SELECT
  order_id,
  created_at,
  total,
  -- Calculates the previous order total
  LAG(total) OVER (ORDER BY created_at) AS previous_order_total,
  -- Calculates the difference between current and previous order
  total - LAG(total) OVER (ORDER BY created_at) AS difference
FROM orders;
```

> The best way to understand window functions is to think of them as "aggregations that don't squash your rows." In a normal GROUP BY query, you lose the individual row details—everything gets collapsed into one summary row. Window functions let you keep the individual rows while also adding a column that has calculated data from surrounding rows (the "window").

## Data Modification

INSERT: Add rows. Use RETURNING clause to get inserted values (very useful for getting auto-generated IDs).

```sql
-- INSERT: Single row
INSERT INTO users (email, name, country)
VALUES ('user@example.com', 'John Doe', 'US');

-- INSERT: Multiple rows
INSERT INTO users (email, name, country)
VALUES
  ('user1@example.com', 'Alice', 'UK'),
  ('user2@example.com', 'Bob', 'CA');

-- INSERT with RETURNING
INSERT INTO users (email, name)
VALUES ('new@example.com', 'Jane')
RETURNING user_id, created_at;
```

UPDATE: Modify existing rows. Always test with SELECT first using the same WHERE clause.

```sql
-- UPDATE
UPDATE users
SET last_login = NOW()
WHERE user_id = 123;

-- UPDATE with RETURNING
UPDATE orders
SET status = 'shipped'
WHERE order_id = 456
RETURNING order_id, status, updated_at;
```

DELETE: Remove rows. Use WHERE carefully—omitting it deletes all rows.

```sql
-- DELETE
DELETE FROM orders
WHERE status = 'cancelled' AND created_at < NOW() - INTERVAL '1 year';
```

UPSERT (INSERT ... ON CONFLICT): PostgreSQL-specific. Insert or update based on constraint violations.

```sql
-- UPSERT (INSERT ... ON CONFLICT)
INSERT INTO user_preferences (user_id, theme, language)
VALUES (123, 'dark', 'en')
ON CONFLICT (user_id)
DO UPDATE SET
  theme = EXCLUDED.theme,
  language = EXCLUDED.language,
  updated_at = NOW();
```

> RETURNING is a PostgreSQL feature that some databases have adopted in various forms.

## CTEs & Subqueries

```sql
-- CTE: Break complex queries into readable parts
WITH high_value_users AS (
  SELECT user_id, SUM(total) AS total_spent
  FROM orders
  GROUP BY user_id
  HAVING SUM(total) > 1000
)
SELECT u.email, hvu.total_spent
FROM high_value_users hvu
JOIN users u ON hvu.user_id = u.user_id
ORDER BY hvu.total_spent DESC;

-- Multiple CTEs
WITH
  user_stats AS (
    SELECT user_id, COUNT(*) AS order_count
    FROM orders
    GROUP BY user_id
  ),
  active_users AS (
    SELECT user_id FROM users WHERE last_login > NOW() - INTERVAL '30 days'
  )
SELECT u.email, us.order_count
FROM user_stats us
JOIN active_users au ON us.user_id = au.user_id
JOIN users u ON us.user_id = u.user_id;

-- Recursive CTE: Hierarchical data
WITH RECURSIVE employee_hierarchy AS (
  SELECT employee_id, name, manager_id, 1 AS level
  FROM employees
  WHERE manager_id IS NULL

  UNION ALL

  SELECT e.employee_id, e.name, e.manager_id, eh.level + 1
  FROM employees e
  JOIN employee_hierarchy eh ON e.manager_id = eh.employee_id
)
SELECT * FROM employee_hierarchy ORDER BY level, name;
```

## Performance & Indexing

Indexes: Speed up lookups but slow down writes. B-tree (default) for equality/range, GIN for JSON/arrays, GiST for geometric data.

```sql
-- B-tree index (default, good for equality and range queries)
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

-- Composite index
CREATE INDEX idx_orders_user_status ON orders(user_id, status);

-- Partial index (smaller, faster for specific queries)
CREATE INDEX idx_active_users ON users(user_id)
WHERE deleted_at IS NULL;

-- GIN index for JSONB
CREATE INDEX idx_events_data ON events USING GIN(data);

-- Index for text search
CREATE INDEX idx_products_name ON products USING GIN(to_tsvector('english', name));
```

> Rule of thumb: If you're searching inside a value (JSON keys, words in text, elements in arrays), use GIN. If you're searching for a value (exact match, range), use B-tree.

EXPLAIN / EXPLAIN ANALYZE: Understand query execution plans. Look for sequential scans on large tables — often indicate missing indexes.

```sql
-- EXPLAIN: See query plan (doesn't execute)
EXPLAIN
SELECT * FROM users WHERE email = 'test@example.com';

-- EXPLAIN ANALYZE: See actual execution (runs query)
EXPLAIN ANALYZE
SELECT u.email, COUNT(o.order_id)
FROM users u
LEFT JOIN orders o ON u.user_id = o.user_id
GROUP BY u.email;

-- Check index usage
EXPLAIN ANALYZE
SELECT * FROM users WHERE email = 'test@example.com';
```

Query optimization: Avoid SELECT \*, use indexes wisely, consider denormalization for read-heavy workloads, use prepared statements to prevent SQL injection and improve performance.

```sql
-- Avoid N+1 queries: Use JOIN instead of multiple queries
-- Bad: Query in loop
-- Good: Single query with JOIN
SELECT u.user_id, u.email, json_agg(json_build_object('id', o.order_id, 'total', o.total)) AS orders
FROM users u
LEFT JOIN orders o ON u.user_id = o.user_id
GROUP BY u.user_id, u.email;
```

## PostgreSQL-Specific Features

JSON/JSONB: Store and query JSON. JSONB is binary, supports indexing, and is generally preferred.

```sql
-- JSONB operations
CREATE TABLE events (
  event_id SERIAL PRIMARY KEY,
  data JSONB
);

INSERT INTO events (data)
VALUES ('{"user_id": 123, "action": "login", "metadata": {"ip": "1.2.3.4"}}');

-- Query JSON fields
SELECT * FROM events
WHERE data->>'action' = 'login';

SELECT * FROM events
WHERE data->'metadata'->>'ip' = '1.2.3.4';

-- JSON aggregation
SELECT
  data->>'user_id' AS user_id,
  jsonb_agg(data->'action') AS actions
FROM events
GROUP BY data->>'user_id';
```

Array operations: Native array support with functions like array_agg, unnest, ANY/ALL.

```sql
-- Arrays
SELECT ARRAY[1, 2, 3, 4, 5];

SELECT array_agg(order_id) AS order_ids
FROM orders
WHERE user_id = 123;

SELECT unnest(ARRAY[1, 2, 3]) AS value;

-- Check if value in array
SELECT * FROM products
WHERE 'electronics' = ANY(categories);

-- Array operations
UPDATE products
SET tags = array_append(tags, 'featured')
WHERE product_id = 456;
```

Transactions: BEGIN, COMMIT, ROLLBACK. Use for atomic operations across multiple statements.

```sql
-- Basic transaction
BEGIN;

UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;
UPDATE accounts SET balance = balance + 100 WHERE account_id = 2;

COMMIT;

-- Rollback on error
BEGIN;

UPDATE inventory SET quantity = quantity - 1 WHERE product_id = 123;

-- If this fails, entire transaction rolls back
INSERT INTO orders (user_id, product_id) VALUES (456, 123);

COMMIT;

-- Savepoints for partial rollback
BEGIN;

INSERT INTO logs (message) VALUES ('Step 1');
SAVEPOINT step1;

INSERT INTO logs (message) VALUES ('Step 2');
SAVEPOINT step2;

-- Rollback to step1, keeping first insert
ROLLBACK TO SAVEPOINT step1;

COMMIT;
```
