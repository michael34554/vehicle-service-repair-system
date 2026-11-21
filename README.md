<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# NEXTGEN – Vehicle Service and Repair Management System

Driving Excellence Through Smart Vehicle Care.

NEXTGEN provides eight workshop modules in this standard order: Customer Management, Vehicle Management, Mechanic Management, Service and Repair Management, Spare Parts and Inventory Management, AI Fault Diagnosis, AI Smart Workshop, and Workshop Floor Live. The same order is used in the main sidebar and in the administrator dashboard shortcuts. The active application uses MySQL via `mysql2`; it does not use SQLite or Drizzle.

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

On startup, the server applies pending versioned MySQL migrations and records them in `schema_migrations`: `002_ai_diagnoses.sql`, `003_smart_workshop.sql`, `004_mechanic_management.sql`, `005_smart_workshop_catalogue.sql`, `006_customer_sessions.sql`, and `007_ai_intelligence.sql`. The initial schema is in `server/schema.sql`. Applied migrations are not recreated or cleared on later starts. The project does not include a legacy data-import utility; the MySQL schema remains available as raw SQL files. `scripts/verifySmartWorkshopDb.mjs` checks the catalogue migration and seed read-only.

## Accounts and data

Create the first account from **Get started**. Registration creates a workshop and its owner account. Passwords continue to use the existing salted scrypt hashes. Login and registration issue a 15-minute HS256 JWT access token and a rotating refresh token that expires after 7 days (with a 30-day absolute session lifetime). Tokens are stored only in `HttpOnly`, `SameSite=Lax` cookies; `Secure` is added in production. A readable double-submit CSRF cookie and `X-CSRF-TOKEN` header protect state-changing requests.

Staff JWTs use `jwt_sessions`/`jwt_tokens`; customer JWTs use `customer_sessions`/`customer_jwt_tokens` from migration `006`. Both families persist token identifiers, rotation links, reuse detection, absolute expiry and revocation. Expired and revoked token identifiers remain available for persistent revocation. Registration creates only `owner` accounts; never accept a role selected by a public registration form.

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

## Mechanic management and workspace

The Mechanic Management module extends the existing `technician` account role; it does not introduce a second role or a second repair system. The additive migration `server/migrations/004_mechanic_management.sql` creates mechanic profiles, mechanic-specific columns on the existing assignment/activity tables, and completion submissions. The repair job remains the source of truth for repair status, assignments remain in `repair_mechanic_assignments`, work logs remain in `repair_activity_logs`, and parts are issued only through the existing `repair_issue` stock transaction path.

Owners and managers can register, edit, deactivate, reactivate, reset passwords for, and set the initial availability of mechanics. Deactivated accounts are blocked at login and cannot receive new assignments. `owner`, `manager`, and `advisor` users can review the dashboard, profile/work history, assign or reassign jobs, cancel assignments, set availability, verify completion submissions, and export performance PDF/XLSX reports. Off Duty and On Leave mechanics cannot receive assignments unless the administrator explicitly sets `override_availability`. Available/Busy suggestions are scored from specialization, availability and real active job counts. Technicians see only their assigned repair jobs in the Mechanic Workspace, where they can start work, update progress, record findings/work performed, issue parts, and submit work for verification. Verified submissions move the existing repair job to Ready for Collection; rejected submissions return it to In Progress.

