create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create table if not exists public.app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  primary_role text not null check (primary_role in ('employee', 'doctor', 'corporate_admin', 'super_admin', 'ops_admin')),
  full_name text,
  email text,
  phone text,
  avatar_url text,
  status text not null default 'active' check (status in ('active', 'inactive', 'blocked', 'pending_verification')),
  last_login_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  role text not null check (role in ('employee', 'doctor', 'corporate_admin', 'super_admin', 'ops_admin')),
  company_id uuid,
  is_primary boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, role, company_id)
);

create or replace function public.has_platform_role(target_role text, target_company uuid default null)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = target_role
      and (target_company is null or ur.company_id is null or ur.company_id = target_company)
  );
$$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  email text,
  contact_name text,
  contact_phone text,
  billing_email text,
  employee_count integer not null default 0,
  status text not null default 'active',
  plan text,
  metadata_json jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.companies
  add column if not exists slug text,
  add column if not exists contact_phone text,
  add column if not exists billing_email text,
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table if exists public.companies
  alter column metadata_json set default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'companies_status_check'
  ) then
    alter table public.companies
      add constraint companies_status_check
      check (status in ('pending', 'active', 'suspended', 'inactive'));
  end if;
end $$;

create unique index if not exists companies_slug_key on public.companies (slug);

