# Astikan Backend

Fastify backend for the Astikan platform.

## Local

```bash
npm install
npm run dev
```

Default port:
- `4000`

## Production

Live API:
- `https://api.astikan.tech`

Server:
- Ubuntu VPS
- public IP: `187.127.139.105`

Process manager:
- `pm2`
- process name: `astikan-backend`

Reverse proxy:
- `nginx`

## Data model

The backend uses a hybrid storage model:

- Supabase/Postgres for primary relational business data
- local MongoDB on the VPS for events, logs, AI history, notifications, and operational collections

That means these Mongo counts being populated is expected:
- `teleconsult_events`
- `appointment_events`
- `employee_notifications`
- `system_error_logs`
- `behavior_audit_logs`

And these main business entities are not expected to be populated in Mongo:
- `app_users`
- `appointments`
- `patient_profiles`
- `doctors`
- `corporates`

Those stay in Supabase/Postgres.

## MongoDB

MongoDB Community is installed locally on the VPS and bound to:
- `127.0.0.1:27017`

The backend now uses the local Mongo URI from `.env`.

## Teleconsultation / WebRTC

Signaling:
- `/ws/teleconsult`

TURN:
- coturn installed on the VPS
- port `3478`
- relay range `49160-49200`

Backend env keys:
- `TURN_URLS`
- `TURN_USERNAME`
- `TURN_CREDENTIAL`

## Ports

- `80` nginx
- `443` nginx
- `4000` backend
- `27017` MongoDB, loopback only
- `3478` TURN
- `49160-49200` TURN relay ports

## VPS paths

- repos: `/srv/astikan/repos`
- published apps: `/srv/astikan/apps`
- logs: `/srv/astikan/logs`
- backups: `/srv/astikan/backups`

## Auto deploy

The VPS auto deploy loop is:
- script: `/usr/local/bin/astikan-deploy`
- service: `astikan-deploy.service`
- timer: `astikan-deploy.timer`

It fetches `main`, rebuilds changed repos, restarts backend, and republishes static frontends.
