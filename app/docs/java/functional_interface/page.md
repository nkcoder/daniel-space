---
title: Functional Interface
description: A comprehensive guide to functional interface in Java with practical examples
---

# Java Functional Interfaces

## What is a Functional Interface?

A functional interface is an interface with **exactly one abstract method** (SAM — Single Abstract Method). It can have multiple default or static methods, but only one abstract method.

Functional interfaces are the foundation of lambda expressions and method references in Java.

```java
@FunctionalInterface
public interface Processor {
    void process(String input);  // single abstract method

    // These don't count against SAM rule:
    default void processAll(List<String> items) {
        items.forEach(this::process);
    }

    static Processor noOp() {
        return input -> {};
    }
}
```

## The @FunctionalInterface Annotation

This annotation is **optional but recommended**. It:

- Documents intent clearly
- Triggers compile-time validation
- Prevents accidental addition of abstract methods

```java
@FunctionalInterface
public interface Calculator {
    int calculate(int a, int b);
}

// Compile error if you add another abstract method:
@FunctionalInterface
public interface Calculator {
    int calculate(int a, int b);
    int subtract(int a, int b);  // ERROR: not a functional interface
}
```

---

## Built-in Functional Interfaces (java.util.function)

Java provides 43+ functional interfaces. Here are the essential ones:

### Core Four

| Interface       | Method              | Input → Output | Use Case               |
| --------------- | ------------------- | -------------- | ---------------------- |
| `Function<T,R>` | `R apply(T t)`      | T → R          | Transform data         |
| `Consumer<T>`   | `void accept(T t)`  | T → void       | Side effects           |
| `Supplier<T>`   | `T get()`           | () → T         | Lazy values, factories |
| `Predicate<T>`  | `boolean test(T t)` | T → boolean    | Filtering, validation  |

### Primitive Specializations (avoid boxing overhead)

| Interface           | Method                     | Purpose          |
| ------------------- | -------------------------- | ---------------- |
| `IntFunction<R>`    | `R apply(int)`             | int → R          |
| `ToIntFunction<T>`  | `int applyAsInt(T)`        | T → int          |
| `IntConsumer`       | `void accept(int)`         | Consume int      |
| `IntSupplier`       | `int getAsInt()`           | Supply int       |
| `IntPredicate`      | `boolean test(int)`        | Test int         |
| `IntUnaryOperator`  | `int applyAsInt(int)`      | int → int        |
| `IntBinaryOperator` | `int applyAsInt(int, int)` | (int, int) → int |

Similar variants exist for `long` and `double`.

### Two-Argument Variants

| Interface           | Method                   | Input → Output   |
| ------------------- | ------------------------ | ---------------- |
| `BiFunction<T,U,R>` | `R apply(T t, U u)`      | (T, U) → R       |
| `BiConsumer<T,U>`   | `void accept(T t, U u)`  | (T, U) → void    |
| `BiPredicate<T,U>`  | `boolean test(T t, U u)` | (T, U) → boolean |

### Special Cases

| Interface           | Method                      | Purpose                                          |
| ------------------- | --------------------------- | ------------------------------------------------ |
| `UnaryOperator<T>`  | `T apply(T t)`              | Same type in/out (extends Function<T,T>)         |
| `BinaryOperator<T>` | `T apply(T t1, T t2)`       | Two same types → one (extends BiFunction<T,T,T>) |
| `Runnable`          | `void run()`                | No input, no output                              |
| `Callable<V>`       | `V call() throws Exception` | No input, returns value, can throw               |

---

## Practical Examples

### 1. Function<T, R> — Transformation

```java
// Basic transformation
Function<String, Integer> length = String::length;
Function<String, String> toUpper = String::toUpperCase;

int len = length.apply("hello");  // 5

// Chaining with andThen and compose
Function<String, String> trim = String::trim;
Function<String, String> pipeline = trim
    .andThen(toUpper)
    .andThen(s -> s.replace(" ", "_"));

String result = pipeline.apply("  hello world  ");  // "HELLO_WORLD"

// Real-world: DTO mapping
Function<User, UserDTO> toDto = user -> new UserDTO(
    user.getId(),
    user.getEmail(),
    user.getFullName()
);

List<UserDTO> dtos = users.stream()
    .map(toDto)
    .toList();
```

