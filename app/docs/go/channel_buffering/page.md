---
title: 'Channel buffering in Go'
date: 2025-05-18
tags: [go]
---

## Unbuffered Channel

Characteristics:

- Synchronous: Send blocks until another goroutine receives
- Zero capacity: Cannot store any values
- Requires coordination: Both sender and receiver must be ready simultaneously
- Creation: `ch := make(chan int)` or `ch := make(chan int, 0)`

Why Strict Synchronization Matters:

- No race conditions: Operations happen in guaranteed order
- Complete acknowledgment: Sender knows receiver got the message
- Resource coordination: Prevents resource conflicts by ensuring sequential access
- Error handling: If receiver can't process, sender is immediately blocked

### Use Case 1: Strict Synchronization

**Sequential execution guarantee**: each step waits for complete confirmation before proceeding.

```go
func strictSequentialExecution() {
    step1Done := make(chan bool) // unbuffered
    step2Done := make(chan bool) // unbuffered

    // Goroutine 1: Database setup
    go func() {
        fmt.Println("Step 1: Setting up database...")
        time.Sleep(1 * time.Second) // Simulate DB setup
        fmt.Println("Step 1: Database ready")
        step1Done <- true // Blocks until main goroutine acknowledges
    }()

    // Goroutine 2: Cache initialization (depends on DB)
    go func() {
        <-step1Done // Blocks until step 1 is completely done
        fmt.Println("Step 2: Initializing cache...")
        time.Sleep(500 * time.Millisecond) // Simulate cache setup
        fmt.Println("Step 2: Cache ready")
        step2Done <- true // Blocks until main goroutine acknowledges
    }()

    // Main goroutine: Start application (depends on both)
    <-step2Done // Blocks until step 2 is completely done
    fmt.Println("Step 3: Starting application server...")
    fmt.Println("All systems ready!")
}
```

---

**Barrier Synchronization**: ensuring multiple goroutines reach a specific point before any can continue.

```go
func barrierSync() {
    const numWorkers = 3
    barrier := make(chan bool) // unbuffered
    allReady := make(chan bool) // unbuffered

    // Coordinator goroutine
    go func() {
        readyCount := 0
        for readyCount < numWorkers {
            <-barrier // Blocks until a worker signals ready
            readyCount++
            fmt.Printf("Worker %d ready, waiting for %d more\n",
                readyCount, numWorkers-readyCount)
        }

        // All workers are ready, signal them to proceed
        fmt.Println("All workers ready! Signaling to proceed...")
        for i := 0; i < numWorkers; i++ {
            allReady <- true // Each send blocks until worker receives
        }
    }()

    // Worker goroutines
    for i := 1; i <= numWorkers; i++ {
        go func(id int) {
            // Phase 1: Preparation
            fmt.Printf("Worker %d: Preparing...\n", id)
            time.Sleep(time.Duration(id) * time.Second) // Different prep times

            // Signal ready and wait for others
            fmt.Printf("Worker %d: Ready, waiting for others...\n", id)
            barrier <- true    // Blocks until coordinator receives
            <-allReady        // Blocks until coordinator signals proceed

            // Phase 2: Synchronized execution
            fmt.Printf("Worker %d: Starting synchronized work!\n", id)
            time.Sleep(1 * time.Second)
            fmt.Printf("Worker %d: Finished!\n", id)
        }(i)
    }

    time.Sleep(10 * time.Second) // Let everything complete
}
```

---

**Request-Response Synchronization**: ensuring a request is fully processed before sending the next one.

```go
type DatabaseService struct {
    requests chan DatabaseRequest
}

type DatabaseRequest struct {
    Query    string
    Response chan DatabaseResponse // unbuffered!
}

type DatabaseResponse struct {
    Data []string
    Err  error
}

func (db *DatabaseService) Start() {
    go func() {
        for req := range db.requests {
            // Process the request
            fmt.Printf("Processing query: %s\n", req.Query)
            time.Sleep(100 * time.Millisecond) // Simulate DB work

            // Send response - this blocks until requester receives
            req.Response <- DatabaseResponse{
                Data: []string{"result1", "result2"},
                Err:  nil,
            }
            // At this point, we KNOW the response was received
            fmt.Printf("Query '%s' response delivered and acknowledged\n", req.Query)
        }
    }()
}

func (db *DatabaseService) Query(query string) ([]string, error) {
    // Create unbuffered response channel
    responseChan := make(chan DatabaseResponse) // unbuffered

    // Send request
    db.requests <- DatabaseRequest{
        Query:    query,
        Response: responseChan,
    }

    // Wait for response - blocks until DB service sends result
    response := <-responseChan
    fmt.Printf("Client received response for: %s\n", query)

    return response.Data, response.Err
}

func databaseExample() {
    db := &DatabaseService{
        requests: make(chan DatabaseRequest, 10), // This can be buffered
    }

    db.Start()

    // Make synchronous database calls
    data, err := db.Query("SELECT * FROM users")
    if err == nil {
        fmt.Printf("Got data: %v\n", data)
    }

    // This won't execute until the previous query is completely done
    data2, err2 := db.Query("SELECT * FROM orders")
    if err2 == nil {
        fmt.Printf("Got data2: %v\n", data2)
    }
}
```

