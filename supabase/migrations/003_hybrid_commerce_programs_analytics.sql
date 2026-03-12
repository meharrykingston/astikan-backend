create table if not exists public.lab_test_catalog (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'niramaya',
  provider_test_code text not null,
  name text not null,
  category text,
  sample_type text,
  tat_hours integer,
  base_price_inr numeric(12, 2) not null default 0,
  default_credit_cost bigint not null default 0,
  availability_status text not null default 'live' check (availability_status in ('live', 'limited', 'paused')),
  coverage_note text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_test_code)
);

create table if not exists public.company_lab_pricing (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  lab_test_catalog_id uuid not null references public.lab_test_catalog (id) on delete cascade,
  credit_cost bigint not null,
  price_inr numeric(12, 2),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (company_id, lab_test_catalog_id)
);

create table if not exists public.lab_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid references public.employee_profiles (user_id) on delete set null,
  patient_id uuid references public.patient_profiles (id) on delete set null,
  prescription_id uuid references public.prescription_headers (id) on delete set null,
  lab_test_catalog_id uuid not null references public.lab_test_catalog (id) on delete cascade,
  provider text not null,
  provider_order_reference text,
  status text not null default 'created' check (status in ('created', 'scheduled', 'sample_collection', 'processing', 'completed', 'cancelled', 'rescheduled', 'failed')),
  slot_at timestamptz,
  report_storage_key text,
  credit_cost bigint not null default 0,
  price_inr numeric(12, 2) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.lab_order_status_history (
  id uuid primary key default gen_random_uuid(),
  lab_order_id uuid not null references public.lab_orders (id) on delete cascade,
  status text not null,
  provider_payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.lab_reports (
  id uuid primary key default gen_random_uuid(),
  lab_order_id uuid not null references public.lab_orders (id) on delete cascade,
  report_name text not null,
  storage_provider text not null,
  storage_key text not null,
  mime_type text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pharmacy_product_catalog (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category text,
  description text,
  specifications_json jsonb not null default '{}'::jsonb,
  base_price_inr numeric(12, 2) not null default 0,
  default_credit_cost bigint,
  image_urls_json jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pharmacy_inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.pharmacy_product_catalog (id) on delete cascade,
  location_code text not null,
  available_qty integer not null default 0,
  reserved_qty integer not null default 0,
  reorder_level integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (product_id, location_code)
);

create table if not exists public.pharmacy_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete set null,
  doctor_id uuid references public.doctor_profiles (user_id) on delete set null,
  employee_id uuid references public.employee_profiles (user_id) on delete set null,
  patient_id uuid references public.patient_profiles (id) on delete set null,
  order_source text not null check (order_source in ('doctor_store', 'employee_store', 'admin_panel')),
  status text not null default 'cart' check (status in ('cart', 'placed', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded')),
  subtotal_inr numeric(12, 2) not null default 0,
  wallet_used_inr numeric(12, 2) not null default 0,
  online_payment_inr numeric(12, 2) not null default 0,
  credit_cost bigint,
  shipping_address_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pharmacy_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pharmacy_orders (id) on delete cascade,
  product_id uuid not null references public.pharmacy_product_catalog (id) on delete cascade,
  qty integer not null default 1,
  unit_price_inr numeric(12, 2) not null default 0,
  line_total_inr numeric(12, 2) not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.health_programs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  program_type text not null check (program_type in ('fitness_challenge', 'mental_health', 'health_assessment', 'wellness_campaign', 'camp')),
  title text not null,
  description text,
  start_date date,
  end_date date,
  status text not null default 'draft' check (status in ('draft', 'published', 'active', 'completed', 'archived')),
  points_available integer not null default 0,
  rules_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.program_enrollments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.health_programs (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employee_profiles (user_id) on delete cascade,
  status text not null default 'enrolled' check (status in ('enrolled', 'active', 'completed', 'dropped')),
  enrolled_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create table if not exists public.assessment_definitions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references public.health_programs (id) on delete set null,
  title text not null,
  description text,
  target_audience text not null check (target_audience in ('employee', 'doctor', 'corporate')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  question_count integer not null default 0,
  created_by uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessment_definitions (id) on delete cascade,
  question_type text not null,
  question_text text not null,
  options_json jsonb not null default '[]'::jsonb,
  correct_answer_json jsonb,
  points integer not null default 0,
  sequence_no integer not null
);

create table if not exists public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessment_definitions (id) on delete cascade,
  employee_id uuid not null references public.employee_profiles (user_id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  status text not null default 'started' check (status in ('started', 'submitted', 'evaluated')),
  score numeric(12, 2),
  points_earned integer not null default 0,
  started_at timestamptz not null default timezone('utc', now()),
  submitted_at timestamptz
);

create table if not exists public.reward_point_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employee_profiles (user_id) on delete cascade,
  program_id uuid references public.health_programs (id) on delete set null,
  source_type text not null check (source_type in ('assessment', 'program', 'challenge', 'manual')),
  source_ref_id uuid,
  points integer not null,
  reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  user_id uuid not null references public.app_users (id) on delete cascade,
  audience_role text,
  channel text not null check (channel in ('in_app', 'email', 'sms', 'push', 'whatsapp')),
  title text not null,
  body text not null,
  payload_json jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  scheduled_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  channel text not null,
  title_template text not null,
  body_template text not null,
  variables_json jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.company_finance_integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  provider_key text not null,
  status text not null check (status in ('connected', 'disconnected', 'error', 'syncing')),
  external_tenant_ref text,
  config_json jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade,
  provider_key text not null,
  sync_type text not null,
  status text not null,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  summary_json jsonb not null default '{}'::jsonb,
  error_text text
);

create table if not exists public.daily_company_service_usage (
  company_id uuid not null references public.companies (id) on delete cascade,
  usage_date date not null,
  teleconsult_count integer not null default 0,
  teleconsult_minutes integer not null default 0,
  opd_count integer not null default 0,
  lab_order_count integer not null default 0,
  pharmacy_order_count integer not null default 0,
  assessment_count integer not null default 0,
  credits_consumed bigint not null default 0,
  inr_equivalent numeric(12, 2) not null default 0,
  primary key (company_id, usage_date)
);

create table if not exists public.daily_doctor_performance (
  doctor_id uuid not null references public.doctor_profiles (user_id) on delete cascade,
  usage_date date not null,
  teleconsult_count integer not null default 0,
  teleconsult_minutes integer not null default 0,
  opd_count integer not null default 0,
  avg_rating numeric(3, 2) not null default 0,
  patients_seen integer not null default 0,
  freelance_cases_won integer not null default 0,
  primary key (doctor_id, usage_date)
);

create table if not exists public.daily_employee_health_activity (
  employee_id uuid not null references public.employee_profiles (user_id) on delete cascade,
  usage_date date not null,
  consultations integer not null default 0,
  labs integer not null default 0,
  assessments_completed integer not null default 0,
  program_points integer not null default 0,
  risk_score numeric(12, 2),
  primary key (employee_id, usage_date)
);

create table if not exists public.company_financial_summary_monthly (
  company_id uuid not null references public.companies (id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  credits_purchased bigint not null default 0,
  credits_consumed bigint not null default 0,
  inr_invested numeric(12, 2) not null default 0,
  inr_realized numeric(12, 2) not null default 0,
  roi_percent numeric(12, 2) not null default 0,
  claims_avoided_count integer not null default 0,
  primary key (company_id, year, month)
);

create table if not exists public.teleconsult_opd_summary_weekly (
  company_id uuid not null references public.companies (id) on delete cascade,
  week_start date not null,
  teleconsult_count integer not null default 0,
  opd_count integer not null default 0,
  avg_teleconsult_minutes numeric(12, 2) not null default 0,
  completed_count integer not null default 0,
  pending_count integer not null default 0,
  rescheduled_count integer not null default 0,
  primary key (company_id, week_start)
);

create index if not exists lab_orders_company_created_idx on public.lab_orders (company_id, created_at desc);
create index if not exists lab_orders_provider_reference_idx on public.lab_orders (provider_order_reference);
create index if not exists pharmacy_orders_created_idx on public.pharmacy_orders (created_at desc);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists program_enrollments_company_employee_idx on public.program_enrollments (company_id, employee_id);
create index if not exists assessment_attempts_company_employee_idx on public.assessment_attempts (company_id, employee_id, started_at desc);

drop trigger if exists trg_lab_test_catalog_updated_at on public.lab_test_catalog;
create trigger trg_lab_test_catalog_updated_at before update on public.lab_test_catalog for each row execute function public.set_updated_at();
drop trigger if exists trg_company_lab_pricing_updated_at on public.company_lab_pricing;
create trigger trg_company_lab_pricing_updated_at before update on public.company_lab_pricing for each row execute function public.set_updated_at();
drop trigger if exists trg_lab_orders_updated_at on public.lab_orders;
create trigger trg_lab_orders_updated_at before update on public.lab_orders for each row execute function public.set_updated_at();
drop trigger if exists trg_pharmacy_product_catalog_updated_at on public.pharmacy_product_catalog;
create trigger trg_pharmacy_product_catalog_updated_at before update on public.pharmacy_product_catalog for each row execute function public.set_updated_at();
drop trigger if exists trg_pharmacy_orders_updated_at on public.pharmacy_orders;
create trigger trg_pharmacy_orders_updated_at before update on public.pharmacy_orders for each row execute function public.set_updated_at();
drop trigger if exists trg_health_programs_updated_at on public.health_programs;
create trigger trg_health_programs_updated_at before update on public.health_programs for each row execute function public.set_updated_at();
drop trigger if exists trg_assessment_definitions_updated_at on public.assessment_definitions;
create trigger trg_assessment_definitions_updated_at before update on public.assessment_definitions for each row execute function public.set_updated_at();
drop trigger if exists trg_notification_templates_updated_at on public.notification_templates;
create trigger trg_notification_templates_updated_at before update on public.notification_templates for each row execute function public.set_updated_at();
drop trigger if exists trg_company_finance_integrations_updated_at on public.company_finance_integrations;
create trigger trg_company_finance_integrations_updated_at before update on public.company_finance_integrations for each row execute function public.set_updated_at();

alter table public.lab_orders enable row level security;
alter table public.pharmacy_orders enable row level security;
alter table public.program_enrollments enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.notifications enable row level security;

drop policy if exists lab_orders_access on public.lab_orders;
create policy lab_orders_access on public.lab_orders
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or employee_id = auth.uid()
  or public.has_platform_role('corporate_admin', company_id)
);

drop policy if exists pharmacy_orders_access on public.pharmacy_orders;
create policy pharmacy_orders_access on public.pharmacy_orders
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or doctor_id = auth.uid()
  or employee_id = auth.uid()
  or (company_id is not null and public.has_platform_role('corporate_admin', company_id))
);

drop policy if exists program_enrollments_access on public.program_enrollments;
create policy program_enrollments_access on public.program_enrollments
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or employee_id = auth.uid()
  or public.has_platform_role('corporate_admin', company_id)
);

drop policy if exists assessment_attempts_access on public.assessment_attempts;
create policy assessment_attempts_access on public.assessment_attempts
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or employee_id = auth.uid()
  or public.has_platform_role('corporate_admin', company_id)
);

drop policy if exists notifications_access on public.notifications;
create policy notifications_access on public.notifications
for select using (
  user_id = auth.uid()
  or public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or (company_id is not null and public.has_platform_role('corporate_admin', company_id))
);
