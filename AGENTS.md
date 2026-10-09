# Deadline Notifier — Agent Instructions

## Purpose
These instructions govern AI-assisted development of Deadline Notifier.

## Read Before Implementation
Read these files in order:
1. `context/project-overview.md`
2. `context/architecture-context.md`
3. `context/ai-workflow-rules.md`
4. `context/ui-context.md` when changing UI
5. `context/code-standards.md`
6. `context/decisions.md` when a design choice is involved
7. `context/progress-tracker.md`

## Workflow
- Work on one small, verifiable feature at a time.
- Do not implement requirements that are not defined. Record ambiguity as an open question in `context/progress-tracker.md`.
- Keep AI interpretation separate from deterministic business logic.
- Validate all user input and all external API responses.
- Never expose API keys or secrets in frontend code, logs, committed files, or generated examples.
- Do not claim a feature is complete until it has been implemented and tested.
- Update the relevant context file when scope, architecture, standards, or a major decision changes.
- Update `context/progress-tracker.md` after each meaningful implementation change.
- Keep progress factual; distinguish implemented, tested, planned, and blocked work.

## Implementation Principles
- Prefer simple, maintainable solutions over premature abstraction.
- Keep route handlers thin; move reusable business logic into services.
- Add a repository/data-access layer where it helps isolate persistence.
- Use automated tests for date/time parsing, schedule calculations, validation, and failure cases.
- Read installed framework/library documentation when using version-sensitive APIs.