create table if not exists public.company_credit_wallets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies (id) on delete cascade,
  balance bigint not null default 0,
  locked_balance bigint not null default 0,
  credit_limit bigint not null default 0,
  minimum_reserve bigint not null default 0,
  billing_cycle text not null default 'monthly',
  last_recharged_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.company_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  wallet_id uuid references public.company_credit_wallets (id) on delete set null,
  entry_type text not null,
  reason text,
  service_type text,
  service_ref_id uuid,
  credits bigint not null default 0,
  inr_amount numeric(12, 2) not null default 0,
  currency text not null default 'INR',
  reference text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.corporate_admin_profiles (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  designation text,
  permissions_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.super_admin_profiles (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  title text,
  permissions_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.employee_profiles (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_code text,
  payroll_id text,
  department text,
  designation text,
  manager_name text,
  date_of_joining date,
  gender text,
  dob date,
  blood_group text,
  address_json jsonb not null default '{}'::jsonb,
  emergency_contact_json jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.doctor_profiles (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  doctor_code text unique,
  full_display_name text,
  email text,
  mobile text,
  short_bio text,
  highest_qualification text,
  experience_years integer,
  medical_council_number text,
  government_id_number text,
  practice_address text,
  consultation_fee_inr numeric(12, 2) not null default 0,
  rating_avg numeric(3, 2) not null default 0,
  rating_count integer not null default 0,
  verification_status text not null default 'draft' check (verification_status in ('draft', 'submitted', 'in_review', 'verified', 'rejected', 'suspended')),
  verified_at timestamptz,
  verified_by uuid references public.app_users (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.doctor_specializations (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (user_id) on delete cascade,
  specialization_code text not null,
  specialization_name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (doctor_id, specialization_code)
);

create table if not exists public.doctor_languages (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (user_id) on delete cascade,
  language_code text not null,
  language_name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (doctor_id, language_code)
);

create table if not exists public.doctor_availability (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (user_id) on delete cascade,
  availability_type text not null check (availability_type in ('virtual', 'physical')),
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_minutes integer not null default 30,
  location_label text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.doctor_verification_documents (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (user_id) on delete cascade,
  document_type text not null check (document_type in ('government_id', 'license_certificate', 'other_certificate', 'profile_photo')),
  file_name text not null,
  mime_type text not null,
  storage_provider text not null default 'mongo_gridfs',
  storage_key text not null,
  file_size_bytes bigint not null default 0,
  verification_status text not null default 'uploaded' check (verification_status in ('uploaded', 'accepted', 'rejected')),
  review_notes text,
  uploaded_at timestamptz not null default timezone('utc', now()),
  reviewed_at timestamptz,
  reviewed_by uuid references public.app_users (id)
);

alter table if exists public.company_credit_wallets
  add column if not exists locked_balance bigint not null default 0,
  add column if not exists minimum_reserve bigint not null default 0,
  add column if not exists last_recharged_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_credit_wallets_billing_cycle_check'
  ) then
    alter table public.company_credit_wallets
      add constraint company_credit_wallets_billing_cycle_check
      check (billing_cycle in ('monthly', 'quarterly', 'yearly'));
  end if;
end $$;

alter table if exists public.company_credit_ledger
  add column if not exists wallet_id uuid references public.company_credit_wallets (id),
  add column if not exists service_type text,
  add column if not exists service_ref_id uuid,
  add column if not exists credits bigint,
  add column if not exists inr_amount numeric(12, 2),
  add column if not exists updated_at timestamptz default timezone('utc', now());

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_credit_ledger_entry_type_check'
  ) then
    alter table public.company_credit_ledger
      add constraint company_credit_ledger_entry_type_check
      check (entry_type in ('credit', 'debit', 'hold', 'release', 'refund', 'adjustment'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_credit_ledger_service_type_check'
  ) then
    alter table public.company_credit_ledger
      add constraint company_credit_ledger_service_type_check
      check (service_type is null or service_type in ('teleconsult', 'opd', 'lab', 'pharmacy', 'program', 'assessment', 'manual'));
  end if;
end $$;

create table if not exists public.company_credit_policies (
  company_id uuid primary key references public.companies (id) on delete cascade,
  coins_per_inr integer not null default 10,
  minimum_locked_credits_per_employee bigint not null default 25000,
  recommended_minimum_buy_formula_version integer not null default 1,
  allow_custom_recharge boolean not null default true,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.service_credit_pricing (
  id uuid primary key default gen_random_uuid(),
  service_type text not null check (service_type in ('teleconsult', 'opd', 'lab', 'pharmacy', 'program', 'assessment')),
  service_catalog_ref text not null,
  company_id uuid references public.companies (id) on delete cascade,
  credits_cost bigint not null,
  inr_equivalent numeric(12, 2) not null,
  is_active boolean not null default true,
  effective_from timestamptz not null default timezone('utc', now()),
  effective_to timestamptz
);

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  invoice_number text not null unique,
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('draft', 'issued', 'paid', 'failed', 'cancelled')),
  subtotal_inr numeric(12, 2) not null default 0,
  tax_inr numeric(12, 2) not null default 0,
  total_inr numeric(12, 2) not null default 0,
  pdf_storage_key text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.billing_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices (id) on delete cascade,
  service_type text not null,
  service_ref_id uuid,
  description text not null,
  credits bigint not null default 0,
  inr_amount numeric(12, 2) not null default 0,
  quantity integer not null default 1,
  metadata_json jsonb not null default '{}'::jsonb
);

create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  invoice_id uuid references public.billing_invoices (id) on delete set null,
  provider text not null,
  external_reference text,
  url text not null,
  amount_inr numeric(12, 2) not null,
  status text not null check (status in ('created', 'sent', 'opened', 'paid', 'expired', 'failed')),
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.provider_integrations (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null unique,
  provider_type text not null check (provider_type in ('video', 'ai', 'lab', 'payments', 'finance', 'hrms', 'erp', 'messaging')),
  display_name text not null,
  status text not null check (status in ('active', 'inactive', 'error', 'testing')),
  base_url text,
  environment text not null check (environment in ('dev', 'staging', 'prod')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.provider_integration_secrets (
  id uuid primary key default gen_random_uuid(),
  provider_integration_id uuid not null references public.provider_integrations (id) on delete cascade,
  key_name text not null,
  secret_ref text not null,
  last_rotated_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  unique (provider_integration_id, key_name)
);

create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload_json jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  retry_count integer not null default 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists user_roles_user_id_idx on public.user_roles (user_id);
create index if not exists user_roles_company_id_idx on public.user_roles (company_id);
create index if not exists employee_profiles_company_id_idx on public.employee_profiles (company_id);
create index if not exists doctor_profiles_verification_status_idx on public.doctor_profiles (verification_status);
create index if not exists doctor_specializations_doctor_id_idx on public.doctor_specializations (doctor_id);
create index if not exists doctor_languages_doctor_id_idx on public.doctor_languages (doctor_id);
create index if not exists doctor_availability_doctor_id_idx on public.doctor_availability (doctor_id, day_of_week);
create index if not exists company_credit_ledger_company_created_idx on public.company_credit_ledger (company_id, created_at desc);
create index if not exists company_credit_ledger_service_idx on public.company_credit_ledger (service_type, service_ref_id);
create index if not exists service_credit_pricing_service_idx on public.service_credit_pricing (service_type, service_catalog_ref, company_id);
create index if not exists outbox_events_status_created_idx on public.outbox_events (status, created_at);

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at before update on public.app_users for each row execute function public.set_updated_at();
drop trigger if exists trg_corporate_admin_profiles_updated_at on public.corporate_admin_profiles;
create trigger trg_corporate_admin_profiles_updated_at before update on public.corporate_admin_profiles for each row execute function public.set_updated_at();
drop trigger if exists trg_super_admin_profiles_updated_at on public.super_admin_profiles;
create trigger trg_super_admin_profiles_updated_at before update on public.super_admin_profiles for each row execute function public.set_updated_at();
drop trigger if exists trg_employee_profiles_updated_at on public.employee_profiles;
create trigger trg_employee_profiles_updated_at before update on public.employee_profiles for each row execute function public.set_updated_at();
drop trigger if exists trg_doctor_profiles_updated_at on public.doctor_profiles;
create trigger trg_doctor_profiles_updated_at before update on public.doctor_profiles for each row execute function public.set_updated_at();
drop trigger if exists trg_doctor_availability_updated_at on public.doctor_availability;
create trigger trg_doctor_availability_updated_at before update on public.doctor_availability for each row execute function public.set_updated_at();
drop trigger if exists trg_company_credit_wallets_updated_at on public.company_credit_wallets;
create trigger trg_company_credit_wallets_updated_at before update on public.company_credit_wallets for each row execute function public.set_updated_at();
drop trigger if exists trg_billing_invoices_updated_at on public.billing_invoices;
create trigger trg_billing_invoices_updated_at before update on public.billing_invoices for each row execute function public.set_updated_at();
drop trigger if exists trg_payment_links_updated_at on public.payment_links;
create trigger trg_payment_links_updated_at before update on public.payment_links for each row execute function public.set_updated_at();
drop trigger if exists trg_provider_integrations_updated_at on public.provider_integrations;
create trigger trg_provider_integrations_updated_at before update on public.provider_integrations for each row execute function public.set_updated_at();

alter table public.app_users enable row level security;
alter table public.user_roles enable row level security;
alter table public.employee_profiles enable row level security;
alter table public.doctor_profiles enable row level security;
alter table public.doctor_specializations enable row level security;
alter table public.doctor_languages enable row level security;
alter table public.doctor_availability enable row level security;
alter table public.doctor_verification_documents enable row level security;
alter table public.company_credit_wallets enable row level security;
alter table public.company_credit_ledger enable row level security;
alter table public.company_credit_policies enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_invoice_lines enable row level security;
alter table public.payment_links enable row level security;

drop policy if exists app_users_self_select on public.app_users;
create policy app_users_self_select on public.app_users
for select using (id = auth.uid() or public.has_platform_role('super_admin'));

drop policy if exists employee_profiles_self_or_company on public.employee_profiles;
create policy employee_profiles_self_or_company on public.employee_profiles
for select using (
  user_id = auth.uid()
  or public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or public.has_platform_role('corporate_admin', company_id)
);

drop policy if exists doctor_profiles_self_or_admin on public.doctor_profiles;
create policy doctor_profiles_self_or_admin on public.doctor_profiles
for select using (
  user_id = auth.uid()
  or public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
);

drop policy if exists doctor_specializations_self_or_admin on public.doctor_specializations;
create policy doctor_specializations_self_or_admin on public.doctor_specializations
for select using (
  doctor_id = auth.uid()
  or public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
);

drop policy if exists doctor_languages_self_or_admin on public.doctor_languages;
create policy doctor_languages_self_or_admin on public.doctor_languages
for select using (
  doctor_id = auth.uid()
  or public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
);

drop policy if exists doctor_availability_self_or_admin on public.doctor_availability;
create policy doctor_availability_self_or_admin on public.doctor_availability
for select using (
  doctor_id = auth.uid()
  or public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
);

drop policy if exists doctor_docs_self_or_admin on public.doctor_verification_documents;
create policy doctor_docs_self_or_admin on public.doctor_verification_documents
for select using (
  doctor_id = auth.uid()
  or public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
);

drop policy if exists company_wallets_company_admin on public.company_credit_wallets;
create policy company_wallets_company_admin on public.company_credit_wallets
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or public.has_platform_role('corporate_admin', company_id)
);

drop policy if exists company_ledger_company_admin on public.company_credit_ledger;
create policy company_ledger_company_admin on public.company_credit_ledger
for select using (
  public.has_platform_role('super_admin')
  or public.has_platform_role('ops_admin')
  or public.has_platform_role('corporate_admin', company_id)
);
