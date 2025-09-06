---
title: Memory Management in Node.js
description: Understanding memory sections in Node.js.
---

# Memory Management in Node.js

At a high level, memory in a Node.js process is divided into three important sections:

- Stack Memory
- Heap Memory
- Native (C++) Memory

## Stack Memory

A region of memory that stores static data, like local variables, function arguments, and return addresses.

**Characteristics:**

- Managed automatically by a LIFO (Last In, First Out) structure.
- Fast allocations and deallocations.
- Limited in size (~1-2 MB per thread).
- Used for primitive types (numbers, booleans, undefined, null, symbols, BigInt) and references to objects in the heap (not the objects themselves).

**How it works:**

- It is managed automatically by the runtime and the OS, not the GC.
- The stack is a LIFO data structure.
- When a function is called, a stack frame is pushed containing:
  - Function arguments
  - Local variables
  - Return address
- When the function returns, its stack frame is popped off automatically.
- No garbage collection is needed - memory is reclaimed instantly by unwinding the stack.

Example:

```js
// name and message are stored on the stack
function greet(name: string) {
  const message = `Hello, ${name}`;
  console.log(message);
}

// when the function exits, "name" and "message" are popped off the stack. Memory is freed immediately.
greet("Alice");
```

## Heap Memory

A large, unstructured region in memory where objects, arrays, closures, and functions are stored.

**Characteristics:**

- Memory is dynamically allocated
- Access is slower than stack memory because of non-sequential allocation
- Managed by V8's garbage collector (using algorithms like Scavenge, Mark-Sweep, and Mark-Compact)
- Split into two generations for efficiency:
  - Young Generation: small, frequently collected; stores short-lived objects
  - Old Generation: larger, collected less often; stores long-lived objects

**How it works:**

- Managed by V8's garbage collector (GC).
- GC tracks reachability from roots (global scope, active stack frames)
- Uses algorithms like Mark-and-Sweep to identify and reclaim memory from unreachable objects.
- Reclaimed periodically - not instant like stack memory.

```js
function createUser() {
  const user = { name: 'Bob', age: 30 }; // stored in heap
  return user;
}

// u1 and u2 are references on the stack, pointing to different heap objects
const u1 = createUser();
const u2 = createUser();

// If u1 and u2 are no longer referenced, the GC will eventually reclaim their memory
```

## Native (C++) Memory

Memory allocated by Node.js internals and native modules written in C/C++.

**How it works:**

- Managed by Node.js internals, C++ addons, or OS APIs, not V8's GC directly
- Native memory comes from libraries like libuv, C++ bindings, or Buffers.
- Allocated using system calls like `malloc()` or `new (via Node.js internals)`
- Freed when references from JavaScript objects are released -

Examples:

- Buffers (`Buffer.from()`)
- File descriptors and handles
- Internal data structures (e.g., V8's internal heaps, libuv event loop data)

```js
const buf = Buffer.alloc(10); // allocates 10 bytes outside V8's heap
buf.write('hello');
```

## A Full Example

```js
function demo() {
  const buf = Buffer.alloc(1024);
  console.log(process.memoryUsage());
}

demo();
```

- Stack:
  - The variable (reference) `buf` is in the stack
  - This reference is created because `buf` is a local variable inside a scope
- Heap (managed by V8 GC):
  - Holds the **JavaScript Buffer object itself** (a wrapper object)
  - This wrapper contains metadata like length, offset, and - importantly - a pointer to the underlying native memory
- Native Memory (managed by Node.js internals):
  - Holds the **raw binary data** (1 KB of memory allocated by Node.js internals via C++)

Visualization:

```
Stack
 └── buf ──▶ (Heap) Buffer object
                  │
                  ├─ length: 1024
                  └─ pointer ──▶ (Native memory) 1 KB of raw data
```

- Stack: Managed automatically (when the function ends, local references are popped).
- Heap: Managed by V8 GC — when there are no references to the Buffer object anymore, the GC will collect it.
- Native memory: Freed by Node.js internals when the wrapper object (Buffer) is garbage-collected.

**This means**: although the variable itself (buf reference) is on the stack, the actual Buffer object is on the heap, and its raw memory is in native space. The GC still indirectly controls the native memory, because once the heap object is unreachable, Node.js finalizers release the underlying native allocation.

## Memory Limits

### Stack Memory Limit

The stack is relatively small, around 1-2 MB per thread (depends on OS and Node.js build). Deep recursion or large local variables can lead to stack overflow errors.

```js
function recurse() {
  return recurse();
}

recurse();
```

```
RangeError: Maximum call stack size exceeded
```

### Heap Memory Limit

The heap is managed by V8 (not Node.js itself).

Default max heap size:

- 64-bit systems: ~1.5 GB per Node.js process
- 32-bit systems: ~512 MB per Node.js process

You can increase the heap size using the `--max-old-space-size` flag (in MB):

```sh
node --max-old-space-size=4096 app.js  # sets max heap to 4 GB
```

The limit comes from **V8 design and architecture**, not the OS directly.

### Native Memory Limit

Native memory is limited by the system's available memory. However, excessive native allocations can lead to out-of-memory errors or crashes if the system runs out of memory.

It depends on:

- Available system RAM
- OS process limits (like `ulimit` on Unix)

Examples:

- Buffers (`Buffer.alloc()`) allocate native memory.
- File descriptors, sockets, and libuv handles consume native memory.

If you keep allocating large Buffers or many file handles without releasing them, your process may get killed by the OS Out-Of-Memory (OOM) killer, even if `heapUsed` looks fine.

### Summary

| Memory Type  | Managed By           | Size Limit                          | Characteristics                                      |
| ------------ | -------------------- | ----------------------------------- | ---------------------------------------------------- |
| Stack        | Runtime/OS           | ~1-2 MB per thread                  | Fast, LIFO, automatic, for primitives and references |
| Heap         | V8 Garbage Collector | ~1.5 GB (64-bit) / ~512 MB (32-bit) | Dynamic, slower, for objects, arrays, closures       |
| Native (C++) | Node.js Internals    | Limited by system memory            | For Buffers, file descriptors, handles               |

## Inspecting Memory Usage

You can monitor memory usage using `process.memoryUsage()`:

```js
import { Buffer } from 'buffer';

const buffer = Buffer.alloc(1024);
const arr = new ArrayBuffer(1023 * 1024);
const memory = process.memoryUsage();

console.log(memory);
```

Example output:

```json
{
  "rss": 39501824,
  "heapTotal": 5341184,
  "heapUsed": 3939184,
  "external": 1461150,
  "arrayBuffers": 12268
}
```

- **rss**: Resident Set Size - total memory allocated for the process (includes stack, heap, and native memory)
- **heapTotal**: Total size of the allocated heap
- **heapUsed**: Memory currently used in the heap
- **external**: Memory used by external C++ objects (like `Buffers`)
- **arrayBuffers**: Memory allocated for `ArrayBuffer` and `SharedArrayBuffer` objects. It is a subset of `external`.

## Best Practices

- Keep functions small to avoid deep stack usage (risk of RangeError: Maximum call stack size exceeded).
- Release native resources explicitly if possible (stream.destroy(), fs.close(), etc.).
- Don’t hold onto Buffers or file descriptors longer than needed.
- For memory-heavy apps, monitor:
  - `heapUsed` to track JS object memory (GC managed)
  - `external` to track native memory usage (Native allocations)
