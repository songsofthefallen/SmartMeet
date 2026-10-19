# Deadline Notifier

Deadline Notifier is a web application that helps users plan when to leave and when to wake up for an event. Users can describe their plans in natural language, select their origin and destination, estimate travel time using traffic data, and calculate suggested departure and preparation times. Weather forecasts can add extra travel time when necessary.

## Tech Stack

- **Frontend:** Next.js, React, TypeScript
- **Backend:** Python, FastAPI
- **Database:** MySQL, SQLAlchemy, Alembic
- **Authentication:** Clerk
- **AI schedule extraction:** OpenRouter
- **Location search and routing:** TomTom
- **Weather forecasts:** Open-Meteo

## Requirements

Install the following before running the project:

- Node.js and npm
- Python
- MySQL Server
- Git (if cloning the repository)

Check that Node.js, npm, and Python are installed:

```powershell
node --version
npm --version
py --version
```

## 1. Environment Variables

The project uses two separate environment files. Keep them in their respective locations.

```text
deadline-notifier-app/
├── .env.example
├── .env.local             # Create this for the frontend
├── package.json
├── app/
├── backend/
│   ├── .env.example
│   ├── .env               # Create this for the backend
│   ├── requirements.txt
│   └── main.py
└── context/
```

Do not commit `.env.local` or `backend/.env` to Git. They contain local configuration and potentially private credentials.

### Frontend: `.env.local`

From the repository root, copy the example file:

```powershell
Copy-Item .env.example .env.local
```

Open `.env.local` and configure the required frontend variables:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
```

The Clerk publishable key is intended for frontend use. Never put secret API keys in variables beginning with `NEXT_PUBLIC_`.

### Backend: `backend/.env`

From the repository root, create the backend environment file:

```powershell
Copy-Item backend/.env.example backend/.env
```

Open `backend/.env`. Configure the values required by the backend's existing `.env.example`, including the following settings where applicable:

```dotenv
FRONTEND_ORIGINS=http://localhost:3000

DATABASE_URL=mysql+pymysql://your_user:your_password@localhost:3306/deadline_notifier

CLERK_JWT_KEY=your_clerk_jwt_public_key
CLERK_ISSUER=your_clerk_issuer_url

AI_PROVIDER=openrouter
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=your_openrouter_api_key
AI_MODEL=openrouter/free

TOMTOM_API_KEY=your_tomtom_api_key
```

**Important:** These are example values, not working credentials. Check `backend/.env.example` for the exact variables required by your current implementation. Preserve any additional required settings and existing defaults. Do not replace the Clerk JWT key or issuer with arbitrary values.

If your database password contains reserved URL characters, URL-encode them in `DATABASE_URL`.

## 2. Get Your API Keys

### Clerk — Authentication

Website: https://dashboard.clerk.com/

1. Create a Clerk application.
2. Open its API keys page.
3. Copy the **Publishable Key** into `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in the root `.env.local`.
4. Configure the backend's `CLERK_JWT_KEY` and `CLERK_ISSUER` using the JWT verification configuration for the same Clerk application.

Use Clerk's official documentation to configure the verification key and issuer correctly:

https://clerk.com/docs/guides/development/clerk-environment-variables

The backend JWT verification settings are not interchangeable with the frontend publishable key. Follow the project's existing authentication implementation and Clerk's documentation.

### OpenRouter — AI Schedule Extraction

Website: https://openrouter.ai/

Create an account, then create an API key:

https://openrouter.ai/settings/keys

Configure these variables in `backend/.env`:

```dotenv
AI_PROVIDER=openrouter
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=your_openrouter_api_key
AI_MODEL=openrouter/free
```

The selected model must be available to your account. API usage, model availability, and free-model limits may vary. If requests fail, check your OpenRouter account, key limits, and model availability.

Never expose the OpenRouter API key to the frontend.

### TomTom — Location Search and Routing

Website: https://developer.tomtom.com/

1. Sign in to the TomTom developer portal.
2. Create or configure an application.
3. Obtain an API key with access to the location search and routing services used by the project.
4. Add the key to `TOMTOM_API_KEY` in `backend/.env`.

TomTom is used for location search and route estimates, including traffic information. Keep the key on the backend.

### Open-Meteo — Weather Forecasts

Website: https://open-meteo.com/

The project uses Open-Meteo's forecast API. Its eligible non-commercial free API access does not require an API key.

The backend requests forecast data for the selected trip's origin and destination. If weather information is unavailable for the requested time, the application falls back to its existing calculations without applying an unsupported weather adjustment.