### 2. Consumer<T> — Side Effects

```java
// Basic consumer
Consumer<String> print = System.out::println;
Consumer<String> log = msg -> logger.info("Received: {}", msg);

// Chaining consumers
Consumer<Order> processOrder = order -> orderService.validate(order);
Consumer<Order> notifyCustomer = order -> emailService.send(order.getEmail());
Consumer<Order> updateInventory = order -> inventoryService.reduce(order.getItems());

Consumer<Order> fullPipeline = processOrder
    .andThen(notifyCustomer)
    .andThen(updateInventory);

orders.forEach(fullPipeline);

// Real-world: Event handling
public class EventBus {
    private final Map<Class<?>, List<Consumer<?>>> handlers = new ConcurrentHashMap<>();

    public <T> void subscribe(Class<T> eventType, Consumer<T> handler) {
        handlers.computeIfAbsent(eventType, k -> new CopyOnWriteArrayList<>())
                .add(handler);
    }

    @SuppressWarnings("unchecked")
    public <T> void publish(T event) {
        List<Consumer<?>> eventHandlers = handlers.get(event.getClass());
        if (eventHandlers != null) {
            eventHandlers.forEach(h -> ((Consumer<T>) h).accept(event));
        }
    }
}
```

### 3. Supplier<T> — Lazy Evaluation & Factories

```java
// Lazy initialization
Supplier<ExpensiveObject> lazyObject = () -> {
    System.out.println("Creating expensive object...");
    return new ExpensiveObject();
};

// Object only created when get() is called
ExpensiveObject obj = lazyObject.get();

// Memoization pattern
public static <T> Supplier<T> memoize(Supplier<T> supplier) {
    AtomicReference<T> cache = new AtomicReference<>();
    return () -> {
        T value = cache.get();
        if (value == null) {
            synchronized (cache) {
                value = cache.get();
                if (value == null) {
                    value = supplier.get();
                    cache.set(value);
                }
            }
        }
        return value;
    };
}

Supplier<Config> configSupplier = memoize(() -> loadConfigFromFile());

// Real-world: Default values
public <T> T getOrDefault(T value, Supplier<T> defaultSupplier) {
    return value != null ? value : defaultSupplier.get();
}

String name = getOrDefault(user.getNickname(), () -> user.getFirstName());

// Factory pattern
Map<String, Supplier<PaymentProcessor>> processors = Map.of(
    "CREDIT_CARD", CreditCardProcessor::new,
    "PAYPAL", PayPalProcessor::new,
    "CRYPTO", CryptoProcessor::new
);

PaymentProcessor processor = processors.get(paymentType).get();
```

### 4. Predicate<T> — Filtering & Validation

```java
// Basic predicates
Predicate<String> notEmpty = s -> s != null && !s.isEmpty();
Predicate<String> isEmail = s -> s.matches("^[\\w.-]+@[\\w.-]+\\.[a-zA-Z]{2,}$");
Predicate<Integer> isPositive = n -> n > 0;

// Combining predicates
Predicate<String> validEmail = notEmpty.and(isEmail);
Predicate<Integer> inRange = isPositive.and(n -> n <= 100);

// Negation
Predicate<String> isBlank = notEmpty.negate();

// Real-world: Specification pattern
public class UserSpecifications {
    public static Predicate<User> isActive() {
        return user -> user.getStatus() == Status.ACTIVE;
    }

    public static Predicate<User> hasRole(Role role) {
        return user -> user.getRoles().contains(role);
    }

    public static Predicate<User> createdAfter(LocalDate date) {
        return user -> user.getCreatedAt().isAfter(date);
    }

    public static Predicate<User> emailVerified() {
        return user -> user.isEmailVerified();
    }
}

// Usage
List<User> eligibleUsers = users.stream()
    .filter(isActive()
        .and(hasRole(Role.PREMIUM))
        .and(emailVerified()))
    .toList();

// Validation framework
public class Validator<T> {
    private final List<Predicate<T>> rules = new ArrayList<>();
    private final List<String> messages = new ArrayList<>();

    public Validator<T> addRule(Predicate<T> rule, String errorMessage) {
        rules.add(rule);
        messages.add(errorMessage);
        return this;
    }

    public ValidationResult validate(T object) {
        List<String> errors = new ArrayList<>();
        for (int i = 0; i < rules.size(); i++) {
            if (!rules.get(i).test(object)) {
                errors.add(messages.get(i));
            }
        }
        return new ValidationResult(errors.isEmpty(), errors);
    }
}

Validator<User> userValidator = new Validator<User>()
    .addRule(u -> u.getEmail() != null, "Email is required")
    .addRule(u -> u.getAge() >= 18, "Must be 18 or older")
    .addRule(u -> u.getPassword().length() >= 8, "Password too short");

ValidationResult result = userValidator.validate(newUser);
```

