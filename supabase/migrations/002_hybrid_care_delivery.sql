create table if not exists public.patient_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  employee_user_id uuid references public.employee_profiles (user_id) on delete set null,
  created_by_doctor_id uuid references public.doctor_profiles (user_id) on delete set null,
  full_name text not null,
  phone text,
  age integer,
  gender text,
  source text not null check (source in ('employee', 'doctor_added', 'astikan_online', 'freelance_case')),
  address_json jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.patient_medical_snapshots (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patient_profiles (id) on delete cascade,
  captured_by uuid references public.app_users (id) on delete set null,
  summary text,
  vitals_json jsonb not null default '{}'::jsonb,
  risk_flags_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid references public.employee_profiles (user_id) on delete set null,
  patient_id uuid references public.patient_profiles (id) on delete set null,
  doctor_id uuid not null references public.doctor_profiles (user_id) on delete cascade,
  created_by_user_id uuid not null references public.app_users (id) on delete cascade,
  appointment_type text not null check (appointment_type in ('teleconsult', 'opd')),
  source text not null check (source in ('astikan_assigned', 'doctor_added_patient', 'freelance_case', 'admin_created', 'employee_booked')),
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'underway', 'completed', 'rescheduled', 'cancelled', 'no_show')),
  reason text,
  patient_summary text,
  symptom_snapshot_json jsonb not null default '{}'::jsonb,
  ai_triage_summary text,
  meeting_join_window_start timestamptz,
  meeting_join_window_end timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references public.app_users (id) on delete set null,
  change_reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.teleconsult_sessions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments (id) on delete set null,
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid references public.employee_profiles (user_id) on delete set null,
  doctor_id uuid not null references public.doctor_profiles (user_id) on delete cascade,
  scheduled_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer not null default 0,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'completed', 'cancelled', 'failed')),
  active_provider text not null default 'zego' check (active_provider in ('zego', 'agora')),
  failover_count integer not null default 0,
  channel_name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.teleconsult_sessions
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists duration_seconds integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'teleconsult_sessions_appointment_unique'
  ) then
    alter table public.teleconsult_sessions
      add constraint teleconsult_sessions_appointment_unique unique (appointment_id);
  end if;
exception when duplicate_table then
  null;
end $$;

