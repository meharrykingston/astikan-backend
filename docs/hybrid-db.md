# Astikan Hybrid DB

This backend now assumes a hybrid storage model:

- Supabase/Postgres for transactional and tenant-scoped relational data
- MongoDB for raw events, logs, AI history, and GridFS-backed document blobs

## Migrations

Apply the SQL files in order inside Supabase SQL editor or via your migration workflow:

1. `supabase/migrations/001_hybrid_foundation.sql`
2. `supabase/migrations/002_hybrid_care_delivery.sql`
3. `supabase/migrations/003_hybrid_commerce_programs_analytics.sql`

## Current backend alignment

Implemented backend modules and contracts:

- `companies`
  - registration writes richer company data
  - wallet and default credit policy bootstrap
- `credits`
  - purchase supports credits and INR
  - hold / release / debit / refund actions
- `doctors`
  - profile upsert
  - availability replace
  - verification document metadata creation
  - approval / verification review
  - list / search
- `appointments`
  - create appointment
  - list and fetch appointments
  - update status
  - auto-create `opd_visits` for OPD appointments
- `teleconsult`
  - records `started_at`, `ended_at`, `duration_seconds`
  - complete session endpoint
  - prescription endpoint now stores appointment and employee linkage

## Mongo responsibilities

The backend creates indexes for:

- `assessment_responses`
- `teleconsult_events`
- `chat_threads`
- `ai_insights`
- `stress_sessions`
- `health_signals`
- `document_metadata`
- `behavior_audit_logs`
- `appointment_events`
- `lab_order_events`
- `pharmacy_order_events`
- `notification_delivery_logs`
- `provider_webhook_events`
- `integration_sync_logs`
- `system_error_logs`
- `program_activity_events`
- `freelance_case_events`

## Notes

- Current frontend apps still contain local-only doctor profile state. That must be migrated to backend-backed flows next.
- RLS is set up as a baseline. Since the current apps primarily go through this backend with a service role, backend authorization remains the enforcement point until direct Supabase client access is introduced.
