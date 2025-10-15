---
title: 'Code Review: Advanced Practices for Effective Reviews'
description: 'Quick-reference guide covering go-to resources, focus areas, communication patterns, review workflow, and Google’s standards for handling code reviews and feedback'
date: 2025-10-15
tags: [engineering]
---

# Revisit resources

- Clean Code
- Refactoring
- Google doc
  - What to look for in a code review
  - The standard of code review
- The pragamatic programmer

# Common concerns

- clean code
  - names, functions, comments
  - spaghetti code, god classes, magic numbers
  - DRY, SOLID, KISS
- security (input validation, auth)
- testing (unit/integration),
- refactor
  - duplication
  - over-complex logic
  - opportunities to extract methods/classes
- performance, optimization
- system design:
  - modularity (loose coupling)
  - error handling (graceful failures)
  - extensibility (interfaces for future plugins)

# Communication

- Phrase as questions or suggestions: `Have you considered ...`? Avoid `This is wrong`, `You need to`.
  - `Could we extract some of the logic into smaller methods...?`
  - `What do you think about extracting this logic into a separate class for better modularity?`
  - `It looks like this HashMap is accessed across multiple threads, which could lead to race conditions. Have we considered using ConcurrentHashMap to ensure thread safety? What do you think?`
- Acknowledge positive first: `Great job on the edge case handling`
- If disagreeing, explains why: `I see your point, but based on our load tests ...`
- Use inclusive languages `we` or `could` soften the tone and imply teamwork, avoid absolutes like `must` or `always`
- Provide context and trade-offs: explain why you're suggesting the change, focusing on the benefits to the team or codebase. Acknowledging trade-offs to show you're not assuming your way is the only option.
- Offer multiple options to spark discussions
- Acknowledge the intent: recognize the author's goal before suggesting changes to show you understand their perspective

# Review Framework

- First pass
  - What problems does this code solve?
  - What are the inputs, output, dependencies
  - How is it organized?
- Detailed review
  - Critical: security vulnerabilities, data corruption risks, production-breaking bugs
  - High: design flaws, performance issues, missing error handling
  - Medium: code clarity, testability, violation of principles
  - Low: style, naming, minor refactor opportunities

# How a staff developer do code review

1. Starts from unit tests
2. Ask questions about requirements
3. Compliment good code
4. All suggestions
5. In-depth review: pull code and review in IDE

Ref: [Code Review Tips (How I Review Code as a Staff Software Engineer)](https://www.youtube.com/watch?v=Y9sp8gONv9M&pp=ygUjaG93IGEgc3RhZmYgZW5naW5lZXIgZG8gY29kZSByZXZpZXc%3D)

# Google Code Review

## The Standard of Code Review

In general, reviewers should favor approving a PR once it is in a state where it definitely improves the overall code health of the system being worked on, even if the PR isn't perfect.

Instead of seeking perfection, what a reviewer should seek is continuous improvement.

**Resolving conflicts**

- It can help to have a face-to-face meeting or a video conference between the reviewer and the author, instead of code review comments.
- If that doesn't resolve the situation, the most common way is to escalate to a broader team discussion, having a technical lead or engineering manager weigh in, or asking help from a maintainer of the code.

## What to look for in a code review

- The code is well designed (interactions, integration, good timing?)
- The functionality is good for the users of the code
  - Does the PR do what the developer intended?
  - Any edge cases, concurrency problems?
- Complexity
  - Is the PR more complex than it should be?
  - A particular type of complexity is over-engineering
- Tests
  - Make sure tests (unit, integration, end-to-end) are correct, sensible and useful
- Naming
  - A good name is long enough to fully communicate what the item is or does
- Comments
  - Comments are explaining why, not explaining what
- Style
  - Make sure the PR follows the appropriate style guides
- Documentation
  - The code is well documented

## Navigating a PR in review

- Step 1: Take a broad view of the change
  - Look at the PR description and what the PR does in general. If the change shouldn't have happened in the first place, please respond immediately

- Step 2: Examine the main parts of the PR
  - Often, there is one file that has the largest number of logical changes; This helps give context to all of the smaller parts the PR and generally accelerates doing the code review.
  - If you see some major design problems with this part of the PR, you should send those comments immediately, even if you don't have time to review the rest right now.

- Step 3: Look through the rest of the PR in an appropriate sequence
  - Once you've confirmed there are no major design problems, try to figure out a logical sequence to look through the files
  - It is also helpful to read the tests first before you read the main code because you have an idea of what the change is supposed to be doing

## Speed of code review

- If you're not in the middle of a focused task, you should do a code review shortly after it comes in. One business day is the maximum time it should take to respond to a code review request (i.e., first thing in the next morning).
- If you're in the middle of a focused task, such as writing code, don't interrupt yourself to do a code review. Wait for a break point in your work before you respond to a request for review: your current coding task is completed, after lunch, returning from a meeting, coming back from the breakroom etc.
- It's even more important for the individual responses to come quickly than it is for the whole process to happen rapidly.
- It is important that reviewers spend enough time on review that they are certain their `LGTM` means `this code meets our standards`.

## How to write code review comments

- One way is to be sure that you are always making comments about the code and never making comments about the developer.
  - Bad: “Why did you use threads here when there’s obviously no benefit to be gained from concurrency?”
  - Good: “The concurrency model here is adding complexity to the system without any actual performance benefit that I can see. Because there’s no performance benefit, it’s best for this code to be single-threaded instead of using multiple threads.”

- Explain `why` to help the developer understand why you're making your comment.

- In general you should strike an appropriate balance between pointing out problems and providing direct guidance.

- If you see things you like in the PR, comment on those too. Just as with all comments, include why you liked something, further encouraging the developer to continue good practices.

- Consider labeling the severity of your comments, differentiating required changes from guidelines or suggestions. It makes review intent explicit and helps authors prioritize the importance of various comments.
  - Nit: This is a minor thing. Technically you should do it, but it won't hugely impact things.
  - Optional (or Consider): I think this may be a good idea, but it's not strictly required.
  - FYI: I don't expect you to do this in this PR, but you may find this interesting to think about for the future.

## Handling pushback in code reviews

- First, take a moment to consider if they're correct. Often, they're closer to the code than you are, and so they might really have a better insight about certain aspects of it. If their argument make sense, let them know they are right and let the issue drop.
- Second, if the reviewer believes their suggestion is correct, they should further explain why.

- Usually, if you are polite in your comments, developers actually don't become upset at all, and the worry is just in the review's mind. Upsets are usually more about the way comments are written than about the reviewer's insistence on code quality.

- It is usually best to insist that the developer clean up their PR now, before the code is in the codebase and `done`. Letting people `clean things up later` is a common way for codebases to degenerate.

Ref: [Google Code Review Guidelines](https://google.github.io/eng-practices/review/)
