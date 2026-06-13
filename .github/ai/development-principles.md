# Development Principles

These are generic defaults. They are overridden by a repo-specific
`.github/ai/development-principles.md` and by the project's own
`AGENTS.md` / `CLAUDE.md` / `CONTEXT.md` and ADRs, which always take precedence.

### 1. Match the Codebase Before Adding to It
*   **Mindset:** Consistency beats cleverness. Duplicate abstractions and bespoke conventions create technical debt and cognitive load.
*   **Execution:** Before writing code, find the nearest existing example (sibling handler, controller, endpoint, component, test) and mirror its structure, naming, error handling, and test style. Reuse existing helpers, clients, and patterns instead of inventing new ones. Put code in the layer the surrounding architecture expects.

### 2. Honor Recorded Decisions
*   **Mindset:** Development principles and implement prompts are top-tier constraints. Issues are the concrete implementation contract. PRDs provide broader context and should be linked, not embedded, when they are large.
*   **Execution:** Implement exactly what the issue decided (the chosen layer, interface, query shape, auth, naming). Use the linked PRD when needed for broader context. If the issue meaningfully conflicts with the PRD, follow the issue and report the mismatch. Do not silently substitute a different approach. If a decision looks wrong or unworkable, stop and report it rather than quietly deviating.

### 3. Robust Boundary Validation
*   **Mindset:** Never assume inputs from external systems, users, or persistence layers are well-formed.
*   **Execution:** Validate request payloads, query arguments, and configuration at entrypoints. Handle empty, null, and unexpected values explicitly. Throw clear, action-oriented errors; never swallow them.

### 4. Test Behavior, Not Implementation
*   **Mindset:** Tests should describe what the system does, through its public interface, so they survive refactors.
*   **Execution:** Write integration-style tests against public APIs. Do not mock internal collaborators or assert on private methods. Build tests incrementally (one behavior at a time), not in bulk up front.

### 5. Defensive UI (frontend work only)
*   **Mindset:** Layouts and dynamic text must handle extreme variations without breaking.
*   **Execution:** Account for loading, empty, error, and overflow states, and screen responsiveness. (Ignore this principle for backend/library tasks.)