### 5. BiFunction & BiConsumer — Two Arguments

```java
// BiFunction: combining two values
BiFunction<String, String, String> concat = String::concat;
BiFunction<Integer, Integer, Integer> multiply = (a, b) -> a * b;

// Real-world: Map merge operations
Map<String, Integer> inventory = new HashMap<>();
BiFunction<Integer, Integer, Integer> sumQuantities = Integer::sum;

inventory.merge("apple", 5, sumQuantities);
inventory.merge("apple", 3, sumQuantities);  // apple -> 8

// BiConsumer: processing key-value pairs
BiConsumer<String, Integer> printEntry = (k, v) ->
    System.out.println(k + " = " + v);

inventory.forEach(printEntry);

// Real-world: Configurable mapper
public class ConfigurableMapper<S, T> {
    private final Map<String, BiFunction<S, T, ?>> fieldMappers = new HashMap<>();

    public ConfigurableMapper<S, T> map(String field, BiFunction<S, T, ?> mapper) {
        fieldMappers.put(field, mapper);
        return this;
    }

    public void apply(S source, T target) {
        fieldMappers.forEach((field, mapper) -> {
            Object value = mapper.apply(source, target);
            // apply value to target field via reflection
        });
    }
}
```

### 6. UnaryOperator & BinaryOperator

```java
// UnaryOperator: same type transformation
UnaryOperator<String> addPrefix = s -> "PREFIX_" + s;
UnaryOperator<Integer> doubleIt = n -> n * 2;

// Chaining
UnaryOperator<String> process = ((UnaryOperator<String>) String::trim)
    .andThen(String::toUpperCase)
    .andThen(addPrefix);

// Real-world: List transformation
List<String> names = new ArrayList<>(List.of(" alice ", " bob "));
names.replaceAll(String::trim);  // replaceAll takes UnaryOperator

// BinaryOperator: reduction operations
BinaryOperator<Integer> max = Integer::max;
BinaryOperator<BigDecimal> sum = BigDecimal::add;

// Real-world: Stream reductions
Optional<BigDecimal> total = orders.stream()
    .map(Order::getAmount)
    .reduce(BigDecimal::add);

// Custom accumulator
BinaryOperator<Map<String, Integer>> mergeMaps = (m1, m2) -> {
    Map<String, Integer> result = new HashMap<>(m1);
    m2.forEach((k, v) -> result.merge(k, v, Integer::sum));
    return result;
};
```

---

## Advanced Patterns

### 1. Function Composition

```java
public class Pipeline<T> {
    private Function<T, T> pipeline = Function.identity();

    public Pipeline<T> addStep(Function<T, T> step) {
        pipeline = pipeline.andThen(step);
        return this;
    }

    public T execute(T input) {
        return pipeline.apply(input);
    }
}

Pipeline<String> textPipeline = new Pipeline<String>()
    .addStep(String::trim)
    .addStep(String::toLowerCase)
    .addStep(s -> s.replaceAll("\\s+", " "))
    .addStep(s -> s.substring(0, Math.min(100, s.length())));

String cleaned = textPipeline.execute(rawInput);
```

### 2. Currying & Partial Application

