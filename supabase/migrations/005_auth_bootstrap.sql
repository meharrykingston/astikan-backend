create table if not exists public.company_access_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code_type text not null check (code_type in ('employee_app', 'corporate_portal')),
  code text not null,
  label text null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (code_type, code)
);

create table if not exists public.login_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete set null,
  role text not null check (role in ('employee', 'doctor', 'corporate_admin', 'super_admin', 'ops_admin')),
  identifier_type text not null check (identifier_type in ('email', 'mobile', 'username')),
  identifier text not null,
  password_hash text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'blocked')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (identifier_type, identifier)
);

create index if not exists idx_company_access_codes_company_id on public.company_access_codes(company_id);
create index if not exists idx_login_accounts_user_id on public.login_accounts(user_id);
create index if not exists idx_login_accounts_company_id on public.login_accounts(company_id);
create index if not exists idx_login_accounts_role on public.login_accounts(role);
