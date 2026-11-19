<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# NEXTGEN – Vehicle Service and Repair Management System

Driving Excellence Through Smart Vehicle Care.

NEXTGEN provides six workshop modules: Customer Management, Vehicle Management, Service & Repair Management, AI Fault Diagnosis, AI Smart Workshop, and Workshop Floor Live. The active application uses MySQL via `mysql2`; it does not use SQLite or Drizzle.

## Run locally

**Prerequisites:** Node.js 22.5 or later and MySQL 8.0 or later.

1. Create a local MySQL database, for example:

   ```sql
   CREATE DATABASE nextgen_workshop_db
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

2. Copy `.env.example` to `.env` if you do not already have one, then set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE` to your local MySQL connection. Keep credentials and `NEXTGEN_JWT_SECRET` private; do not commit `.env`.
3. Generate a persistent signing key using `node -e "console.log(require('node:crypto').randomBytes(64).toString('base64'))"` and set it as `NEXTGEN_JWT_SECRET`. Changing it invalidates issued JWTs.
4. Install dependencies with `npm install`.
5. Start the app and API with `npm run dev`, then open `http://localhost:3000`.

On startup, the server applies pending versioned MySQL migrations and records them in `schema_migrations`. The initial schema is in `server/schema.sql`; the AI diagnosis table is added by `server/migrations/002_ai_diagnoses.sql`, and the Smart Workshop additions by `server/migrations/003_smart_workshop.sql`, including for databases that already applied the initial schema. Applied migrations are not recreated or cleared on later starts. The project does not include a data-import utility; the MySQL schema remains available as raw SQL files.

## Accounts and data

Create the first account from **Get started**. Registration creates a workshop and its owner account. Passwords continue to use the existing salted scrypt hashes. Login and registration issue a 15-minute HS256 JWT access token and a rotating refresh token that expires after 7 days (with a 30-day absolute session lifetime). Tokens are stored only in `HttpOnly`, `SameSite=Lax` cookies; `Secure` is added in production. A readable double-submit CSRF cookie and `X-CSRF-TOKEN` header protect state-changing requests.

The MySQL schema includes JWT session and token-revocation tables. Expired and revoked token identifiers remain available for persistent revocation. Registration creates only `owner` accounts; never accept a role selected by a public registration form.

Backend permissions use the existing roles: `owner`, `manager`, and `advisor` can manage customer, vehicle, and repair records; `technician` can read only assigned jobs and vehicles, update permitted job statuses, and record repair activity. Technician assignments are matched to the existing `assigned_technician` field by staff name or user ID. Workshop rows are always restricted to the signed-in user’s workshop, and roles are read from the database for each request.

## Customer management

The customer module uses the MySQL `customers` table. Customer codes and profile fields are part of the versioned MySQL schema.

The module stores full name in the existing `display_name` column and keeps `phone` and `email` synchronized for existing vehicle/workshop code. It adds `customer_code`, `address`, `gender`, and `phone_normalized`. Customer codes and normalized phone/email values are unique per workshop. Email is optional. Phone and email duplicate checks happen before writes and return the matching existing customer records; names alone are not used to merge records. Customer reads, registration, and updates require an authenticated `owner`, `manager`, or `advisor`; `technician` requests are denied by the API.

- `GET /api/customers?limit=25&offset=0&sort=created_at&order=desc&q=...` — paginated, searchable, sortable records and counts
- `GET /api/customers/search?q=...` — customer lookup by code/ID, name, phone, or email
- `GET /api/customers/:id` — customer profile
- `POST /api/customers` — register a customer; duplicate contact details return `409` with `matches`
- `PUT /api/customers/:id` — update profile details while preserving ID and registration date

All endpoints use the existing JWT cookies, CSRF validation, workshop scoping, and role checks. Customer profiles reserve space for future vehicle and service-history integrations; this module does not fabricate or add those records.

## Vehicle management

The vehicle module uses the MySQL `vehicles` table and its foreign key to `customers`. The schema includes stable vehicle codes, normalized registration numbers for duplicate detection, and customer/job lookup indexes. Chassis number is stored using the existing `vin` column; engine number uses a nullable column. Repair history remains attached to individual rows in the existing `jobs` table.

