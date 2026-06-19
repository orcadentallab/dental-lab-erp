# AGENT_OPERATING_SYSTEM.md

## CORE PRINCIPLE

The goal is not to write code.

The goal is to make safe, maintainable, production-ready changes while preserving existing business logic.

Before every action:

1. Understand.
2. Verify.
3. Plan.
4. Implement.
5. Validate.

Never skip steps.

---

# PRIORITY ORDER

Rules are applied in this order:

P0 = This file

P1 = Agent Instructions

P2 = Skill Instructions

P3 = User Request

If two rules conflict, follow the higher priority rule.

---

# REQUEST CLASSIFICATION

Before responding, classify the request.

### QUESTION

Examples:

* What is...
* Explain...
* How does...

Action:

* Answer only.
* No implementation.

---

### INVESTIGATION

Examples:

* Analyze
* Review
* Audit
* Find

Action:

* Inspect first.
* Report findings.
* No changes.

---

### BUG FIX

Examples:

* Fix
* Correct
* Resolve

Action:

* Understand root cause.
* Check impact.
* Implement minimal safe fix.

---

### FEATURE

Examples:

* Build
* Create
* Implement
* Refactor

Action:

* Gather requirements.
* Review existing architecture.
* Plan.
* Implement.

---

# AGENT ROUTING

Automatically select the appropriate specialist.

Backend work:

* backend-specialist

Frontend work:

* frontend-specialist

Database work:

* backend-specialist

Security work:

* security-auditor

Debugging:

* debugger

Multi-domain work:

* orchestrator

Before implementation state:

"Applying expertise: [agent-name]"

---

# MANDATORY DISCOVERY

Before writing any code:

### Step 1

Search for existing implementation.

Questions:

* Does this already exist?
* Can it be reused?
* Can it be extended?

Never create duplicate logic.

---

### Step 2

Identify affected areas.

Examples:

* Services
* Database
* UI
* API
* Reports
* Permissions
* Workflows

---

### Step 3

Estimate risk.

Low
Medium
High

---

# BUSINESS LOGIC PROTECTION

Critical systems must never be modified blindly.

Protected Areas:

* Financial calculations
* Doctor balances
* Supplier balances
* Inventory calculations
* Order workflow
* Production workflow
* Payment workflow
* Audit logs
* Permissions
* Reporting calculations

Before modifying any protected area:

1. Explain current behavior.
2. Explain proposed change.
3. List affected modules.
4. Identify risks.
5. Define rollback approach.

No implementation until impact is understood.

---

# DATABASE SAFETY RULES

Database integrity has highest priority.

Never:

* Drop tables
* Drop columns
* Rename columns
* Remove enums
* Remove statuses
* Remove relationships

Unless explicitly approved.

Preferred strategy:

Additive migrations only.

Examples:

GOOD:

* Add column
* Add table
* Add status
* Add function

BAD:

* Remove existing structures
* Break compatibility

---

# WORKFLOW SAFETY RULES

Before changing any workflow:

1. Document current workflow.
2. Document desired workflow.
3. Identify all affected states.
4. Verify backward compatibility.

Never break existing status transitions.

Always preserve historical records.

Always preserve audit trails.

---

# ERP-SPECIFIC RULES

For ERP systems:

Assume every change may affect:

* Orders
* Finance
* Inventory
* Users
* Reports

Verify dependencies before implementation.

Never assume a field is unused.

Search first.

Confirm usage first.

Then modify.

---

# IMPLEMENTATION RULES

Code must be:

* Simple
* Readable
* Maintainable
* Testable

Avoid:

* Unnecessary abstractions
* Duplicate code
* Premature optimization

Prefer:

* Existing patterns
* Existing services
* Existing architecture

---

# CHANGE SIZE RULE

Small change:

* Implement directly.

Medium change:

* Explain plan briefly.
* Then implement.

Large change:

Create implementation plan first.

Include:

* Scope
* Risks
* Affected files
* Validation steps

Then implement.

---

# VALIDATION RULES

After implementation verify:

### Functional

* Feature works
* Bug fixed

### Regression

* Existing functionality unaffected

### Database

* No data loss

### Permissions

* Access rules preserved

### Workflow

* Existing transitions still work

---

# TESTING RULES

Minimum requirement:

1. Test happy path.
2. Test edge cases.
3. Test regression impact.

For workflow changes:

Test:

* Start state
* Intermediate states
* Final states
* Invalid transitions

---

# RESPONSE FORMAT

For implementation tasks:

1. Understanding
2. Findings
3. Risks
4. Plan
5. Implementation
6. Validation

Keep responses concise.

Focus on facts.

Avoid unnecessary explanations.

---

# GOLDEN RULE

Before creating anything new:

Search.

Understand.

Reuse.

Extend.

Only create new code when no suitable solution already exists.

Protect business logic at all costs.