```java
// Currying: transform multi-arg function into chain of single-arg functions
Function<Integer, Function<Integer, Integer>> curriedAdd = a -> b -> a + b;

Function<Integer, Integer> add5 = curriedAdd.apply(5);
int result = add5.apply(3);  // 8

// Real-world: Configurable formatter
Function<String, Function<LocalDate, String>> dateFormatter =
    pattern -> date -> date.format(DateTimeFormatter.ofPattern(pattern));

Function<LocalDate, String> isoFormatter = dateFormatter.apply("yyyy-MM-dd");
Function<LocalDate, String> euFormatter = dateFormatter.apply("dd/MM/yyyy");

// Partial application with BiFunction
public static <T, U, R> Function<U, R> partial(BiFunction<T, U, R> biFunc, T firstArg) {
    return u -> biFunc.apply(firstArg, u);
}

BiFunction<String, String, String> greet = (greeting, name) -> greeting + ", " + name + "!";
Function<String, String> sayHello = partial(greet, "Hello");
Function<String, String> sayGoodbye = partial(greet, "Goodbye");

sayHello.apply("Alice");    // "Hello, Alice!"
sayGoodbye.apply("Bob");    // "Goodbye, Bob!"
```

### 3. Exception Handling

```java
// Problem: Functional interfaces don't allow checked exceptions
// Solution: Wrapper interfaces

@FunctionalInterface
public interface ThrowingFunction<T, R, E extends Exception> {
    R apply(T t) throws E;

    static <T, R, E extends Exception> Function<T, R> unchecked(
            ThrowingFunction<T, R, E> f) {
        return t -> {
            try {
                return f.apply(t);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };
    }

    static <T, R, E extends Exception> Function<T, R> withDefault(
            ThrowingFunction<T, R, E> f, R defaultValue) {
        return t -> {
            try {
                return f.apply(t);
            } catch (Exception e) {
                return defaultValue;
            }
        };
    }
}

// Usage
List<URL> urls = paths.stream()
    .map(ThrowingFunction.unchecked(path -> new URL(path)))
    .toList();

// Or with Either/Result pattern
public sealed interface Result<T> permits Success, Failure {
    static <T> Result<T> of(Supplier<T> supplier) {
        try {
            return new Success<>(supplier.get());
        } catch (Exception e) {
            return new Failure<>(e);
        }
    }
}
record Success<T>(T value) implements Result<T> {}
record Failure<T>(Exception error) implements Result<T> {}

List<Result<URL>> results = paths.stream()
    .map(path -> Result.of(() -> new URL(path)))
    .toList();
```

### 4. Method References

```java
// Four types of method references:

// 1. Static method: ClassName::staticMethod
Function<String, Integer> parse = Integer::parseInt;

// 2. Instance method of particular object: instance::method
String prefix = "Hello";
Function<String, String> greet = prefix::concat;

// 3. Instance method of arbitrary object: ClassName::instanceMethod
Function<String, String> upper = String::toUpperCase;
BiFunction<String, String, Boolean> startsWith = String::startsWith;

// 4. Constructor: ClassName::new
Supplier<ArrayList<String>> listFactory = ArrayList::new;
Function<String, StringBuilder> sbFactory = StringBuilder::new;

// Array constructor
IntFunction<String[]> arrayFactory = String[]::new;
String[] array = arrayFactory.apply(10);  // new String[10]
```

### 5. Composing Predicates for Query Building

```java
public class QueryBuilder<T> {
    private Predicate<T> predicate = t -> true;

    public QueryBuilder<T> where(Predicate<T> condition) {
        predicate = predicate.and(condition);
        return this;
    }

    public QueryBuilder<T> or(Predicate<T> condition) {
        predicate = predicate.or(condition);
        return this;
    }

    public QueryBuilder<T> not(Predicate<T> condition) {
        predicate = predicate.and(condition.negate());
        return this;
    }

    public List<T> execute(Collection<T> data) {
        return data.stream().filter(predicate).toList();
    }
}

List<Product> results = new QueryBuilder<Product>()
    .where(p -> p.getPrice() > 100)
    .where(p -> p.getCategory().equals("Electronics"))
    .or(p -> p.isOnSale())
    .not(p -> p.isDiscontinued())
    .execute(products);
```

---

## Best Practices

### 1. Prefer Built-in Interfaces

```java
// ❌ Don't create custom interface when built-in exists
interface StringProcessor {
    String process(String input);
}

// ✅ Use UnaryOperator<String> instead
UnaryOperator<String> processor = String::toUpperCase;
```

### 2. Use Primitive Specializations for Performance