- `GET /api/mechanics/dashboard` — live dashboard counts, workload and recent work logs
- `GET /api/mechanics` — searchable, filterable, paginated mechanic directory
- `POST /api/mechanics` — register a mechanic profile and technician login
- `GET /api/mechanics/recommendations?job_id=...` — assignment suggestions from real workload
- `GET /api/mechanics/:id` — profile, assigned vehicles, repair history, work logs and performance
- `PUT /api/mechanics/:id`, `PATCH /api/mechanics/:id/availability`, `PATCH /api/mechanics/:id/status`, `POST /api/mechanics/:id/password` — profile, availability, activation and login controls
- `GET /api/mechanics/assignable-jobs`, `GET /api/mechanics/assignments`, `POST /api/mechanics/assignments`, `DELETE /api/mechanics/assignments/:id` — assignment workflow and preserved history
- `GET /api/mechanics/:id/assignments`, `GET /api/mechanics/:id/worklogs`, `GET /api/mechanics/jobs/:id/assignments` — mechanic and job history
- `GET /api/mechanics/completions`, `PATCH /api/mechanics/completions/:id/verify` — completion verification
- `GET /api/mechanics/me/summary`, `GET /api/mechanics/me/jobs`, `GET /api/mechanics/me/jobs/:id` — technician workspace
- `POST /api/mechanics/me/jobs/:id/start`, `POST /api/mechanics/me/jobs/:id/progress`, `POST /api/mechanics/me/jobs/:id/activities` — work updates
- `GET /api/mechanics/me/jobs/:id/available-parts`, `GET|POST /api/mechanics/me/jobs/:id/parts` — inventory-integrated parts usage
- `POST /api/mechanics/me/jobs/:id/complete`, `GET /api/mechanics/me/activities` — submission and technician work log
- `GET /api/mechanics/reports/data`, `GET /api/mechanics/reports/:reportType?format=pdf|xlsx` — performance, workload and completion reports

Smart Workshop vehicle context now includes the latest active mechanic assignment, AI diagnosis records appear in the technician job detail, and the customer portal shows the assigned mechanic on repair jobs. All mechanic endpoints use the existing JWT cookies, CSRF checks for writes, workshop scoping and role checks.

## AI vehicle fault diagnosis

The mechanic-facing **AI Fault Diagnosis** view and the **AI Smart Workshop** share one Python/scikit-learn service. There is no second model or second backend. Install its dependencies and train from the repository root:

```powershell
python -m pip install -r ml/requirements.txt
python ml/generate_demo_data.py
python ml/diagnosis.py train
```

`ml/data/vehicle_fault_symptoms.csv` contains 48 curated symptom descriptions across six fault categories with OBD-II trouble-code references. `ml/generate_demo_data.py` expands them into 384 rows in `ml/data/vehicle_fault_training.csv`, every row explicitly labelled `synthetic_demo` and grouped by `example_id`. No failure rates or verified workshop outcomes are invented. Training compares Random Forest, Decision Tree and Naive Bayes on a grouped holdout, fits isotonic confidence calibration on that holdout, then writes `ml/vehicle_fault_model.joblib`, `ml/vehicle_fault_calibration.joblib` and `ml/evaluation.json`. Generated artifacts are ignored by Git, so train after cloning. The server invokes the Python process for each prediction; set `PYTHON_EXECUTABLE` if the interpreter is not available as `python` on Windows or `python3` on other platforms.

Evaluation uses `StratifiedGroupKFold` (four splits, first split, random state 27) grouped by source symptom example, so copies of the same case cannot cross the train/holdout boundary. The recorded synthetic split has 36 train and 12 holdout source examples (288 train rows, 96 test rows) with **zero overlapping source examples**, and the report records calibration plus per-make/model holdout accuracy. These figures come only from demonstration templates and must not be presented as workshop accuracy. Confidence values are calibrated estimates, not verified failure probabilities.

Adaptive learning uses mechanic-reviewed outcomes, not model guesses. `POST /api/diagnoses/:id/review` accepts `confirmed_fault`; a verified repair completion gives the strongest outcome signal. Run `node scripts/exportVerifiedTrainingData.mjs` to export `ml/data/vehicle_fault_verified.csv` and a clearly labelled mixed corpus from confirmed/corrected diagnoses joined to verified repair completions, then retrain with `python ml/diagnosis.py retrain --dataset ml/data/vehicle_fault_training_mixed.csv` or **Retrain from verified outcomes** in the Smart Workshop. Every retrain is recorded in `ai_training_runs` with its dataset, provenance, metrics, initiator and result. The bundled corpus remains synthetic until real verified outcomes are exported; missing VIN/catalogue links are recorded as `null` rather than inferred.

`POST /api/diagnoses/predict` accepts `vehicle_id`, `symptoms`, optional `job_id`, and optional `include_context`. When enabled, the Node API passes structured vehicle context to Python: manufacturer, model, model year, mileage, engine type/capacity, fuel, transmission, drive, inspection findings, previous faults and DTC codes extracted from workshop records. The Python service appends extracted DTC codes to the symptom text once; all other context remains a structured feature and is saved with the prediction. The bundled training context has no validated diagnostic signal, so context support is not evidence of diagnostic accuracy.