Vehicle registration requires a customer ID belonging to the signed-in user's workshop. The UI searches existing customer records and does not create customers. Registration numbers are case-insensitively checked after removing separators, unique per workshop, and duplicate responses include the existing vehicle. One customer may own multiple vehicles. `owner`, `manager`, and `advisor` may list/register/update vehicles; `technician` may only view vehicles connected to jobs assigned to their name or user ID. All vehicle queries are workshop-scoped.

- `GET /api/vehicles?limit=25&offset=0&sort=created_at&order=desc&q=...` — paginated, searchable, sortable vehicles joined to owner details
- `GET /api/vehicles/search?q=...` — lookup by registration, vehicle ID/code, make, model, customer name, or customer phone
- `GET /api/vehicles/:id` — vehicle profile with owner information
- `POST /api/vehicles` — register against an existing `customer_id`; duplicate registration returns `409`
- `PUT /api/vehicles/:id` — update vehicle attributes without changing its customer, ID, or registration date
- `GET /api/customers/:id/vehicles` — list vehicles owned by a customer

Vehicle profiles retain their existing customer relationship, and repair history is available through the service and repair API. Mechanic management, parts, and payment details are not fabricated by the vehicle module.

## Service and repair management

The Service & Repair Management module extends the MySQL `jobs` table and keeps each repair linked to its vehicle and customer. The MySQL schema includes repair fields, status-history, activity-log, and mechanic-assignment tables with workshop-scoped lookup indexes.

Repair jobs use generated job and tracking numbers, a defined status workflow, priority, expected completion date, labour and parts estimates in integer cents, and optional assignment to an existing `technician` user. Customer and vehicle selections must belong to the same workshop, and the vehicle must belong to the selected customer. Status changes and mechanic assignments are recorded with the acting user's identity. Workshop staff (`owner`, `manager`, and `advisor`) can create, edit, assign, and manage jobs. A mechanic can view only jobs assigned to their name or account ID, record work activity, and move assigned work through mechanic-authorized statuses. These permissions are enforced by the API.

- `GET /api/repairs?limit=25&offset=0&q=...&status=...&priority=...&sort=date_received&order=desc` — paginated, searchable repair jobs and status counts
- `GET /api/repairs/search?q=...` — quick search by job/tracking number, customer, vehicle, or mechanic
- `GET /api/repairs/mechanics` — technician accounts available for assignment (workshop staff only)
- `GET /api/repairs/:id` — repair details
- `POST /api/repairs` — create a job for an existing customer and their vehicle
- `PUT /api/repairs/:id` — update service details, estimates, notes, expected date, priority, or assignment
- `PATCH /api/repairs/:id/status` — validate and record a status transition
- `PATCH /api/repairs/:id/assignment` — assign or unassign a mechanic and record the assignment
- `GET /api/repairs/:id/history` and `POST /api/repairs/:id/activities` — view and record internal repair history
- `GET /api/customers/:id/repairs` and `GET /api/vehicles/:id/repairs` — retrieve linked repair history

All repair endpoints use the existing JWT cookies, CSRF checks for writes, and workshop scope. The tracking number is for internal workshop use; no public tracking endpoint is provided. Repair estimates remain separate from payments and do not fabricate parts, service, or payment records.

## AI vehicle fault diagnosis

The mechanic-facing **AI Fault Diagnosis** view runs a separate Python/scikit-learn Random Forest model. Install its dependencies and train the model from the repository root:

```powershell
python -m pip install -r ml/requirements.txt
python ml/diagnosis.py train
```

Training prints a stratified 75/25 holdout evaluation and writes `ml/vehicle_fault_model.joblib`. The generated artifact is ignored by Git, so train it after cloning. The server invokes the Python process for each prediction; set `PYTHON_EXECUTABLE` if the interpreter is not available as `python` on Windows or `python3` on other platforms.

The bundled `ml/data/vehicle_fault_symptoms.csv` contains 48 curated symptom descriptions across six fault categories with OBD-II trouble-code references. These are starter examples mapped to code descriptions, **not verified workshop repair outcomes**. The fixed stratified split (random state 27) produced accuracy 0.667, weighted precision 0.778, weighted recall 0.667, and weighted F1 0.689 on 12 held-out examples. This small, curated-set result is not a measure of real-world diagnostic performance. Confidence values are uncalibrated Random Forest scores, not probabilities that a component has failed. Replace or expand the corpus with mechanic-verified cases before relying on this module operationally, then retrain and evaluate on an independent dataset.