```java
// ❌ Causes boxing/unboxing overhead
Function<Integer, Integer> doubler = n -> n * 2;

// ✅ Use primitive specialization
IntUnaryOperator doubler = n -> n * 2;

// Performance matters in streams
int sum = numbers.stream()
    .mapToInt(Integer::intValue)  // convert to IntStream
    .map(n -> n * 2)              // uses IntUnaryOperator
    .sum();
```

### 3. Keep Lambdas Short

```java
// ❌ Too complex for inline lambda
list.stream()
    .filter(item -> {
        if (item == null) return false;
        String processed = item.trim().toLowerCase();
        return processed.length() > 5 &&
               processed.matches("[a-z]+") &&
               !blacklist.contains(processed);
    })
    .toList();

// ✅ Extract to method or compose predicates
private boolean isValidItem(String item) {
    if (item == null) return false;
    String processed = item.trim().toLowerCase();
    return processed.length() > 5 &&
           processed.matches("[a-z]+") &&
           !blacklist.contains(processed);
}

list.stream().filter(this::isValidItem).toList();
```

### 4. Avoid Side Effects in Functions

```java
// ❌ Side effects in Function
List<String> sideEffectList = new ArrayList<>();
Function<String, String> badFunction = s -> {
    sideEffectList.add(s);  // side effect!
    return s.toUpperCase();
};

// ✅ Use Consumer for side effects, Function for transformation
Consumer<String> collector = sideEffectList::add;
Function<String, String> transformer = String::toUpperCase;

list.forEach(item -> {
    String transformed = transformer.apply(item);
    collector.accept(transformed);
});
```

### 5. Document Custom Functional Interfaces

```java
/**
 * Processes a payment transaction and returns the result.
 *
 * @param <T> the type of payment request
 * @param <R> the type of payment response
 */
@FunctionalInterface
public interface PaymentProcessor<T extends PaymentRequest, R extends PaymentResponse> {

    /**
     * Processes the payment.
     *
     * @param request the payment request
     * @return the payment response
     * @throws PaymentException if processing fails
     */
    R process(T request) throws PaymentException;
}
```

---

## Java 21+ Considerations

### Pattern Matching with Functional Interfaces

```java
// Using pattern matching in lambdas (Java 21+)
Function<Object, String> describe = obj -> switch (obj) {
    case Integer i -> "Integer: " + i;
    case String s -> "String: " + s;
    case List<?> l -> "List of size: " + l.size();
    case null -> "null value";
    default -> "Unknown: " + obj.getClass();
};

// With records
record Point(int x, int y) {}
record Circle(Point center, int radius) {}
record Rectangle(Point topLeft, int width, int height) {}

Function<Object, Double> area = shape -> switch (shape) {
    case Circle(var c, var r) -> Math.PI * r * r;
    case Rectangle(var p, var w, var h) -> (double) w * h;
    default -> 0.0;
};
```

### Sequenced Collections (Java 21+)

```java
// New methods work well with functional interfaces
SequencedCollection<String> seq = new LinkedHashSet<>(List.of("a", "b", "c"));

Consumer<String> process = System.out::println;

seq.reversed().forEach(process);  // c, b, a
```

---

## Summary

| Interface           | Method             | Use When You Need To  |
| ------------------- | ------------------ | --------------------- |
| `Function<T,R>`     | `apply(T): R`      | Transform a value     |
| `Consumer<T>`       | `accept(T): void`  | Perform side effects  |
| `Supplier<T>`       | `get(): T`         | Lazily provide values |
| `Predicate<T>`      | `test(T): boolean` | Filter or validate    |
| `UnaryOperator<T>`  | `apply(T): T`      | Transform same type   |
| `BinaryOperator<T>` | `apply(T,T): T`    | Reduce two to one     |
| `BiFunction<T,U,R>` | `apply(T,U): R`    | Combine two values    |
| `Runnable`          | `run(): void`      | Execute without I/O   |
| `Callable<V>`       | `call(): V`        | Execute and return    |

Functional interfaces enable cleaner, more composable code. Master the core four (`Function`, `Consumer`, `Supplier`, `Predicate`), use primitive specializations for performance, and leverage composition methods (`andThen`, `compose`, `and`, `or`) to build powerful pipelines.

---

- [Functional Interface Examples](https://github.com/nkcoder/java-core/blob/main/src/main/java/org/nkcoder/fp/FunctionalInterfaceExample.java)