### Use Case 2: Handoff scenarios with confirmation receipt

```go
func processData(data string) {
    result := make(chan string) // unbuffered

    // Start processing in another goroutine
    go func() {
        // Simulate some work
        processed := strings.ToUpper(data)
        result <- processed // This blocks until main goroutine receives
        // At this point, we KNOW the result was received
        fmt.Println("Processing confirmed complete")
    }()

    // Main goroutine receives the result
    finalResult := <-result // This blocks until processing is done
    fmt.Println("Received:", finalResult)
}
```

---

Real-world example: database transaction commit.

```go
func commitTransaction(tx *sql.Tx) error {
    done := make(chan error) // unbuffered

    go func() {
        err := tx.Commit()
        done <- err // Blocks until main goroutine confirms receipt
        // We know the error status has been acknowledged
    }()

    return <-done // Blocks until commit attempt is complete
}
```

### Use Case 3: Worker pools where you want backpressure

```go
func workerPool() {
    jobs := make(chan int)    // unbuffered - creates backpressure
    results := make(chan int) // unbuffered

    // Start 3 workers
    for i := 0; i < 3; i++ {
        go func(id int) {
            for job := range jobs {
                fmt.Printf("Worker %d processing job %d\n", id, job)
                time.Sleep(2 * time.Second) // Simulate work
                results <- job * 2
            }
        }(i)
    }

    // Producer goroutine
    go func() {
        for i := 1; i <= 10; i++ {
            fmt.Printf("Sending job %d\n", i)
            jobs <- i // This BLOCKS if all workers are busy
            fmt.Printf("Job %d sent (worker available)\n", i)
        }
        close(jobs)
    }()

    // Collect results
    for i := 0; i < 10; i++ {
        result := <-results
        fmt.Printf("Got result: %d\n", result)
    }
}
```

---

Real-world example: HTTP server with worker pool.

```go
// HTTP server with worker pool
func handleRequests() {
    workChan := make(chan *http.Request) // unbuffered

    // Limited workers
    for i := 0; i < 5; i++ {
        go worker(workChan)
    }

    http.HandleFunc("/process", func(w http.ResponseWriter, r *http.Request) {
        select {
        case workChan <- r: // Try to send work
            w.WriteHeader(http.StatusAccepted)
        case <-time.After(100 * time.Millisecond): // Timeout if workers busy
            w.WriteHeader(http.StatusServiceUnavailable)
            w.Write([]byte("Server busy, try again later"))
        }
    })
}
```

## Buffered Channel

- Asynchronous: Send only blocks when buffer is full; receive blocks when buffer is empty
- Has capacity: Can store values up to the buffer size
- Decoupled: Sender can send without immediate receiver
- Creation: `ch := make(chan int, capacity)` where `capacity` is the buffer size

### Use Case 1: Producer-Consumer Decoupling

Producers and consumers can work independently at their own speeds.

```go
func producerConsumerDecoupling() {
    // Buffer allows producer and consumer to work at different rates
    dataChan := make(chan string, 100) // buffered
    done := make(chan bool)

    // Fast producer - generates data quickly
    go func() {
        defer close(dataChan)
        for i := 1; i <= 50; i++ {
            data := fmt.Sprintf("data-%d", i)
            dataChan <- data // Rarely blocks due to buffer
            fmt.Printf("Produced: %s (buffer usage: %d/%d)\n",
                data, len(dataChan), cap(dataChan))
            time.Sleep(50 * time.Millisecond) // Fast production
        }
        fmt.Println("Producer finished")
    }()

    // Slow consumer - processes data slowly
    go func() {
        defer func() { done <- true }()
        for data := range dataChan {
            fmt.Printf("Processing: %s\n", data)
            time.Sleep(200 * time.Millisecond) // Slow processing (4x slower)
            fmt.Printf("Finished processing: %s\n", data)
        }
        fmt.Println("Consumer finished")
    }()

    <-done
    fmt.Println("All done - producer didn't wait for slow consumer!")
}
```

---

Real-world example: log processing system.