Predictions return up to three fault candidates and inspection suggestions. Mechanics must confirm, correct, or dismiss each result. A confirmed diagnosis can be linked to an existing repair job or used by an authorized workshop role to create a repair through the existing `POST /api/repairs` endpoint; the API verifies the diagnosis belongs to the same customer and vehicle and is reviewed before linking. Diagnosis rows are stored in the additive `ai_diagnoses` table with workshop/customer/vehicle IDs, prediction scores, review status, mechanic notes, and an optional job ID.

- `POST /api/diagnoses/predict` — run model prediction for a vehicle and symptom text; technicians are limited to vehicles with their assigned jobs
- `GET /api/vehicles/:vehicleId/diagnoses` — list diagnosis history for an accessible vehicle
- `PATCH /api/diagnoses/:id/review` — save a mechanic confirmation, correction, dismissal, notes, or related existing job
- `POST /api/repairs` accepts optional `diagnosis_id` when creating a job from a confirmed diagnosis

These routes require the existing staff JWT, CSRF protection for writes, workshop scoping, and role/assignment checks. The Python process only predicts; the Node API validates access and owns all database writes.

## AI Smart Workshop

The mechanic-facing **AI Smart Workshop** adds an interactive 3D inspection view on top of the existing vehicle, repair, and AI diagnosis data. It reuses the trained classifier from [AI vehicle fault diagnosis](#ai-vehicle-fault-diagnosis); it does not add a second AI system or a second database.

### Setup and 3D assets

The 3D viewer uses `three`, `@react-three/fiber`, and `@react-three/drei`, loaded through a lazy/dynamic import so the rest of the application does not download Three.js. The exterior body is a local Draco-compressed GLB in `public/assets/models/`, served from `/assets/models/ferrari.glb`; its Draco decoder is served locally from `public/draco/` at `/draco/`. No model or decoder is fetched from a CDN. License and source details are in `public/assets/models/ATTRIBUTION.md`:

- Ferrari 458 Italia model by `vicent091036`, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Distributed as the three.js example `ferrari.glb` ([source](https://github.com/mrdoob/three.js/issues/23089#issuecomment-1001258942)); original model on [Sketchfab](https://sketchfab.com/3d-models/ferrari-458-italia-57bf6cc56931426e87494f554df1dab6).

The body is a clearly labelled **generic licensed illustration**, not an exact replica of every registered make/model. The GLB contains wheel, brake, and steering nodes but no engine, transmission, battery, radiator, cooling, suspension, or exhaust nodes; those internal systems are procedural 3D geometry generated at runtime as an explicitly labelled inspection assembly. The viewer offers exterior/internal modes, orbit/zoom/pan, seven camera presets plus reset, transparent and exploded views, and clickable components with status highlighting.

### Component status rules

Component keys, fault-to-component mapping, and status rules are defined in `shared/smartWorkshop.ts` (`shared/smart_workshop_config.json` is a documentation snapshot). Mechanics' inspections and saved AI predictions are combined with priority `red > orange > green > grey`:

- **GREEN** – only after an explicit mechanic `no_fault_found` inspection for that component. Missing data is never treated as healthy.
- **ORANGE** – a check is recommended, e.g. an unreviewed AI prediction or an `inspection_recommended` finding.
- **RED** – a fault was confirmed by a mechanic inspection or a reviewed diagnosis.
- **GREY** – no inspection or prediction data exists for the component.

Only `owner`, `manager`, and `advisor` roles can create a linked repair job from a reviewed prediction. `technician` accounts may inspect vehicles attached to jobs assigned to them and record inspections/reviews for those vehicles. The customer portal does not expose these internal tools.

### Vehicle context and AI limitations

`POST /api/diagnoses/predict` accepts `vehicle_id`, `symptoms`, optional `job_id`, and optional `include_context`. When enabled, only DTC codes extracted from existing workshop repair notes are appended to the classifier input; make, model, mileage, and history are stored with the prediction for context but are **not** fed to the symptom classifier because no labelled dataset exists for them. Each suggestion is saved with its affected component, possible causes, inspection recommendations, model version, and provenance, and must be confirmed, corrected, or dismissed by a mechanic. Confidence values remain uncalibrated model scores, not real-world failure probabilities.

### Endpoints

- `GET /api/smart-workshop/config` — component keys, labels, descriptions, and inspection focus points
- `GET /api/smart-workshop/vehicles/:vehicleId` — vehicle, derived statuses, inspections, diagnoses, recent repairs, and config for the 3D view
- `GET /api/vehicles/:vehicleId/component-inspections` — list recorded mechanic inspections
- `POST /api/vehicles/:vehicleId/component-inspections` — record an inspection (`component_name`, `condition_status`, `inspection_notes`, `inspection_date`, optional `job_id`)

Inspection conditions are `no_fault_found`, `inspection_recommended`, `possible_fault`, and `fault_confirmed`. The additive migration `server/migrations/003_smart_workshop.sql` adds nullable AI-prediction columns to `ai_diagnoses` and creates `vehicle_component_inspections`; it is applied automatically on startup like the earlier migrations. All routes use the existing staff JWT cookies, CSRF checks for writes, workshop scoping, and role/assignment checks.

## Workshop Floor Live dashboard

The authenticated dashboard reads live repair and vehicle data from the MySQL `jobs`, `vehicles`, and `customers` tables, along with mechanic assignments and repair status/activity history. It introduces no placeholder workshop records. `owner`, `manager`, and `advisor` users see workshop jobs; `technician` users see only jobs assigned to their name or account ID, with customer phone and email omitted from the response.

The dashboard refreshes its data every 10 seconds and provides a manual refresh, connection state, last-updated time, workflow summary cards, searchable and filterable active repair cards, mechanic workload calculated from existing assignments, alerts, recent repair activity, and the 12 most recent customer and vehicle registrations. The floor board groups the existing repair statuses into Waiting for Inspection, Under Inspection, In Progress, Waiting for Spare Parts, and Completed; `Under Inspection` is a repair status available in Service & Repair Management. Each repair can be assigned a bay there. The bay panel derives known bay names from existing `jobs.bay` values, so it only reports availability for bay names already recorded in repair history. Technician accounts do not receive the general registration list. Collected jobs are excluded from the floor board but remain in repair history. Selecting a job opens its existing Service & Repair detail view.

- `GET /api/workshop/floor` — authenticated workshop floor data, summary, assignments, alerts, and recent activity

To run it locally, follow the existing [Run locally](#run-locally) instructions and sign in with an authorized account. The main **Workshop Floor Live** sidebar item opens the dashboard. The endpoint and repair workflow use the existing Node/Express server and MySQL database; no Flask service, new endpoint, or database table is required.

The API is served by the same server as the web app:

- `GET /api/auth/csrf`
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/refresh`, `POST /api/auth/logout`
- `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id`, `DELETE /api/users/:id` — protected staff-account operations retained for mechanic assignment
- Customer endpoints are listed in [Customer management](#customer-management).
- Vehicle endpoints are listed in [Vehicle management](#vehicle-management).
- Repair endpoints are listed in [Service and repair management](#service-and-repair-management).
- AI diagnosis setup and endpoints are listed in [AI vehicle fault diagnosis](#ai-vehicle-fault-diagnosis).
- 3D setup, asset attribution, status rules, and endpoints are listed in [AI Smart Workshop](#ai-smart-workshop).

All operational endpoints require a valid access JWT and scope records to that user's workshop. Legacy parts and payment tables remain in the database, but their removed modules and CRUD APIs are not exposed. The frontend refreshes an expired access token once and returns to sign-in if the refresh token has expired or been revoked. Login, registration, and refresh are rate-limited. List endpoints accept `limit` (1–200) and `offset`; related records are protected by database foreign keys.

Build the frontend with `npm run build`; run the production server with `npm run start` after setting `NODE_ENV=production` and configuring HTTPS at the reverse proxy. The server requires `NEXTGEN_JWT_SECRET` and exits with an explicit error if it is missing or shorter than 32 bytes. No JWT signing key or auth token is exposed to frontend JavaScript.
