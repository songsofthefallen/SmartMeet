This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Local development

The Next.js TypeScript app remains at the repository root. FastAPI lives in `backend/`.

1. Copy `.env.example` to `.env.local` and keep `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`. This public value is only the API address; do not put secrets in `NEXT_PUBLIC_*` variables.
2. In terminal one, run `npm ci` to install from the existing lockfile, then `npm run dev`. The frontend is at [http://localhost:3000](http://localhost:3000).
3. In terminal two, create and activate a Python virtual environment, install backend requirements, then start the API:

   ```powershell
   cd backend
   py -m venv .venv
   .venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   Copy-Item .env.example .env
   python -m uvicorn main:app --reload --port 8000
   ```

   The API is at [http://localhost:8000](http://localhost:8000); `GET /health` returns `{"status":"ok"}`. `FRONTEND_ORIGINS` is a comma-separated allowlist and defaults to `http://localhost:3000`.
4. Run backend tests from `backend/` with `python -m pytest`.

The home page reports whether the backend health endpoint is checking, connected, or unavailable. The request times out after five seconds. To use another API address, change `NEXT_PUBLIC_API_BASE_URL` in `.env.local` and restart Next.js.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