```go
type LogProcessor struct {
    logBuffer chan LogEntry
    batchSize int
}

type LogEntry struct {
    Timestamp time.Time
    Level     string
    Message   string
}

func NewLogProcessor() *LogProcessor {
    return &LogProcessor{
        logBuffer: make(chan LogEntry, 1000), // Large buffer
        batchSize: 50,
    }
}

func (lp *LogProcessor) Start() {
    go func() {
        batch := make([]LogEntry, 0, lp.batchSize)
        ticker := time.NewTicker(5 * time.Second)
        defer ticker.Stop()

        for {
            select {
            case entry, ok := <-lp.logBuffer:
                if !ok {
                    lp.flushBatch(batch) // Final flush
                    return
                }
                batch = append(batch, entry)

                if len(batch) >= lp.batchSize {
                    lp.flushBatch(batch)
                    batch = batch[:0] // Reset slice
                }

            case <-ticker.C:
                if len(batch) > 0 {
                    lp.flushBatch(batch)
                    batch = batch[:0]
                }
            }
        }
    }()
}

func (lp *LogProcessor) Log(level, message string) {
    entry := LogEntry{
        Timestamp: time.Now(),
        Level:     level,
        Message:   message,
    }

    select {
    case lp.logBuffer <- entry: // Non-blocking if buffer has space
    default:
        // Buffer full - could log to stderr, drop, or implement other strategy
        fmt.Println("Log buffer full, dropping message:", message)
    }
}

func (lp *LogProcessor) flushBatch(batch []LogEntry) {
    fmt.Printf("Flushing batch of %d logs to database\n", len(batch))
    time.Sleep(100 * time.Millisecond) // Simulate DB write
}
```

### Use Case 2: Batching operations

Reduces expensive operations (DB calls, network requests) by grouping items.

Real-world example: Database bulk insert.

```go
type DatabaseBatcher struct {
    insertChan chan UserRecord
    batchSize  int
}

type UserRecord struct {
    ID    int
    Name  string
    Email string
}

func NewDatabaseBatcher() *DatabaseBatcher {
    db := &DatabaseBatcher{
        insertChan: make(chan UserRecord, 500), // Large buffer for batching
        batchSize:  25,
    }
    db.startBatchProcessor()
    return db
}

func (db *DatabaseBatcher) startBatchProcessor() {
    go func() {
        batch := make([]UserRecord, 0, db.batchSize)
        ticker := time.NewTicker(2 * time.Second) // Force batch every 2 seconds
        defer ticker.Stop()

        for {
            select {
            case record, ok := <-db.insertChan:
                if !ok {
                    db.bulkInsert(batch)
                    return
                }

                batch = append(batch, record)
                if len(batch) >= db.batchSize {
                    db.bulkInsert(batch)
                    batch = batch[:0]
                }

            case <-ticker.C:
                if len(batch) > 0 {
                    fmt.Printf("Timer triggered batch insert of %d records\n", len(batch))
                    db.bulkInsert(batch)
                    batch = batch[:0]
                }
            }
        }
    }()
}

func (db *DatabaseBatcher) Insert(record UserRecord) {
    db.insertChan <- record // Rarely blocks due to buffering
}

func (db *DatabaseBatcher) bulkInsert(records []UserRecord) {
    fmt.Printf("BULK INSERT: Inserting %d records in single transaction\n", len(records))
    // Simulate bulk insert - much more efficient than individual inserts
    time.Sleep(20 * time.Millisecond) // vs 5ms per individual insert
    fmt.Printf("Bulk insert completed for %d records\n", len(records))
}
```

### Use Case 3: Reducing goroutine blocking when occasional bursts occur

Temporary spikes don't block producers, improving system responsiveness.

Real-world example: HTTP server with burst protection

```go
type BurstHandler struct {
    workChan   chan *http.Request
    workers    int
    bufferSize int
}

func NewBurstHandler(workers, bufferSize int) *BurstHandler {
    handler := &BurstHandler{
        workChan:   make(chan *http.Request, bufferSize),
        workers:    workers,
        bufferSize: bufferSize,
    }
    handler.startWorkers()
    return handler
}

func (bh *BurstHandler) startWorkers() {
    for i := 0; i < bh.workers; i++ {
        go func(workerID int) {
            for req := range bh.workChan {
                bh.processRequest(req, workerID)
            }
        }(i)
    }
}

func (bh *BurstHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    select {
    case bh.workChan <- r:
        // Request queued successfully
        w.Header().Set("X-Queue-Depth", fmt.Sprintf("%d", len(bh.workChan)))
        w.WriteHeader(http.StatusAccepted)
        fmt.Fprintf(w, "Request queued (depth: %d/%d)", len(bh.workChan), bh.bufferSize)

    default:
        // Buffer full - reject with 503
        w.WriteHeader(http.StatusServiceUnavailable)
        fmt.Fprintf(w, "Server busy, try again later")
        fmt.Printf("Request rejected - buffer full (%d/%d)\n", len(bh.workChan), bh.bufferSize)
    }
}

func (bh *BurstHandler) processRequest(r *http.Request, workerID int) {
    fmt.Printf("Worker %d processing %s %s\n", workerID, r.Method, r.URL.Path)
    time.Sleep(200 * time.Millisecond) // Simulate work
    fmt.Printf("Worker %d finished %s %s\n", workerID, r.Method, r.URL.Path)
}

func httpBurstExample() {
    handler := NewBurstHandler(3, 20) // 3 workers, buffer 20 requests

    http.Handle("/api/process", handler)

    fmt.Println("Server starting on :8080")
    fmt.Println("Buffer can handle bursts of up to 20 requests without blocking")
    http.ListenAndServe(":8080", nil)
}
```
