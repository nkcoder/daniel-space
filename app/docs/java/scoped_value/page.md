---
title: Introduction to Scoped Value
description: A comprehensive introduction to ScopedValue which is a modern alternative to ThreadLocal
---

# Java ScopedValue: A Comprehensive Guide

`ScopedValue` ([JEP 506](https://openjdk.org/jeps/506), finalized in Java 25) is a modern alternative to `ThreadLocal` designed for sharing immutable data within and across threads. It's particularly well-suited for virtual threads and structured concurrency, addressing fundamental limitations of `ThreadLocal` that become acute in high-throughput concurrent applications.

> Structured concurrency is still previewed in Java 25 via [JPE 505](https://openjdk.org/jeps/505).

## The Problem: Why ThreadLocal Falls Short

### How ThreadLocal Works

`ThreadLocal` provides thread-confined storage where each thread has its own independent copy of a variable:

```java
private static final ThreadLocal<User> CURRENT_USER = new ThreadLocal<>();

void handleRequest(User user) {
    CURRENT_USER.set(user);
    try {
        processRequest();  // Can access CURRENT_USER.get() anywhere in call stack
    } finally {
        CURRENT_USER.remove();  // Must remember to clean up!
    }
}
```

Internally, each `Thread` object maintains a `ThreadLocalMap` — a hash map from `ThreadLocal` instances to values. When you call `get()` or `set()`, it accesses the current thread's map.

```
┌─────────────────────────────────────────────────────────────┐
│ Thread-1                                                    │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ThreadLocalMap                                          │ │
│ │   CURRENT_USER → User{id=123}                           │ │
│ │   TRANSACTION_ID → "txn-456"                            │ │
│ │   REQUEST_CONTEXT → Context{...}                        │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Thread-2                                                    │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ThreadLocalMap                                          │ │
│ │   CURRENT_USER → User{id=789}                           │ │
│ │   TRANSACTION_ID → "txn-012"                            │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### The Five Problems with ThreadLocal

#### 1. Unconstrained Mutability

`ThreadLocal` values can be changed at any time from anywhere, making data flow hard to reason about:

```java
void processRequest() {
    User user = CURRENT_USER.get();
    // ... 50 lines later, in some nested method ...
    CURRENT_USER.set(differentUser);  // Mutation hidden deep in call stack
    // ...
    user = CURRENT_USER.get();  // Surprise! Different user now
}
```

#### 2. Memory Leaks with Thread Pools

When using thread pools, threads live for the entire application lifetime. ThreadLocal values persist unless explicitly removed:

```java
ExecutorService pool = Executors.newFixedThreadPool(10);

for (Request request : requests) {
    pool.submit(() -> {
        CURRENT_USER.set(request.getUser());
        processRequest();
        // Forgot CURRENT_USER.remove()!
        // Value persists, may leak to next task on same thread
        // Memory never reclaimed while thread lives
    });
}
```

#### 3. Expensive Inheritance

`InheritableThreadLocal` copies values to child threads, but this copying is expensive and happens at thread creation time:

```java
private static final InheritableThreadLocal<Context> CONTEXT = new InheritableThreadLocal<>();

void handleRequest() {
    CONTEXT.set(new Context(/* large object */));

    // When creating a child thread, the ENTIRE ThreadLocalMap is copied
    executor.submit(() -> {
        // Child has a COPY of the context
        // Not a reference — actual copying of all inheritable values
    });
}
```

With virtual threads creating millions of threads, this copying becomes a significant overhead.

#### 4. Unbounded Lifetime

There's no way to constrain a ThreadLocal's value to a specific scope. It exists until explicitly removed or the thread dies:

```java
void outerMethod() {
    CONTEXT.set(sensitiveData);
    try {
        middleMethod();
    } finally {
        CONTEXT.remove();
    }
}

void middleMethod() {
    // Can't prevent innerMethod from re-setting CONTEXT
    innerMethod();
}

void innerMethod() {
    CONTEXT.set(maliciousData);  // Nothing prevents this
}
```

#### 5. Poor Observability

ThreadLocal values are hidden state. Debugging requires knowing which ThreadLocals exist and manually inspecting them:

```java
// Somewhere in the codebase...
private static final ThreadLocal<A> TL_A = new ThreadLocal<>();
private static final ThreadLocal<B> TL_B = new ThreadLocal<>();
private static final ThreadLocal<C> TL_C = new ThreadLocal<>();

// In your debugging session:
// "Why is this behaving strangely?"
// Good luck finding which ThreadLocal has unexpected state!
```

### The Virtual Thread Amplifier

These problems are manageable with hundreds of platform threads. With millions of virtual threads, they become critical:

| Problem              | Platform Threads (100s) | Virtual Threads (millions) |
| -------------------- | ----------------------- | -------------------------- |
| Memory leaks         | Moderate impact         | Catastrophic — OOM quickly |
| Inheritance cost     | Acceptable              | Prohibitive at scale       |
| Cleanup discipline   | Important               | Critical — easy to miss    |
| Debugging complexity | Manageable              | Nearly impossible          |

## What is ScopedValue?

`ScopedValue` is an immutable, inheritable, scope-bound container for passing data down the call stack and to child threads.

```java
private static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();

void handleRequest(User user) {
    ScopedValue.where(CURRENT_USER, user).run(() -> {
        processRequest();  // CURRENT_USER.get() available here
    });
    // Value automatically gone — no cleanup needed
}
```

### Key Characteristics

| Aspect       | ThreadLocal                  | ScopedValue                |
| ------------ | ---------------------------- | -------------------------- |
| Mutability   | Mutable anytime              | Immutable once bound       |
| Lifetime     | Until removed or thread dies | Exactly the scope duration |
| Inheritance  | Copies values (expensive)    | Shares reference (cheap)   |
| Cleanup      | Manual (error-prone)         | Automatic (scope exit)     |
| Rebinding    | `set()` anywhere             | Only via nested `where()`  |
| Memory model | Per-thread map               | Stack-like binding         |

### The Mental Model

Think of ScopedValue as **method parameters that don't need to be passed explicitly**:

```java
// Without ScopedValue: Threading context through every method
void handleRequest(User user, Tenant tenant, TraceId trace) {
    validateRequest(user, tenant, trace);
    processOrder(user, tenant, trace);
    sendNotification(user, tenant, trace);
}

void validateRequest(User user, Tenant tenant, TraceId trace) {
    auditLog(user, tenant, trace);  // Must pass everywhere!
}

// With ScopedValue: Context available implicitly in scope
private static final ScopedValue<User> USER = ScopedValue.newInstance();
private static final ScopedValue<Tenant> TENANT = ScopedValue.newInstance();
private static final ScopedValue<TraceId> TRACE = ScopedValue.newInstance();

void handleRequest(User user, Tenant tenant, TraceId trace) {
    ScopedValue.where(USER, user)
               .where(TENANT, tenant)
               .where(TRACE, trace)
               .run(() -> {
                   validateRequest();
                   processOrder();
                   sendNotification();
               });
}

void validateRequest() {
    auditLog();  // Can access USER.get(), TENANT.get(), TRACE.get()
}
```

## Using ScopedValue

### Basic Binding and Access

```java
private static final ScopedValue<String> REQUEST_ID = ScopedValue.newInstance();

void example() {
    // Bind and run
    ScopedValue.where(REQUEST_ID, "req-123").run(() -> {
        System.out.println(REQUEST_ID.get());  // "req-123"
        nestedMethod();
    });

    // Outside scope: not bound
    REQUEST_ID.get();  // Throws NoSuchElementException!
}

void nestedMethod() {
    // Still accessible — same scope
    System.out.println(REQUEST_ID.get());  // "req-123"
}
```

### Checking if Bound

```java
void safeAccess() {
    if (REQUEST_ID.isBound()) {
        String id = REQUEST_ID.get();
        // ...
    } else {
        // Handle unbound case
    }

    // Or use orElse
    String id = REQUEST_ID.orElse("default-id");

    // Or orElseThrow with custom exception
    String id = REQUEST_ID.orElseThrow(() ->
        new IllegalStateException("REQUEST_ID not bound"));
}
```

### Returning Values from Scopes

```java
private static final ScopedValue<Database> DB = ScopedValue.newInstance();

// Use call() instead of run() to return a value
Result processWithDatabase(Database db, Query query) {
    return ScopedValue.where(DB, db).call(() -> {
        return executeQuery(query);  // Returns Result
    });
}

Result executeQuery(Query query) {
    Database db = DB.get();
    return db.execute(query);
}
```

### Multiple Bindings

```java
private static final ScopedValue<User> USER = ScopedValue.newInstance();
private static final ScopedValue<Tenant> TENANT = ScopedValue.newInstance();
private static final ScopedValue<Locale> LOCALE = ScopedValue.newInstance();

void handleRequest(Request request) {
    ScopedValue.where(USER, request.user())
               .where(TENANT, request.tenant())
               .where(LOCALE, request.locale())
               .run(() -> {
                   // All three values available
                   processRequest();
               });
}
```

### Rebinding in Nested Scopes

ScopedValues are immutable within a scope, but you can create nested scopes with different values:

```java
private static final ScopedValue<String> CONTEXT = ScopedValue.newInstance();

void demonstrate() {
    ScopedValue.where(CONTEXT, "outer").run(() -> {
        System.out.println(CONTEXT.get());  // "outer"

        // Nested scope with different value
        ScopedValue.where(CONTEXT, "inner").run(() -> {
            System.out.println(CONTEXT.get());  // "inner"
        });

        // Back to outer scope
        System.out.println(CONTEXT.get());  // "outer"
    });
}
```

```
┌──────────────────────────────────────────────┐
│ Outer Scope: CONTEXT = "outer"               │
│                                              │
│   println(CONTEXT.get())  → "outer"          │
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │ Inner Scope: CONTEXT = "inner"       │   │
│   │                                      │   │
│   │   println(CONTEXT.get())  → "inner"  │   │
│   │                                      │   │
│   └──────────────────────────────────────┘   │
│                                              │
│   println(CONTEXT.get())  → "outer"          │
│                                              │
└──────────────────────────────────────────────┘
```

## Why Static Final? Understanding ScopedValue Identity

A common source of confusion is why ScopedValue must be declared as `static final`. This isn't just a convention — it's fundamental to how ScopedValue works.

### The Core Reason: Identity-Based Lookup

ScopedValue uses **object identity** (not `equals()`) to look up bindings. When you call `get()`, the JVM searches for a binding that matches **this exact ScopedValue instance**:

```java
// Simplified internal lookup logic
public T get() {
    Snapshot current = currentSnapshot();
    while (current != null) {
        if (current.key == this) {  // Identity comparison, not equals()
            return (T) current.value;
        }
        current = current.previous;
    }
    throw new NoSuchElementException();
}
```

This means the **same instance** must be used for both binding and reading.

### What Goes Wrong Without Static Final

#### Problem 1: Instance Field — Different Instances Per Object

```java
// WRONG: Instance field
public class RequestHandler {
    private final ScopedValue<User> currentUser = ScopedValue.newInstance();

    public void handle(Request request) {
        ScopedValue.where(currentUser, request.user()).run(() -> {
            userService.process();
        });
    }
}

public class UserService {
    private final ScopedValue<User> currentUser = ScopedValue.newInstance();  // DIFFERENT instance!

    public void process() {
        User user = currentUser.get();  // NoSuchElementException!
        // This is a DIFFERENT ScopedValue instance
        // No binding exists for THIS instance
    }
}
```

What's happening in memory:

```
RequestHandler instance
┌─────────────────────────────┐
│ currentUser: ScopedValue@A  │ ←── Binding created for @A
└─────────────────────────────┘

UserService instance
┌─────────────────────────────┐
│ currentUser: ScopedValue@B  │ ←── Looking up @B, but @B has no binding!
└─────────────────────────────┘

Scope Bindings:
┌─────────────────────────────┐
│ ScopedValue@A → User{...}   │  ✓ Bound
│ ScopedValue@B → ???         │  ✗ Not bound!
└─────────────────────────────┘
```

#### Problem 2: Local Variable — New Instance Each Call

```java
// WRONG: Local variable
public void handle(Request request) {
    ScopedValue<User> user = ScopedValue.newInstance();  // New instance every call!

    ScopedValue.where(user, request.user()).run(() -> {
        process(user);  // Must pass it explicitly — defeats the purpose!
    });
}
```

#### Problem 3: Non-Final Field — Can Be Reassigned

```java
// WRONG: Non-final field
public class Context {
    public static ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();
}

// Somewhere else in codebase...
public void maliciousOrBuggyCode() {
    Context.CURRENT_USER = ScopedValue.newInstance();  // Oops! New instance
    // All existing bindings are now orphaned
    // All subsequent get() calls fail
}
```

### Why Static Final Works

`static final` guarantees:

1. **Single instance** — One ScopedValue object exists for the entire JVM
2. **Shared reference** — All code references the same instance
3. **Immutable reference** — Cannot be reassigned

```java
// CORRECT: Static final
public class RequestContext {
    public static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();
}

// In RequestHandler
public void handle(Request request) {
    ScopedValue.where(RequestContext.CURRENT_USER, request.user()).run(() -> {
        userService.process();
    });
}

// In UserService (different class, different package — doesn't matter)
public void process() {
    User user = RequestContext.CURRENT_USER.get();  // Same instance — works!
}
```

Memory model with static final:

```
Class: RequestContext (loaded once by ClassLoader)
┌──────────────────────────────────────────┐
│ static final CURRENT_USER: ScopedValue@A │
└──────────────────────────────────────────┘
              │
              ▼
        ┌─────────────┐
        │ ScopedValue │  ← Single instance, shared everywhere
        │     @A      │
        └─────────────┘
              │
    ┌─────────┴─────────┐
    ▼                   ▼
RequestHandler       UserService
references @A        references @A
    │                   │
    └─────────┬─────────┘
              ▼
    Scope Bindings:
    ┌─────────────────────────┐
    │ ScopedValue@A → User{…} │  ✓ Both see this binding
    └─────────────────────────┘
```

### The Mental Model: ScopedValue as a Key

Think of ScopedValue as a **key** in a key-value store, not as a container:

```java
// Analogy: Map-based context (don't actually do this)
Map<String, Object> context = new HashMap<>();
context.put("currentUser", user);  // "currentUser" is the key
User u = (User) context.get("currentUser");  // Same key retrieves value

// ScopedValue works similarly, but the KEY is the ScopedValue instance itself
ScopedValue.where(CURRENT_USER, user).run(() -> {  // CURRENT_USER is the key
    User u = CURRENT_USER.get();  // Same key retrieves value
});
```

The key must be **shared** (everyone needs the same key), **stable** (if the key changes, you can't find your data), and **global** (accessible from anywhere that needs the value). `static final` provides all three guarantees.

### Declaration Reference

| Declaration                       | Works?     | Why                                         |
| --------------------------------- | ---------- | ------------------------------------------- |
| `static final ScopedValue<T>`     | ✅ Yes     | Single shared instance, immutable reference |
| `static ScopedValue<T>`           | ⚠️ Fragile | Can be reassigned, breaking all bindings    |
| `final ScopedValue<T>` (instance) | ❌ No      | Each object has different instance          |
| `ScopedValue<T>` (instance)       | ❌ No      | Different instances + can be reassigned     |
| Local variable                    | ❌ No      | New instance each call                      |

### Organising ScopedValues

Given the `static final` requirement, here are clean ways to organise them:

```java
// Option 1: Dedicated context class
public final class RequestContext {
    public static final ScopedValue<User> USER = ScopedValue.newInstance();
    public static final ScopedValue<Tenant> TENANT = ScopedValue.newInstance();
    public static final ScopedValue<TraceId> TRACE = ScopedValue.newInstance();

    private RequestContext() {}  // Non-instantiable
}

// Option 2: Interface with constants
public interface SecurityContext {
    ScopedValue<Principal> PRINCIPAL = ScopedValue.newInstance();
    ScopedValue<Set<Role>> ROLES = ScopedValue.newInstance();
}

// Option 3: Grouped context record (recommended for related values)
public record RequestContext(User user, Tenant tenant, TraceId trace) {}

public final class Context {
    public static final ScopedValue<RequestContext> REQUEST = ScopedValue.newInstance();
    private Context() {}
}

// Usage — single binding for all related values
ScopedValue.where(Context.REQUEST, new RequestContext(user, tenant, trace))
           .run(() -> {
               RequestContext ctx = Context.REQUEST.get();
               ctx.user();
               ctx.tenant();
           });
```

## ScopedValue with Virtual Threads and Structured Concurrency

ScopedValue truly shines when combined with `StructuredTaskScope`. Child tasks automatically inherit the parent's scoped values **by reference** (not by copying).

### Automatic Inheritance

```java
private static final ScopedValue<User> USER = ScopedValue.newInstance();
private static final ScopedValue<TraceId> TRACE = ScopedValue.newInstance();

Response handleRequest(Request request) {
    return ScopedValue.where(USER, request.user())
                      .where(TRACE, TraceId.generate())
                      .call(() -> {
                          try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
                              // Child tasks automatically see USER and TRACE
                              var profileTask = scope.fork(this::fetchProfile);
                              var ordersTask = scope.fork(this::fetchOrders);
                              var recsTask = scope.fork(this::fetchRecommendations);

                              scope.join();
                              scope.throwIfFailed();

                              return new Response(
                                  profileTask.get(),
                                  ordersTask.get(),
                                  recsTask.get()
                              );
                          }
                      });
}

Profile fetchProfile() {
    // Runs on child virtual thread, but USER and TRACE are accessible
    User user = USER.get();
    TraceId trace = TRACE.get();
    log.info("Fetching profile for {} (trace: {})", user.id(), trace);
    return profileService.get(user.id());
}
```

### Inheritance Efficiency: ScopedValue vs InheritableThreadLocal

```
InheritableThreadLocal Inheritance:
──────────────────────────────────
Parent Thread                    Child Thread
┌──────────────────┐            ┌──────────────────┐
│ ThreadLocalMap   │ ──COPY──→  │ ThreadLocalMap   │
│  USER → User{A}  │            │  USER → User{A}  │  (separate copy)
│  TRACE → Trace{B}│            │  TRACE → Trace{B}│  (separate copy)
│  CONFIG → Cfg{C} │            │  CONFIG → Cfg{C} │  (separate copy)
└──────────────────┘            └──────────────────┘

Cost: O(n) where n = number of InheritableThreadLocals
With millions of virtual threads: PROHIBITIVE

ScopedValue Inheritance:
────────────────────────
Parent Thread                    Child Thread
┌──────────────────┐            ┌──────────────────┐
│ Scope Bindings   │            │ Scope Bindings   │
│  ┌─────────────┐ │            │  (inherits       │
│  │ USER ────────────────────────→ parent's      │
│  │ TRACE ───────────────────────→ bindings by   │
│  │ CONFIG ──────────────────────→ reference)    │
│  └─────────────┘ │            │                  │
└──────────────────┘            └──────────────────┘

Cost: O(1) — just a pointer to parent's bindings
With millions of virtual threads: TRIVIAL
```

### Rebinding in Child Tasks

Child tasks can rebind values for their own subtree without affecting siblings:

```java
private static final ScopedValue<String> OPERATION = ScopedValue.newInstance();

void parentTask() {
    ScopedValue.where(OPERATION, "parent-op").run(() -> {
        try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {

            // Child 1: rebinds OPERATION
            scope.fork(() -> {
                return ScopedValue.where(OPERATION, "child1-op").call(() -> {
                    System.out.println(OPERATION.get());  // "child1-op"
                    return doWork();
                });
            });

            // Child 2: sees parent's value
            scope.fork(() -> {
                System.out.println(OPERATION.get());  // "parent-op"
                return doOtherWork();
            });

            scope.join();
        }

        System.out.println(OPERATION.get());  // "parent-op"
    });
}
```

## Internal Implementation

Understanding the internals helps you reason about performance and behaviour.

### Stack-Based Binding Model

Unlike ThreadLocal's map-based approach, ScopedValue uses a **stack-like binding structure**:

```java
// Conceptual implementation (simplified)
public final class ScopedValue<T> {

    // Each thread has a chain of Snapshot objects
    // representing nested scopes

    static class Snapshot {
        final Snapshot previous;
        final ScopedValue<?> key;
        final Object value;

        Snapshot(Snapshot prev, ScopedValue<?> key, Object value) {
            this.previous = prev;
            this.key = key;
            this.value = value;
        }
    }

    // Simplified get() logic
    public T get() {
        Snapshot current = currentThreadSnapshot();
        while (current != null) {
            if (current.key == this) {
                return (T) current.value;
            }
            current = current.previous;
        }
        throw new NoSuchElementException();
    }
}
```

```
Thread's Snapshot Chain (stack grows down):
┌─────────────────────────────────┐
│ Snapshot 3 (innermost scope)    │
│   key: LOCALE                   │
│   value: Locale.JAPAN           │
│   previous: ↓                   │
├─────────────────────────────────┤
│ Snapshot 2                      │
│   key: TENANT                   │
│   value: Tenant{id=42}          │
│   previous: ↓                   │
├─────────────────────────────────┤
│ Snapshot 1 (outermost scope)    │
│   key: USER                     │
│   value: User{id=123}           │
│   previous: null                │
└─────────────────────────────────┘

get(USER)   → walks chain, finds at Snapshot 1
get(TENANT) → walks chain, finds at Snapshot 2
get(LOCALE) → walks chain, finds at Snapshot 3
```

### Performance Characteristics

```java
// ThreadLocal: O(1) hash lookup, but with overhead
THREAD_LOCAL.get();  // HashMap.get() on thread's map

// ScopedValue: O(d) where d = scope depth (typically very small)
SCOPED_VALUE.get();  // Walk snapshot chain

// In practice, scope depth is usually < 5
// JVM can optimise the common case heavily
```

The JVM applies several optimisations:

1. **Caching**: Recently accessed bindings are cached
2. **Scope flattening**: Multiple bindings in one `where()` chain are optimised
3. **Escape analysis**: Short-lived Snapshot objects may be stack-allocated

### Memory Model Guarantees

ScopedValue provides strong memory visibility guarantees:

```java
ScopedValue.where(DATA, expensiveComputation()).run(() -> {
    // Guaranteed: all writes in expensiveComputation() are visible here
    Data data = DATA.get();
    // No explicit synchronisation needed
});
```

This is achieved through the same mechanisms as `final` fields — the binding establishes a happens-before relationship.

## Best Practices

### 1. Declare as Static Final

```java
// CORRECT: Static final, clear naming
public class RequestContext {
    public static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();
    public static final ScopedValue<TraceId> TRACE_ID = ScopedValue.newInstance();
}

// WRONG: Instance field — defeats the purpose
public class Handler {
    private final ScopedValue<User> user = ScopedValue.newInstance();  // Don't do this
}
```

### 2. Bind at Entry Points, Read Everywhere Else

```java
// Entry point: HTTP request handler
@PostMapping("/orders")
public Response createOrder(@RequestBody OrderRequest request) {
    return ScopedValue.where(CURRENT_USER, extractUser(request))
                      .where(TRACE_ID, TraceId.fromHeaders(request))
                      .call(() -> orderService.create(request));
}

// Business logic: just reads
@Service
public class OrderService {
    public Order create(OrderRequest request) {
        User user = CURRENT_USER.get();  // Read, don't bind
        validatePermissions(user, request);
        return repository.save(new Order(user, request));
    }
}
```

### 3. Use Structured Concurrency for Inheritance

```java
// CORRECT: StructuredTaskScope inherits ScopedValues automatically
ScopedValue.where(CONTEXT, ctx).run(() -> {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        scope.fork(() -> useContext());  // CONTEXT.get() works
        scope.join();
    }
});

// PROBLEMATIC: Raw virtual threads don't inherit
ScopedValue.where(CONTEXT, ctx).run(() -> {
    Thread.startVirtualThread(() -> {
        CONTEXT.get();  // NoSuchElementException! Not inherited
    });
});
```

### 4. Provide Sensible Defaults or Fail Fast

```java
// Option 1: Fail fast with clear message
User getUser() {
    return CURRENT_USER.orElseThrow(() ->
        new IllegalStateException("No user in context. Ensure request handler binds CURRENT_USER."));
}

// Option 2: Safe default for optional context
Locale getLocale() {
    return LOCALE.orElse(Locale.getDefault());
}

// Option 3: Check before access for conditional logic
void audit() {
    if (AUDIT_CONTEXT.isBound()) {
        auditService.log(AUDIT_CONTEXT.get());
    }
}
```

### 5. Keep Scopes Appropriately Sized

```java
// GOOD: Scope matches logical operation boundary
void handleRequest(Request request) {
    ScopedValue.where(REQUEST_CONTEXT, new Context(request)).run(() -> {
        validateRequest();
        processRequest();
        sendResponse();
    });  // Context lifetime = request lifetime
}

// AVOID: Overly broad scope
void startApplication() {
    ScopedValue.where(CONFIG, loadConfig()).run(() -> {
        runEntireApplication();  // Scope too broad — use DI instead
    });
}

// AVOID: Overly narrow scope
void process() {
    for (Item item : items) {
        ScopedValue.where(ITEM, item).run(() -> {
            processItem();  // Excessive scope creation overhead
        });
    }
}

// BETTER: Bind once, rebind only when needed
void process() {
    ScopedValue.where(BATCH_ID, batchId).run(() -> {
        for (Item item : items) {
            processItem(item);  // Pass as parameter, not ScopedValue
        }
    });
}
```

### 6. Don't Store ScopedValues in Fields

```java
// WRONG: Capturing ScopedValue's value in a field
class OrderProcessor {
    private User user;  // Don't do this

    void init() {
        this.user = CURRENT_USER.get();  // Captured at wrong time
    }

    void process() {
        // Uses stale user, not current scope's user
    }
}

// CORRECT: Always access via ScopedValue.get()
class OrderProcessor {
    void process() {
        User user = CURRENT_USER.get();  // Fresh from current scope
        // ...
    }
}
```

## Migration: ThreadLocal to ScopedValue

### Pattern 1: Simple Context Passing

```java
// BEFORE: ThreadLocal
public class SecurityContext {
    private static final ThreadLocal<User> USER = new ThreadLocal<>();

    public static void setUser(User user) { USER.set(user); }
    public static User getUser() { return USER.get(); }
    public static void clear() { USER.remove(); }
}

// Usage
void handleRequest(User user) {
    SecurityContext.setUser(user);
    try {
        processRequest();
    } finally {
        SecurityContext.clear();
    }
}

// AFTER: ScopedValue
public class SecurityContext {
    public static final ScopedValue<User> USER = ScopedValue.newInstance();

    // No setUser/clear methods — binding is via where()
    public static User getUser() {
        return USER.orElseThrow(() -> new SecurityException("No user context"));
    }
}

// Usage
void handleRequest(User user) {
    ScopedValue.where(SecurityContext.USER, user).run(() -> {
        processRequest();
    });
    // Automatic cleanup when scope exits
}
```

### Pattern 2: Accumulated Context

```java
// BEFORE: Multiple ThreadLocals set at different points
void handleRequest(Request request) {
    USER_CONTEXT.set(extractUser(request));
    TENANT_CONTEXT.set(extractTenant(request));
    // Later...
    FEATURE_FLAGS.set(loadFlags());
    try {
        process();
    } finally {
        USER_CONTEXT.remove();
        TENANT_CONTEXT.remove();
        FEATURE_FLAGS.remove();
    }
}

// AFTER: Single binding point with all context
record RequestContext(User user, Tenant tenant, FeatureFlags flags) {}

private static final ScopedValue<RequestContext> CONTEXT = ScopedValue.newInstance();

void handleRequest(Request request) {
    RequestContext ctx = new RequestContext(
        extractUser(request),
        extractTenant(request),
        loadFlags()
    );

    ScopedValue.where(CONTEXT, ctx).run(() -> {
        process();
    });
}
```

### Pattern 3: Mutable Context (Requires Rethinking)

```java
// BEFORE: Mutable ThreadLocal (common anti-pattern)
private static final ThreadLocal<List<String>> WARNINGS =
    ThreadLocal.withInitial(ArrayList::new);

void process() {
    WARNINGS.get().add("Something concerning");
    // ... later ...
    WARNINGS.get().add("Another warning");
}

// AFTER: Use return values or accumulator pattern
record ProcessingResult(Result result, List<String> warnings) {}

ProcessingResult process() {
    List<String> warnings = new ArrayList<>();
    Result result = doProcess(warnings);
    return new ProcessingResult(result, warnings);
}

// OR: Scoped accumulator (if you must)
private static final ScopedValue<WarningCollector> WARNINGS = ScopedValue.newInstance();

void handleRequest() {
    WarningCollector collector = new WarningCollector();  // Thread-safe accumulator
    ScopedValue.where(WARNINGS, collector).run(() -> {
        process();
    });
    log.warn("Warnings: {}", collector.getWarnings());
}
```

## Common Pitfalls

### Pitfall 1: Forgetting Structured Concurrency

```java
// BUG: Raw executor doesn't inherit ScopedValues
ScopedValue.where(USER, user).run(() -> {
    executor.submit(() -> {
        USER.get();  // NoSuchElementException!
    });
});

// FIX: Use StructuredTaskScope
ScopedValue.where(USER, user).run(() -> {
    try (var scope = new StructuredTaskScope<>()) {
        scope.fork(() -> {
            USER.get();  // Works!
            return result;
        });
        scope.join();
    }
});
```

### Pitfall 2: Expecting Mutability

```java
// WRONG: Trying to mutate
ScopedValue.where(COUNTER, new AtomicInteger(0)).run(() -> {
    // This "works" but defeats immutability guarantees
    COUNTER.get().incrementAndGet();
    // Other threads see mutations — confusing!
});

// BETTER: Rebind with new value
ScopedValue.where(COUNTER, 0).run(() -> {
    int current = COUNTER.get();
    ScopedValue.where(COUNTER, current + 1).run(() -> {
        // New scope with incremented value
    });
});

// BEST: Use return values for accumulation
int result = ScopedValue.where(CONTEXT, ctx).call(() -> {
    return computeResult();  // Return, don't mutate
});
```

### Pitfall 3: Too Many ScopedValues

```java
// SMELL: Many related ScopedValues
private static final ScopedValue<User> USER = ScopedValue.newInstance();
private static final ScopedValue<Tenant> TENANT = ScopedValue.newInstance();
private static final ScopedValue<Locale> LOCALE = ScopedValue.newInstance();
private static final ScopedValue<TraceId> TRACE = ScopedValue.newInstance();
private static final ScopedValue<FeatureFlags> FLAGS = ScopedValue.newInstance();

// BETTER: Group into a context record
record RequestContext(User user, Tenant tenant, Locale locale, TraceId trace, FeatureFlags flags) {}

private static final ScopedValue<RequestContext> REQUEST = ScopedValue.newInstance();

// Single binding, clear semantics
ScopedValue.where(REQUEST, new RequestContext(...)).run(() -> {
    RequestContext ctx = REQUEST.get();
    // Access ctx.user(), ctx.tenant(), etc.
});
```

## Quick Reference

### API Summary

```java
// Creation
ScopedValue<T> sv = ScopedValue.newInstance();

// Binding and running
ScopedValue.where(sv, value).run(() -> { ... });           // void
T result = ScopedValue.where(sv, value).call(() -> { ... }); // returns T

// Multiple bindings
ScopedValue.where(sv1, v1).where(sv2, v2).run(() -> { ... });

// Access
T value = sv.get();                    // Throws if unbound
T value = sv.orElse(defaultValue);     // Default if unbound
T value = sv.orElseThrow(exSupplier);  // Custom exception
boolean bound = sv.isBound();          // Check binding

// With StructuredTaskScope
ScopedValue.where(sv, value).run(() -> {
    try (var scope = new StructuredTaskScope<>()) {
        scope.fork(() -> sv.get());  // Inherited automatically
        scope.join();
    }
});
```

### Decision Guide: ThreadLocal vs ScopedValue

| Use Case                                 | Recommendation                    |
| ---------------------------------------- | --------------------------------- |
| Immutable request context                | **ScopedValue**                   |
| Database connection per request          | ThreadLocal (pool gives/reclaims) |
| Security principal                       | **ScopedValue**                   |
| Mutable accumulator                      | Rethink design, or ThreadLocal    |
| Virtual thread workloads                 | **ScopedValue**                   |
| Third-party library requires ThreadLocal | ThreadLocal (compatibility)       |
| Need to rebind in nested scopes          | **ScopedValue**                   |
| Value needed outside call stack          | ThreadLocal                       |

## Summary

ScopedValue represents a fundamental improvement over ThreadLocal for the common use case of passing context through call stacks:

1. **Immutable by design** — Values can't be unexpectedly changed
2. **Automatic cleanup** — No risk of memory leaks or value leakage
3. **Efficient inheritance** — O(1) cost for virtual thread child tasks
4. **Clear scoping** — Lifetime is visually obvious in code structure
5. **Better composability** — Nested scopes with rebinding are clean

The combination of ScopedValue, virtual threads, and structured concurrency forms a cohesive programming model where concurrency is both powerful and predictable.

---

- Further reading: [JEP 506](https://openjdk.org/jeps/506)
- Scoped Value examples: [ScopedValueExample](https://github.com/nkcoder/java-core/blob/main/src/main/java/org/nkcoder/concurrency/scoped/ScopedValueExample.java)
