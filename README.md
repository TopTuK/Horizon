<p align="center">
  <img src="docs/horizon-logo.png" alt="Horizon" width="480">
</p>

# Horizon

Horizon is a smart Gantt chart for roadmap planning. Staff named resource pools (a developer pool and a testing pool to start, add as many as you need), lay the year's work on the chart, and see whether the plan fits the people you have and the days they actually work.

An estimated activity keeps running until the hours you assign cover its estimate. A fixed-date activity stays on the start and end you set. Weekends are off unless you mark a holiday or a working weekend, and those days change the capacity every assignment draws from. The chart footer shows how hard each pool is loaded each month. Statistics show utilization across the year and the activities that still need people. Distribution histograms show how each pool and each person's time is split by month and activity. Any activity can open a burndown of remaining hours against an even burn.

Plans belong to an account. Sign in and every plan you make is kept on the server and opens on any device; keep as many as you like and switch between them from the header. A plan saves by itself shortly after each change. Export and import as JSON still work.

## Sign in and plans

The landing page is open to everyone; the planner is for signed-in users. Sign in with your organization's OpenID Connect account, with Yandex or with Google: the buttons a server shows are the ones it has credentials for.

![Landing page with sign-in](docs/screenshots/landing.png)

Once signed in, the same page lists your plans.

![The plans of a signed-in user](docs/screenshots/plans.png)

- **My plans** lists your plans, the one changed last on top. Open one, rename it, duplicate it or delete it.
- **New plan** starts from the default pools and calendar. **Import JSON** makes a plan from an exported file.
- In the planner, the header shows the plan's name (click to rename), a switcher to your other plans, and whether the latest changes are saved.
- A plan is saved shortly after each change, and at once when the tab is hidden or you leave the page.
- If a plan was changed in another tab or on another device, your edits are kept on the page and a banner asks whether to keep them or reload.
- A browser that still holds a plan from the time Horizon kept plans locally offers to save it to your account after the first sign-in.

Plans are private to their owner.

## Resource pools

Every pool is a named list of people; by default a Developer Pool with 8 developers and a Testing Pool with 4 testers. Each person has their own efficient hours per day (6 by default), and one business-days-per-year setting applies to every pool. Vacations and absences, entered per person as date ranges, remove those working days from that person's capacity and from the hours their assignments book.

Assign people to activities by dragging them onto a month in the chart or from the activity editor. Each assignment is a date range with a quota in % of FTE: the share of the person's efficient daily hours spent on the activity (100% = full time, 50% = half a day). One person can work on several activities in parallel, each with its own quota, and can have several ranges on one activity to change the quota over time. Ranges start and end on any working day. For an estimated activity you enter an estimate per pool, and the completion day follows from the assignments ("until done" ranges stop when the estimate is covered). For a fixed-date activity you set the start and end, and the end always falls on a working day. Load is checked day by day: when anyone's quotas on a working day add up to more than 1 FTE (their own efficient hours per day), a warning above the chart lists who, when, by how much, and which activities overlap.

![Development and testing resource pools](docs/screenshots/resource-pool.png)

## Smart Gantt

Swimlanes group activities. Estimated activities run until their hours are covered; fixed-date activities keep the span you set. The footer shows how many people each month uses, and the red line is today.

![Gantt chart with three projects and monthly load](docs/screenshots/gantt.png)

## Statistics

Year totals, monthly utilization, and activities that still need people.

![Utilization charts and activities missing resources](docs/screenshots/statistics.png)

## Allocation distribution

Each pool and each person in it gets a monthly histogram of booked time as a share of a full workload, stacked by activity in shades of its project's colour. Anything above the red line is over-allocated. Click an activity to hide it in every chart of its pool.

![Distribution histograms for two pools and their people](docs/screenshots/distribution.png)

## Working calendar

Weekends are off by default. Click a day to mark a holiday or a working weekend; that month’s working-day count feeds the plan.

![Working calendar for 2026 with holidays and a working weekend](docs/screenshots/calendar.png)

## Burndown

Each activity can show remaining hours against an even burn, including work still left when the assigned people run out.

![Burndown chart for an estimated activity](docs/screenshots/burndown.png)

## Run

### Docker

Requires Docker with the Compose plugin.

```sh
cp .env.example .env     # fill in the credentials of at least one sign-in provider
docker compose up --build
```

The app is served at http://localhost:8080. For a quick look without a provider, start the stack with the test sign-in instead and use **Sign in as test user** on the landing page:

```sh
docker compose -f docker-compose.yml -f docker-compose.test.yml up --build
```

| URL | |
| --- | --- |
| App | http://localhost:8080 |
| API docs | http://localhost:8080/api/docs |
| Health | http://localhost:8080/health |

The test sign-in is for local checks only. It is off by default, and production refuses to start with it on.

### Local development

Run the database in Docker and the two processes by hand.

```sh
docker compose up -d db                                   # PostgreSQL on localhost:5432
cd backend
python -m venv .venv
.venv\Scripts\activate                                    # or: source .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

In a second terminal:

```sh
cd frontend
npm install
npm run dev
```

The Vite dev server (http://localhost:5173) forwards `/api` and `/auth` to the API on port 8000, so everything stays same-origin and the session cookie works as in production. To sign in through a real provider from there, set `BASE_URL=http://localhost:5173` in `.env` and register `http://localhost:5173/auth/signin-…` with the provider as well.

Settings come from environment variables and from the repository-root `.env`; see [.env.example](.env.example) for all of them.

## Project layout

```
Horizon/
├── frontend/                Vue 3 app
│   ├── src/views/           HomeView (landing page, plans), PlannerView (the planner)
│   ├── src/components/      Board sections, header, dialogs
│   ├── src/stores/          planner (the open plan and its saving), plans, auth
│   ├── src/services/api.js  Calls to the API
│   ├── src/router/          / and /plan/:id (sign-in required)
│   └── src/lib/             Planning calculations, the plan document format
├── backend/                 FastAPI
│   ├── app/api/routes/      auth.py, plans.py
│   ├── app/core/            Settings, database, session, OAuth clients
│   ├── app/models/          User, Plan
│   ├── app/main.py          The app; serves the built SPA in production
│   ├── alembic/             Migrations
│   └── tests/               pytest
├── Dockerfile               Builds the frontend, then the image that runs the API and serves it
└── docker-compose*.yml
```

## Testing

The backend tests need a PostgreSQL database they may erase:

```sh
cd backend
pip install -r requirements-dev.txt
export TEST_DATABASE_URL=postgresql+asyncpg://horizon:horizon@localhost:5432/horizon_test   # the default
pytest
```

With the Compose database, create that database once: `docker compose exec db createdb -U horizon horizon_test`.

```sh
cd frontend
npm run test:unit        # stores, router and pages
```

## Deployment

Production is one container next to PostgreSQL, behind the shared nginx-proxy. See [deployment.md](deployment.md).

## License

[MIT](LICENSE)
