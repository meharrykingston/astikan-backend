require("dotenv").config();
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function slugify(input) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

async function findAuthUserByEmail(email) {
  let page = 1;
  const normalized = email.toLowerCase();
  while (page <= 10) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    const user = result.data?.users?.find((item) => item.email?.toLowerCase() === normalized);
    if (user) return user;
    if (!result.data?.users?.length || result.data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function ensureAuthUser({ email, phone, fullName, password }) {
  const existing = await findAuthUserByEmail(email);
  if (existing) return existing.id;

  const created = await supabase.auth.admin.createUser({
    email,
    phone,
    password,
    email_confirm: true,
    phone_confirm: Boolean(phone),
    user_metadata: { full_name: fullName },
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? "Failed to create auth user");
  }
  return created.data.user.id;
}

async function ensureCompany() {
  const slug = slugify("HCLTech");
  const { data: existing } = await supabase.from("companies").select("id").eq("slug", slug).maybeSingle();
  if (existing?.id) return existing.id;

  const companyId = crypto.randomUUID();
  const now = new Date().toISOString();
  await supabase.from("companies").insert({
    id: companyId,
    name: "HCLTech",
    slug,
    contact_name: "Astikan Corporate Admin",
    employee_count: 1,
    plan: "enterprise",
    status: "active",
    created_at: now,
    updated_at: now,
  });
  await supabase.from("company_credit_wallets").upsert({
    id: crypto.randomUUID(),
    company_id: companyId,
    balance: 500000,
    locked_balance: 25000,
    credit_limit: 0,
    minimum_reserve: 25000,
    billing_cycle: "monthly",
    created_at: now,
    updated_at: now,
  });
  await supabase.from("company_credit_policies").upsert({
    company_id: companyId,
    coins_per_inr: 10,
    minimum_locked_credits_per_employee: 25000,
    recommended_minimum_buy_formula_version: 1,
    allow_custom_recharge: true,
    updated_at: now,
  });
  return companyId;
}

async function main() {
  const companyId = await ensureCompany();

  const employee = {
    email: "aditi.sharma@hcltech.com",
    phone: "9123456789",
    fullName: "Aditi Sharma",
    password: "Astikan@123",
  };
  const doctor = {
    email: "sarah.kumar@astikan.com",
    phone: "9876543210",
    fullName: "Dr. Sarah Kumar",
    password: "Doctor@123",
  };
  const corporate = {
    email: "admin.hcl@astikan.com",
    phone: "9988776655",
    fullName: "HCL Corporate Admin",
    password: "Corporate@123",
    username: "hcl.admin",
  };

  const employeeUserId = await ensureAuthUser(employee);
  const doctorUserId = await ensureAuthUser(doctor);
  const corporateUserId = await ensureAuthUser(corporate);
  const now = new Date().toISOString();

  await supabase.from("app_users").upsert([
    {
      id: employeeUserId,
      primary_role: "employee",
      full_name: employee.fullName,
      email: employee.email,
      phone: employee.phone,
      status: "active",
      updated_at: now,
    },
    {
      id: doctorUserId,
      primary_role: "doctor",
      full_name: doctor.fullName,
      email: doctor.email,
      phone: doctor.phone,
      status: "active",
      updated_at: now,
    },
    {
      id: corporateUserId,
      primary_role: "corporate_admin",
      full_name: corporate.fullName,
      email: corporate.email,
      phone: corporate.phone,
      status: "active",
      updated_at: now,
    },
  ]);

  await supabase.from("employee_profiles").upsert({
    user_id: employeeUserId,
    company_id: companyId,
    employee_code: "EMP-HCL-001",
    payroll_id: "PAY-HCL-001",
    department: "Engineering",
    designation: "Software Engineer",
    manager_name: "Astikan Manager",
    status: "active",
    updated_at: now,
  });

  await supabase.from("doctor_profiles").upsert({
    user_id: doctorUserId,
    doctor_code: "DOC-SARAH1",
    full_display_name: doctor.fullName,
    email: doctor.email,
    mobile: doctor.phone,
    highest_qualification: "MBBS",
    experience_years: 8,
    practice_address: "Astikan Clinic, Bengaluru",
    verification_status: "verified",
    verified_at: now,
    verified_by: corporateUserId,
    updated_at: now,
  });

  await supabase.from("doctor_specializations").upsert({
    id: crypto.randomUUID(),
    doctor_id: doctorUserId,
    specialization_code: "general-physician",
    specialization_name: "General Physician",
  });

  await supabase.from("corporate_admin_profiles").upsert({
    user_id: corporateUserId,
    company_id: companyId,
    designation: "Corporate Wellness Lead",
    permissions_json: { portal: "full_access" },
    updated_at: now,
  });

  await supabase.from("user_roles").upsert([
    { id: crypto.randomUUID(), user_id: employeeUserId, role: "employee", company_id: companyId, is_primary: true, created_at: now },
    { id: crypto.randomUUID(), user_id: doctorUserId, role: "doctor", company_id: null, is_primary: true, created_at: now },
    { id: crypto.randomUUID(), user_id: corporateUserId, role: "corporate_admin", company_id: companyId, is_primary: true, created_at: now },
  ]);

  await supabase.from("company_access_codes").upsert([
    { id: crypto.randomUUID(), company_id: companyId, code_type: "employee_app", code: "HCLTECH2026A", label: "HCLTech Employee App" },
    { id: crypto.randomUUID(), company_id: companyId, code_type: "corporate_portal", code: "HCL001", label: "HCLTech Corporate Portal" },
  ], { onConflict: "code_type,code" });

  await supabase.from("login_accounts").upsert([
    {
      id: crypto.randomUUID(),
      user_id: employeeUserId,
      company_id: companyId,
      role: "employee",
      identifier_type: "email",
      identifier: employee.email.toLowerCase(),
      password_hash: hashPassword(employee.password),
      status: "active",
      updated_at: now,
    },
    {
      id: crypto.randomUUID(),
      user_id: doctorUserId,
      company_id: null,
      role: "doctor",
      identifier_type: "mobile",
      identifier: doctor.phone,
      password_hash: hashPassword(doctor.password),
      status: "active",
      updated_at: now,
    },
    {
      id: crypto.randomUUID(),
      user_id: corporateUserId,
      company_id: companyId,
      role: "corporate_admin",
      identifier_type: "username",
      identifier: corporate.username.toLowerCase(),
      password_hash: hashPassword(corporate.password),
      status: "active",
      updated_at: now,
    },
  ], { onConflict: "identifier_type,identifier" });

  console.log(JSON.stringify({
    companyId,
    employee: { email: employee.email, password: employee.password, companyCode: "HCLTECH2026A" },
    doctor: { mobile: doctor.phone, password: doctor.password },
    corporate: { corporateId: "HCL001", username: corporate.username, password: corporate.password },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
