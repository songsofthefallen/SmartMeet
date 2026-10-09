# Spec 01 — Local Application Foundation and Health Check

## Goal

Create the smallest working local foundation for Deadline Notifier: the Next.js frontend starts, the FastAPI backend starts, and the frontend can check whether the backend is reachable.

This is an infrastructure checkpoint, not the first product feature. When this spec is complete, there should be a repeatable way to run both applications locally and verify that they communicate.

## Read First

Before editing code, read these files in order:

1. `AGENTS.md`
2. `context/project-overview.md`
3. `context/architecture-context.md`
4. `context/ai-workflow-rules.md`
5. `context/code-standards.md`
6. `context/decisions.md`
7. `context/progress-tracker.md`

Treat the context files as the project source of truth. If a conflict or missing requirement affects this spec, do not guess. Record it in `context/progress-tracker.md` and explain the blocker.

## Inspect the Existing Repository First

1. Inspect the current directory tree, package files, Python files, environment files, and Git status if Git is initialized.
2. Determine whether the Next.js app already exists at the repository root or in a `frontend/` directory.
3. Preserve existing work. Do not rerun `create-next-app`, overwrite configuration, move the existing app, or delete files just to match a preferred folder layout.
4. If a Next.js app already exists at the root, keep it there and add the backend in `backend/`.
5. If the repository is genuinely empty or already uses a `frontend/` + `backend/` layout, use that existing or appropriate layout and document it.
6. Report the detected layout briefly before making structural changes.

## Scope

### Included

- A runnable Next.js frontend using the repository's existing TypeScript setup.
- A runnable Python/FastAPI backend.
- A simple backend health endpoint.
- A small frontend status area that checks the backend health endpoint and displays loading, reachable, and unreachable states.
- Local CORS configuration sufficient for the local frontend origin.
- Safe example environment files and clear local setup instructions.
- Basic automated tests for the health endpoint.
- Updating the progress tracker with factual results.

### Explicitly Excluded

Do not implement any of the following in this spec:

- Clerk authentication or protected routes.
- MySQL tables, SQLAlchemy models, migrations, or database connections.
- AI/LLM calls, prompt extraction, or schedule validation.
- Arrival/departure calculations.
- TomTom, Open-Meteo, geocoding, traffic, or weather integration.
- Web Push, service workers, background jobs, or reminder scheduling.
- A complete dashboard, schedule form, or final visual design.
- Docker, deployment, or production infrastructure unless the existing project already requires it to run.
- New UI libraries or a design system merely for this status indicator.

These are separate future specs. Do not mark any of them as implemented.

## Implementation Requirements

### 1. Frontend

- Keep the existing Next.js app and its conventions. Use TypeScript.
- Add a minimal development/status view to an appropriate existing page. Do not redesign the whole page.
- On page load, request the backend health endpoint using a configurable base URL, such as `NEXT_PUBLIC_API_BASE_URL`.
- Use a safe local default only if the project convention supports it; document the expected value in `.env.example` or the README.
- Display three clear states:
  - `Checking backend…` while the request is pending.
  - `Backend connected` when the response is successful and valid.
  - `Backend unavailable` when the request fails, times out, or returns an unsuccessful response.
- Avoid an unhandled rejected promise. Keep the UI usable if the backend is stopped.
- Do not put private API keys or secrets in `NEXT_PUBLIC_*` variables. This spec needs no secrets.
- If the page uses client-side fetching, isolate that behavior in the smallest appropriate client component rather than turning the entire app into a client component without need.

### 2. Backend

- Create or extend the FastAPI app in `backend/` unless the repository already has an established backend location.
- Provide `GET /health` returning a small JSON response such as `{"status": "ok"}`.
- Keep the endpoint independent of MySQL, Clerk, AI providers, and external APIs.
- Configure CORS for the local frontend origin through configuration/environment variables where practical. Do not allow arbitrary origins by default just to hide a configuration problem.
- Return a clear, predictable response and avoid leaking environment variables or internal details.
- Add a basic automated test for `GET /health`.

### 3. Python Environment and Dependencies

- Inspect the repository for an existing Python environment/dependency manager before choosing one.
- If none exists, choose a simple, conventional setup and document it (for example, a virtual environment plus `requirements.txt`).
- Pin or constrain only what is appropriate for the existing project. Do not add unnecessary packages.
- Do not commit virtual environments, cache directories, or real `.env` files.
- Include `.env.example` files only where configuration is needed; examples must contain placeholders or local non-secret values, never real credentials.

### 4. Configuration and Documentation

- Document how to run the frontend and backend in two terminals.
- Document required environment variables and their purpose.
- Include the expected local frontend and backend URLs.
- Document how to run the backend test.
- Add or update `.gitignore` for Python virtual environments, Python caches, local environment files, and other generated artifacts without removing existing useful ignore rules.
- Do not replace an existing README wholesale. Add or update only the relevant setup section.

### 5. Code Quality

- Follow the existing code style and the rules in `context/code-standards.md`.
- Keep the health route simple; do not introduce unnecessary service/repository layers for a static health response.
- Handle network failures explicitly in the frontend.
- Do not add `any` to TypeScript types.
- Do not claim the frontend/backend connection works unless it has actually been tested.

## Suggested Verification

Adapt these checks to the repository's package manager and current layout:

1. Install dependencies using the existing lockfile/package manager; do not replace the lockfile unnecessarily.
2. Start FastAPI and confirm `GET /health` returns HTTP 200 and `{"status":"ok"}`.
3. Run the backend test suite and confirm the health test passes.
4. Start Next.js and open the local page.
5. With FastAPI running, confirm the page shows `Backend connected`.
6. Stop FastAPI and refresh the page; confirm the page shows `Backend unavailable` without crashing.
7. Run the frontend lint/type-check/build scripts that already exist, where practical.
8. Check that no secrets or local `.env` files were added to version control.

If a check cannot be run in the current environment, report it as **not verified** rather than implying it passed.

## Definition of Done

This spec is complete only when:

- [ ] The existing frontend is preserved and starts successfully.
- [ ] The FastAPI backend starts successfully.
- [ ] `GET /health` returns the expected JSON response.
- [ ] An automated health endpoint test passes.
- [ ] The frontend visibly handles both reachable and unreachable backend states.
- [ ] Local CORS configuration works for the actual local frontend origin.
- [ ] Setup and test instructions are documented.
- [ ] No unrelated features from the excluded list were implemented.
- [ ] `context/progress-tracker.md` accurately records what was implemented, what was tested, what was not tested, and what comes next.
- [ ] Any unresolved decisions or blockers are recorded in the tracker.

## Required Final Report

When finished, provide a concise report with:

1. **Files changed** — list the important files and why they changed.
2. **What works** — describe only behavior that was implemented.
3. **Verification** — list commands/checks run and their actual outcomes.
4. **Not verified / blocked** — state anything that could not be tested and why.
5. **Progress tracker** — summarize the tracker changes.
6. **Next step** — recommend the next small spec without implementing it.

Do not start the next spec in this run.