Predictions return up to three calibrated candidate scores, inspection suggestions, model version, provenance and data limitations. Mechanics must confirm, correct, or dismiss each result. A confirmed diagnosis can be linked to an existing repair job or used by an authorized workshop role to create a repair through the existing `POST /api/repairs` endpoint; the API verifies the diagnosis belongs to the same customer and vehicle and is reviewed before linking. Diagnosis rows are stored in `ai_diagnoses` with workshop/customer/vehicle IDs, prediction scores, review status, mechanic notes, context JSON, an optional job ID, and optional links to the knowledge-base fault record and catalogue model that informed the prediction.

- `POST /api/diagnoses/predict` — run model prediction for a vehicle and symptom text; technicians are limited to vehicles with their assigned jobs
- `GET /api/vehicles/:vehicleId/diagnoses` — list diagnosis history for an accessible vehicle
- `PATCH /api/diagnoses/:id/review` — save a mechanic confirmation, correction, dismissal, notes, or related existing job
- `POST /api/repairs` accepts optional `diagnosis_id` when creating a job from a confirmed diagnosis
- `POST /api/ai/retrain` and `GET /api/ai/training-runs` — staff-only retraining and audit trail

These routes require the existing staff JWT, CSRF protection for writes, workshop scoping, and role/assignment checks. The Python process only trains and predicts; the Node API validates access and owns all database writes.

## AI Smart Workshop

