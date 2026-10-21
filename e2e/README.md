# Exploratory browser testing

This directory is reserved for Playwright exploratory tests. The shared Playwright configuration starts or reuses the Next.js frontend, targets Chromium, and retains screenshots and traces when a test fails.

## Authentication and test data

- Use a dedicated Clerk development-instance test account. Do not use a personal or production account.
- Keep any authenticated storage state under `e2e/.auth/`; that directory is ignored by Git.
- Use disposable schedule records with clearly identifiable names such as `PW exploratory <date>`. Cancel or remove them after a session when the product flow allows it.
- Do not place Clerk secrets, API keys, or storage state in this directory.

The project currently has no Playwright auth bootstrap because the repository does not provide a safe test account or a confirmed Clerk development environment. Configure those credentials manually before adding authenticated flows.
