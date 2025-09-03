---
title: Event Loop in Node.js
description: Understanding the event loop in Node.js.
date: 2025-09-03
---

# Event Loop in Node.js

The Node.js event loop is the core mechanism that enables Node.js to perform non-blocking I/O operations despite JavaScript being single-threaded.

## Event Loop Overview

The event loop is what allows Node.js to offload operations to the system kernel whenever possible, and handles the execution of callbacks when those operations complete. It's implemented using libuv, a C++ library that provides asynchronous I/O.

## Event Loop Phases

The event loop operates in cycles (called **ticks**), each with a specific purpose. Here are the six main phases.

### Timer Phase

Executes callbacks scheduled by `setTimeout()` and `setInterval()` if their timers have expired.

```js
// Executes callbacks scheduled by setTimeout() and setInterval()
setTimeout(() => {
  console.log('Timer callback');
}, 0);

setInterval(() => {
  console.log('Interval callback');
}, 100);
```

### Pending Callbacks Phase

- Executes I/O callbacks that were deferred from the previous cycle
- Handles callbacks for some system operations (like TCP errors)

### Poll Phase (Core Phase)

This phase fetches new I/O events and executes I/O-related callbacks.

```js
// File system operations
const fs = require('fs');
fs.readFile('file.txt', (err, data) => {
  console.log('File read complete');
});

// Network operations
const http = require('http');
http.get('http://example.com', (res) => {
  console.log('HTTP response received');
});
```

Poll phase behavior:

- If there are callbacks in the poll queue, execute them synchronously until queue is empty
- If poll queue is empty:
  - If there are `setImmediate()` callbacks, end poll phase and go to check phase
  - If no `setImmediate()` callbacks, wait for new callbacks and execute immediately
  - If timers are ready, wrap back to timers phase

### Check Phase

Executes callbacks scheduled by `setImmediate()`.
Import difference from `setTimeout()`:

- `setImmediate()` always runs after the poll phase, making it more predicable for deferring execution.

```js
// Executes setImmediate() callbacks
setImmediate(() => {
  console.log('setImmediate callback');
});
```

### Close Callbacks Phase

Executes `close` event callbacks, such as when a socket or handle is closed.

```js
// Executes close event callbacks
const server = http.createServer();
server.close(() => {
  console.log('Server closed');
});
```

### Microtask

Microtasks are executed after each phase of the event loop, before moving to the next phase.

- `process.nextTick()`: Highest priority, executed immediately after the current operation completes.
- `Promise` callbacks: Runs after the current phase and before the next phase.

```js
// Process.nextTick has highest priority
process.nextTick(() => {
  console.log('nextTick 1');
});

// Promise callbacks are microtasks
Promise.resolve().then(() => {
  console.log('Promise 1');
});

process.nextTick(() => {
  console.log('nextTick 2');
});

Promise.resolve().then(() => {
  console.log('Promise 2');
});

// Output:
// nextTick 1
// nextTick 2
// Promise 1
// Promise 2
```

### A Complete Example

```js
const fs = require('fs');

console.log('=== Start ===');

// Poll phase callback (I/O operation)
fs.readFile('package.json', (err, data) => {
  console.log('📁 File read callback (POLL PHASE)');

  // These will be microtasks
  process.nextTick(() => console.log('📌 nextTick inside fs callback'));
  Promise.resolve().then(() => console.log('🎯 Promise inside fs callback'));
});

// Timer phase callback
setTimeout(() => {
  console.log('⏰ setTimeout callback (TIMER PHASE)');
}, 0);

// Check phase callback
setImmediate(() => {
  console.log('🚀 setImmediate callback (CHECK PHASE)');
});

// Microtasks
process.nextTick(() => console.log('📌 nextTick 1'));
Promise.resolve().then(() => console.log('🎯 Promise 1'));

console.log('=== End ===');

// Typical output:
// === Start ===
// === End ===
// 📌 nextTick 1
// 🎯 Promise 1
// ⏰ setTimeout callback (TIMER PHASE)
// 📁 File read callback (POLL PHASE)
// 📌 nextTick inside fs callback
// 🎯 Promise inside fs callback
// 🚀 setImmediate callback (CHECK PHASE)
```

## Execution Order Summary

- First: `process.nextTick()` has the highest priority.
- Then: Promise callbacks (microtasks).
- Finally: Event loop phases in order: Timers → Pending Callbacks → Poll → Check → Close Callbacks.

## Key Takeaways

- **Single-threaded:** The event loop runs on a single thread, but I/O operations are delegated to the system or thread pool.
- **Non-blocking:** The event loop doesn't wait for I/O operations to complete.
- **Priority:** process.nextTick() has highest priority, followed by Promise callbacks.
- **Phase transitions:** Microtasks are processed between every phase.
- **Starvation:** Too many process.nextTick() callbacks can starve the event loop.

## Further Reading

- [The Node.js Event Loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick#the-nodejs-event-loop)
- [A Complete Visual Guide to Understanding the Node.js Event Loop](https://www.builder.io/blog/visual-guide-to-nodejs-event-loop)