The mechanic-facing **AI Smart Workshop** adds an interactive 3D inspection view on top of the existing vehicle, repair, and AI diagnosis data. It reuses the trained classifier from [AI vehicle fault diagnosis](#ai-vehicle-fault-diagnosis); it does not add a second AI system or a second database.

### Setup and 3D assets

The 3D viewer uses `three`, `@react-three/fiber`, and `@react-three/drei`, loaded through a lazy/dynamic import so the rest of the application does not download Three.js. The selected catalogue model's registered GLB path is passed to the viewer. When no exact licensed asset exists, the fallback is the local Draco-compressed `public/assets/models/ferrari.glb`; its Draco decoder is served locally from `public/draco/` at `/draco/`. No model or decoder is fetched from a CDN. License and source details are in `public/assets/models/ATTRIBUTION.md`:

- Ferrari 458 Italia model by `vicent091036`, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Distributed as the three.js example `ferrari.glb` ([source](https://github.com/mrdoob/three.js/issues/23089#issuecomment-1001258942)); original model on [Sketchfab](https://sketchfab.com/3d-models/ferrari-458-italia-57bf6cc56931426e87494f554df1dab6).

The bundled body is a clearly labelled **representative licensed substitute**, not an exact replica of the registered make/model. The GLB contains wheel, brake, and steering nodes but no engine, transmission, battery, radiator, cooling, suspension, or exhaust nodes; those internal systems are procedural 3D geometry generated at runtime as an explicitly labelled inspection assembly. Only exact named nodes in the asset's stored `node_map` are clickable. The viewer offers exterior, interior, mechanical and exploded views, orbit/zoom/pan, seven camera presets plus reset, a selected-component emphasis toggle, labels, loading/error fallbacks, and clickable components with status highlighting.

Additional model-specific and interior asset candidates are recorded in [`3d-asset-candidates.md`](3d-asset-candidates.md). They are **proposals only**: no candidate is downloaded, registered, or linked until approved. Local GLB node names and bounds can be inspected read-only with `node scripts/inspectGltfAssets.mjs [file.glb]`; keyword suggestions from that script are not approved component mappings. Migration `007` adds `vehicle_component_node_maps` so a proposed node name can be marked `verified` by a named reviewer. The Smart Workshop API exposes asset validation, node-map read/write and verification endpoints; `exact_match_claim` remains false for the bundled representative Ferrari asset until an exact licensed asset is supplied.

### Component status rules

Component keys, fault-to-component mapping, and status rules are defined in `shared/smartWorkshop.ts` (`shared/smart_workshop_config.json` is a documentation snapshot). Mechanics' inspections and saved AI predictions are combined with priority `red > orange > green > grey`:

- **GREEN** – only after an explicit mechanic `no_fault_found` inspection for that component. Missing data is never treated as healthy.
- **ORANGE** – a check is recommended, e.g. an unreviewed AI prediction or an `inspection_recommended` finding.
- **RED** – a fault was confirmed by a mechanic inspection or a reviewed diagnosis.
- **GREY** – no inspection or prediction data exists for the component.

Only `owner`, `manager`, and `advisor` roles can create a linked repair job from a reviewed prediction. `technician` accounts may inspect vehicles attached to jobs assigned to them and record inspections/reviews for those vehicles. The customer portal does not expose these internal tools.

### Vehicle integration, catalogue and knowledge base

The Smart Workshop searches existing registered vehicles by registration number or customer name, then loads the registered make/model/year, workshop history, inspections, AI assessments and any matched catalogue model. It never creates a duplicate vehicle. Missing engine, capacity, fuel, transmission and drive details are reported as **Not recorded**; they are not inferred. Vehicle-record values take precedence over catalogue values, and catalogue values are only used when their verification status is not `not_recorded`.

The three Common Problems panels are deliberately separated: **known possible fault categories** from the reference knowledge base (each with provenance), **historically recorded faults in NEXTGEN** from this vehicle's workshop records, and **AI-predicted faults for this vehicle** from saved model suggestions. They are not interchangeable, and the interface states that AI output is not a confirmed diagnosis.

Migration `server/migrations/005_smart_workshop_catalogue.sql` adds additive global catalogue, specification, mechanical-system, component, fault-record and 3D-asset tables plus nullable specification/link columns on `vehicles`. The idempotent seed `server/smartWorkshopSeed.ts` loads 10 manufacturers, 42 models, 12 systems, 17 components, 22 explicitly sourced/synthetic fault records and one generic licensed asset. Registered vehicles remain the workshop source of truth. `scripts/verifySmartWorkshopDb.mjs` checks the migration and seed state read-only.

Only `owner` and `manager` accounts can change the shared catalogue. Administrators can add manufacturers, models, 3D assets, specifications and fault records from the Smart Workshop administration panel or the matching APIs. Every fault record stores provenance and fidelity notes; synthetic records are labelled and are never presented as verified workshop outcomes. No failure statistics are generated from synthetic rows.

### Endpoints

- `GET /api/smart-workshop/config` — component keys, labels, descriptions, and inspection focus points
- `GET /api/smart-workshop/vehicles/:vehicleId` — vehicle, catalogue model/asset, specifications, derived statuses, inspections, diagnoses, recent repairs and config for the 3D view
- `GET /api/vehicles/:vehicleId/component-inspections` — list recorded mechanic inspections
- `POST /api/vehicles/:vehicleId/component-inspections` — record an inspection (`component_name`, `condition_status`, `inspection_notes`, `inspection_date`, optional `job_id`)
- `GET /api/smart-workshop/ai-model` — recorded evaluation metadata and model-comparison metrics from `ml/evaluation.json`
- `GET /api/smart-workshop/3d-assets` — registered GLB assets, license/source and generic/exact flags
- `GET /api/smart-workshop/manufacturers` — active manufacturers and model counts
- `GET /api/smart-workshop/manufacturers/:id/models` — models for one manufacturer
- `GET /api/smart-workshop/models/:id` — model, asset, specifications and system/component coverage
- `GET /api/smart-workshop/models/:id/specifications`, `/systems`, `/faults`, `/3d-asset` — model detail feeds
- `GET /api/smart-workshop/faults` — filterable fault knowledge base (`manufacturer_id`, `model_id`, `system_key`, `component_key`, `q`)
- `GET /api/smart-workshop/vehicles/:vehicleId/specifications` — effective specifications and missing fields for an existing vehicle
- `GET /api/smart-workshop/vehicles/:vehicleId/common-problems` — the three separated problem categories
- `GET /api/smart-workshop/vehicles/:vehicleId/integrations` — read-only active job, parts and mechanic context
- `POST /api/smart-workshop/manufacturers`, `POST /api/smart-workshop/manufacturers/:id/models`, `POST /api/smart-workshop/models/:id/specifications`, `POST /api/smart-workshop/faults`, `POST /api/smart-workshop/3d-assets` — administrator-only catalogue writes
- `PATCH /api/smart-workshop/models/:id` — administrator-only model asset/status/note update
- `GET /api/smart-workshop/assets/:assetKey/validation`, `GET|POST /api/smart-workshop/assets/:assetKey/node-maps`, `PATCH /api/smart-workshop/node-maps/:id/verify` — 3D asset integrity and reviewed component-node mapping

### Workshop intelligence, digital twin and visual localization

Migration `007` adds the explicit bay registry, part compatibility/advisory recommendations, telemetry consent/state/history, VIN decode cache, inspection images, annotations, visual projections and AI training audit records. These features extend existing records; they do not invent vehicles, parts, images or telemetry.

- `GET|POST /api/workshop/bays` and `DELETE /api/workshop/bays/:id` — registered bay list and staff management; the floor board still includes bay names already present on jobs
- `POST /api/intelligence/parts/recommend`, `GET /api/intelligence/vehicles/:vehicleId/parts`, `POST /api/intelligence/parts/recommendations/:id/feedback` — advisory part suggestions from confirmed diagnosis, registered compatibility and live stock; no stock is reserved or issued
- `GET|POST /api/twin/vehicles/:vehicleId/consent`, `POST /api/twin/telemetry`, `GET /api/twin/vehicles/:vehicleId/state`, `GET /api/twin/vehicles/:vehicleId/history`, `POST /api/twin/vin-decode` — consent-gated telemetry with bounded payloads and a cache for decoded VINs; ingestion is blocked until consent is recorded
- `POST /api/visual/images`, `GET /api/visual/vehicles/:vehicleId/images`, `POST /api/visual/images/:id/annotations`, `POST /api/visual/localize`, `GET /api/visual/vehicles/:vehicleId/localizations`, `PATCH /api/visual/localizations/:id/review` — image registration, manual component annotation, normalized projection onto the image and staff review

The digital twin contains only data received through the telemetry API. No telematics provider, OEM account, live camera feed or computer-vision dataset is bundled; `NEXTGEN_VIN_PROVIDER_URL` and optional `NEXTGEN_VIN_PROVIDER_KEY` must be configured for uncached VIN decoding. Visual localization currently projects mechanic annotations; it does not claim automated computer-vision detection.

Inspection conditions are `no_fault_found`, `inspection_recommended`, `possible_fault`, and `fault_confirmed`. Migration `003` creates the inspection table and AI-prediction columns; migration `005` adds the catalogue. Both are applied automatically on startup. Integration data is read-only: AI predictions never reserve parts, assign mechanics, change stock quantities or create repairs without the existing reviewed workflow. All routes use the existing staff JWT cookies, CSRF checks for writes, workshop scoping, and role/assignment checks; customer-private data is not exposed through public catalogue endpoints.

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
- Mechanic management and workspace endpoints are listed in [Mechanic management and workspace](#mechanic-management-and-workspace).
- AI diagnosis setup and endpoints are listed in [AI vehicle fault diagnosis](#ai-vehicle-fault-diagnosis).
- 3D setup, asset attribution, status rules, and endpoints are listed in [AI Smart Workshop](#ai-smart-workshop).

All operational endpoints require a valid access JWT and scope records to that user's workshop. Legacy parts and payment tables remain in the database, but their removed modules and CRUD APIs are not exposed. The frontend refreshes an expired access token once and returns to sign-in if the refresh token has expired or been revoked. Login, registration, and refresh are rate-limited. List endpoints accept `limit` (1–200) and `offset`; related records are protected by database foreign keys.

Build the frontend with `npm run build`; run the production server with `npm run start` after setting `NODE_ENV=production` and configuring HTTPS at the reverse proxy. The server requires `NEXTGEN_JWT_SECRET` and exits with an explicit error if it is missing or shorter than 32 bytes. No JWT signing key or auth token is exposed to frontend JavaScript.