create table if not exists public.opd_visits (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid references public.employee_profiles (user_id) on delete set null,
  patient_id uuid references public.patient_profiles (id) on delete set null,
  doctor_id uuid not null references public.doctor_profiles (user_id) on delete cascade,
  clinic_location text,
  patient_eta_minutes integer,
  check_in_at timestamptz,
  consultation_start_at timestamptz,
  consultation_end_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'arriving', 'checked_in', 'underway', 'completed', 'rescheduled', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.prescription_headers (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments (id) on delete set null,
  teleconsult_session_id uuid references public.teleconsult_sessions (id) on delete set null,
  opd_visit_id uuid references public.opd_visits (id) on delete set null,
  doctor_id uuid references public.doctor_profiles (user_id) on delete set null,
  employee_id uuid references public.employee_profiles (user_id) on delete set null,
  notes text,
  condition_summary text,
  follow_up_date date,
  file_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.prescription_headers
  add column if not exists appointment_id uuid references public.appointments (id) on delete set null,
  add column if not exists opd_visit_id uuid references public.opd_visits (id) on delete set null,
  add column if not exists employee_id uuid references public.employee_profiles (user_id) on delete set null,
  add column if not exists condition_summary text,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create table if not exists public.prescription_medicines (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescription_headers (id) on delete cascade,
  medicine_catalog_id uuid,
  medicine_name text not null,
  dosage text,
  schedule text,
  duration text,
  instructions text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.prescription_labs (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescription_headers (id) on delete cascade,
  lab_test_catalog_id uuid,
  lab_test_name text not null,
  instructions text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.consultation_reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  reviewer_user_id uuid not null references public.app_users (id) on delete cascade,
  reviewer_role text not null check (reviewer_role in ('employee', 'doctor', 'corporate_admin', 'super_admin')),
  review_target text not null check (review_target in ('consultation', 'doctor', 'employee_experience')),
  rating integer not null check (rating between 1 and 5),
  review_text text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (appointment_id, reviewer_user_id, reviewer_role, review_target)
);

create table if not exists public.freelance_case_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete set null,
  hospital_name text not null,
  city text,
  minutes_away integer,
  requested_specialization text not null,
  budget_inr numeric(12, 2) not null default 0,
  patient_condition text,
  requirement_detail text,
  ai_suggested_treatment text,
  required_equipment_json jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'bidding', 'assigned', 'cancelled', 'completed')),
  created_by uuid references public.app_users (id) on delete set null,
  assigned_doctor_id uuid references public.doctor_profiles (user_id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.freelance_case_bids (
  id uuid primary key default gen_random_uuid(),
  case_request_id uuid not null references public.freelance_case_requests (id) on delete cascade,
  doctor_id uuid not null references public.doctor_profiles (user_id) on delete cascade,
  bid_amount_inr numeric(12, 2) not null default 0,
  treatment_plan text,
  equipment_needed text,
  language_notes text,
  rank_score numeric(12, 4),
  status text not null default 'submitted' check (status in ('submitted', 'shortlisted', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (case_request_id, doctor_id)
);

create index if not exists patient_profiles_company_idx on public.patient_profiles (company_id, created_at desc);
create index if not exists patient_profiles_doctor_idx on public.patient_profiles (created_by_doctor_id, created_at desc);
create index if not exists appointments_company_scheduled_idx on public.appointments (company_id, scheduled_start desc);
create index if not exists appointments_doctor_scheduled_idx on public.appointments (doctor_id, scheduled_start desc);
create index if not exists appointments_employee_scheduled_idx on public.appointments (employee_id, scheduled_start desc);
create index if not exists appointments_status_type_idx on public.appointments (status, appointment_type);
create index if not exists teleconsult_sessions_company_scheduled_idx on public.teleconsult_sessions (company_id, scheduled_at desc);
create index if not exists opd_visits_doctor_start_idx on public.opd_visits (doctor_id, consultation_start_at desc);
create index if not exists consultation_reviews_appointment_idx on public.consultation_reviews (appointment_id, created_at desc);
create index if not exists freelance_case_requests_status_created_idx on public.freelance_case_requests (status, created_at desc);
create index if not exists freelance_case_bids_case_created_idx on public.freelance_case_bids (case_request_id, created_at asc);

drop trigger if exists trg_patient_profiles_updated_at on public.patient_profiles;
create trigger trg_patient_profiles_updated_at before update on public.patient_profiles for each row execute function public.set_updated_at();
drop trigger if exists trg_appointments_updated_at on public.appointments;
create trigger trg_appointments_updated_at before update on public.appointments for each row execute function public.set_updated_at();
drop trigger if exists trg_opd_visits_updated_at on public.opd_visits;
create trigger trg_opd_visits_updated_at before update on public.opd_visits for each row execute function public.set_updated_at();
drop trigger if exists trg_prescription_headers_updated_at on public.prescription_headers;
create trigger trg_prescription_headers_updated_at before update on public.prescription_headers for each row execute function public.set_updated_at();
drop trigger if exists trg_freelance_case_requests_updated_at on public.freelance_case_requests;
create trigger trg_freelance_case_requests_updated_at before update on public.freelance_case_requests for each row execute function public.set_updated_at();

alter table public.patient_profiles enable row level security;
alter table public.patient_medical_snapshots enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_status_history enable row level security;
alter table public.teleconsult_sessions enable row level security;
alter table public.opd_visits enable row level security;
alter table public.prescription_headers enable row level security;
alter table public.prescription_medicines enable row level security;
alter table public.prescription_labs enable row level security;
alter table public.consultation_reviews enable row level security;
alter table public.freelance_case_requests enable row level security;
alter table public.freelance_case_bids enable row level security;

drop policy if exists patient_profiles_access on public.patient_profiles;
create policy patient_profiles_access on public.patient_profiles
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or created_by_doctor_id = auth.uid()
  or employee_user_id = auth.uid()
  or (company_id is not null and public.has_platform_role('corporate_admin', company_id))
);

drop policy if exists appointments_access on public.appointments;
create policy appointments_access on public.appointments
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or doctor_id = auth.uid()
  or employee_id = auth.uid()
  or created_by_user_id = auth.uid()
  or public.has_platform_role('corporate_admin', company_id)
);

drop policy if exists teleconsult_sessions_access on public.teleconsult_sessions;
create policy teleconsult_sessions_access on public.teleconsult_sessions
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or doctor_id = auth.uid()
  or employee_id = auth.uid()
  or public.has_platform_role('corporate_admin', company_id)
);

drop policy if exists opd_visits_access on public.opd_visits;
create policy opd_visits_access on public.opd_visits
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or doctor_id = auth.uid()
  or employee_id = auth.uid()
  or public.has_platform_role('corporate_admin', company_id)
);

drop policy if exists prescription_headers_access on public.prescription_headers;
create policy prescription_headers_access on public.prescription_headers
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or doctor_id = auth.uid()
  or employee_id = auth.uid()
  or exists (
    select 1
    from public.appointments a
    where a.id = appointment_id
      and public.has_platform_role('corporate_admin', a.company_id)
  )
);

drop policy if exists freelance_requests_access on public.freelance_case_requests;
create policy freelance_requests_access on public.freelance_case_requests
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or assigned_doctor_id = auth.uid()
  or created_by = auth.uid()
);

drop policy if exists freelance_bids_access on public.freelance_case_bids;
create policy freelance_bids_access on public.freelance_case_bids
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or doctor_id = auth.uid()
);