## 3. Set Up the MySQL Database

Start your MySQL server and create a database for the application.

For example, in MySQL:

```sql
CREATE DATABASE deadline_notifier;
```

Configure `DATABASE_URL` in `backend/.env` with a MySQL account that has access to this database.

Example:

```dotenv
DATABASE_URL=mysql+pymysql://your_user:your_password@localhost:3306/deadline_notifier
```

Replace `your_user` and `your_password` with your own MySQL credentials.

The database and its tables are separate things: creating the database does not create the application's tables.

## 4. Install and Run the Backend

Open a VS Code terminal and run these commands from the repository root:

```powershell
cd backend

py -m venv .venv
.venv\Scripts\Activate.ps1

python -m pip install -r requirements.txt

Copy-Item .env.example .env
```

If you already created `backend/.env` and filled in your credentials, **do not overwrite it** with the example file.

Run the database migrations:

```powershell
python -m alembic upgrade head
python -m alembic current
```

Start the FastAPI server:

```powershell
python -m uvicorn main:app --reload --port 8000
```

The backend runs at:

http://localhost:8000

Check the health endpoint:

http://localhost:8000/health

A successful response should look like:

```json
{"status":"ok"}
```

The API documentation is normally available at:

http://localhost:8000/docs

Keep this terminal running.

## 5. Install and Run the Frontend

Open a **second VS Code terminal** at the repository root, not inside `backend/`.

If you have not created `.env.local` yet, run:

```powershell
Copy-Item .env.example .env.local
```

Fill in the frontend environment variables before starting Next.js.

Install dependencies using the existing lockfile:

```powershell
npm ci
```

Start the frontend:

```powershell
npm run dev
```

The frontend runs at:

http://localhost:3000

Keep this terminal running as well.

If you change environment variables, restart the affected development server.

## 6. Verify the Application

After both servers are running:

1. Open http://localhost:3000.
2. Confirm that the frontend can reach the FastAPI health endpoint.
3. Sign up or sign in using Clerk.
4. Open the dashboard and verify that authenticated API requests work.
5. Create a test schedule using natural language.
6. Confirm that schedule extraction, location search, route estimation, and time calculations behave as expected.
7. Check weather information when the selected trip time falls within the supported forecast window.

Some features require valid provider credentials and an available API connection. A successful `/health` response confirms that the API is running; it does not guarantee that MySQL, authentication, or external providers are configured correctly.

## 7. Running Tests

### Reminder worker

The worker runs separately from FastAPI and uses the same `backend/.env` database configuration. From the repository root:

```powershell
cd backend
python -m reminder_worker
```

The worker uses a safe unconfigured delivery handler until a notification provider is added. It will retry a bounded number of times and then mark due reminders failed; it does not send Web Push or claim delivery.

### Backend tests

From the repository root:

```powershell
cd backend
python -m pytest
```

### Frontend checks

From a separate terminal at the repository root, use the scripts defined in `package.json`. Common commands include:

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```

If a script such as `npm test` is not defined in `package.json`, use the project's actual test command instead.

## Troubleshooting

| Problem | What to check |
|---|---|
| Frontend says the backend is unavailable | Confirm FastAPI is running on port 8000 and `NEXT_PUBLIC_API_BASE_URL` is correct. |
| Clerk sign-in or authenticated requests fail | Verify the publishable key, backend JWT verification key, issuer, and allowed frontend origin. |
| MySQL connection fails | Confirm MySQL is running, the database exists, credentials are correct, and migrations have been applied. |
| AI schedule extraction fails | Check `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, and your OpenRouter account limits. |
| Location search or routing fails | Check `TOMTOM_API_KEY` and access to the required TomTom services. |
| Weather forecast is unavailable | Check the requested trip time, provider response, and backend diagnostics. The application may intentionally fall back without a weather buffer. |
| Environment changes have no effect | Confirm you edited the correct environment file and restart the relevant server. |

## Security Notes

- Never commit `.env.local` or `backend/.env`.
- Never put provider secrets in `NEXT_PUBLIC_*` variables.
- Do not share API keys in screenshots, logs, or source control.
- Use separate development and production credentials.
- Configure production environment variables in the deployment platform rather than committing secret files.

## Additional Documentation

- [Next.js Documentation](https://nextjs.org/docs)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)
- [Alembic Documentation](https://alembic.sqlalchemy.org/)
- [Clerk Documentation](https://clerk.com/docs)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- [TomTom Developer Documentation](https://developer.tomtom.com/)
- [Open-Meteo Documentation](https://open-meteo.com/en/docs)
