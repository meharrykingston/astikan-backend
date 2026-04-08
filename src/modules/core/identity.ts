import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireSupabase } from "./data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function slugify(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function findAuthUserByEmail(app: FastifyInstance, email: string) {
  const supabase = requireSupabase(app);
  let page = 1;
  const normalized = email.trim().toLowerCase();

  while (page <= 10) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    const user = result.data?.users?.find((item) => item.email?.toLowerCase() === normalized);
    if (user) return user;
    if (!result.data?.users?.length || result.data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function ensureAuthUser(app: FastifyInstance, input: { email: string; phone?: string; fullName?: string }) {
  const supabase = requireSupabase(app);
  const existing = await findAuthUserByEmail(app, input.email);
  if (existing) return existing.id;

  const created = await supabase.auth.admin.createUser({
    email: input.email,
    phone: input.phone,
    email_confirm: true,
    phone_confirm: Boolean(input.phone),
    user_metadata: {
      full_name: input.fullName ?? null,
    },
  });
  if (created.error || !created.data.user) {
    throw new Error(`Failed to create auth user: ${created.error?.message ?? "unknown error"}`);
  }
  return created.data.user.id;
}

async function upsertAppUser(
  app: FastifyInstance,
  input: {
    userId: string;
    primaryRole: "employee" | "doctor" | "corporate_admin" | "super_admin" | "ops_admin";
    fullName?: string;
    email?: string;
    phone?: string;
  }
) {
  const supabase = requireSupabase(app);
  const now = new Date().toISOString();
  const { error } = await supabase.from("app_users").upsert({
    id: input.userId,
    primary_role: input.primaryRole,
    full_name: input.fullName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    status: "active",
    updated_at: now,
  });
  if (error) {
    throw new Error(`Failed to upsert app user: ${error.message}`);
  }
}

export async function ensureCompanyByReference(
  app: FastifyInstance,
  input: {
    companyReference?: string;
    companyName?: string;
  }
) {
  const supabase = requireSupabase(app);
  const reference = input.companyReference?.trim() || "astikan-demo-company";
  const fallbackName = input.companyName?.trim() || "Astikan Demo Company";
  const now = new Date().toISOString();

  if (UUID_RE.test(reference)) {
    const { data } = await supabase.from("companies").select("id").eq("id", reference).maybeSingle();
    if (data?.id) return data.id;
  }

  const slug = slugify(reference);
  const { data: existing } = await supabase.from("companies").select("id").eq("slug", slug).maybeSingle();
  if (existing?.id) return existing.id;

  const companyId = crypto.randomUUID();
  const { error: companyError } = await supabase.from("companies").insert({
    id: companyId,
    name: fallbackName,
    slug,
    email: null,
    contact_name: "Astikan Ops",
    contact_phone: null,
    billing_email: null,
    employee_count: 0,
    plan: "starter",
    status: "active",
    metadata_json: {},
    created_at: now,
    updated_at: now,
  });
  if (companyError) {
    throw new Error(`Failed to create demo company: ${companyError.message}`);
  }

  await supabase.from("company_credit_wallets").insert({
    id: crypto.randomUUID(),
    company_id: companyId,
    balance: 0,
    locked_balance: 0,
    credit_limit: 0,
    minimum_reserve: 0,
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

export async function ensureDoctorPrincipal(
  app: FastifyInstance,
  input: {
    email?: string;
    phone?: string;
    fullName?: string;
    handle?: string;
    specialization?: string;
  }
) {
  const supabase = requireSupabase(app);
  const handle = slugify(input.handle ?? input.fullName ?? "doctor");
  const email = (input.email?.trim().toLowerCase() || `${handle}@doctor.astikan.local`);
  const fullName = input.fullName?.trim() || `Dr. ${handle.replace(/-/g, " ")}`;
  const userId = await ensureAuthUser(app, { email, phone: input.phone, fullName });
  const now = new Date().toISOString();

  await upsertAppUser(app, {
    userId,
    primaryRole: "doctor",
    fullName,
    email,
    phone: input.phone,
  });

  const { error: profileError } = await supabase.from("doctor_profiles").upsert({
    user_id: userId,
    doctor_code: `DOC-${handle.toUpperCase().replace(/-/g, "").slice(0, 10)}`,
    full_display_name: fullName,
    email,
    mobile: input.phone ?? null,
    verification_status: "draft",
    updated_at: now,
  });
  if (profileError) {
    throw new Error(`Failed to ensure doctor profile: ${profileError.message}`);
  }

  const { data: existingAvailability } = await supabase
    .from("doctor_availability")
    .select("id")
    .eq("doctor_id", userId)
    .limit(1);

  if (!existingAvailability || existingAvailability.length === 0) {
    const patterns = [
      {
        weekdays: { start: "09:00:00", end: "18:00:00" },
        saturday: { start: "09:00:00", end: "13:00:00" },
        sunday: { start: "10:00:00", end: "13:00:00" },
      },
      {
        weekdays: { start: "11:00:00", end: "20:00:00" },
        saturday: { start: "11:00:00", end: "16:00:00" },
        sunday: null,
      },
      {
        weekdays: { start: "10:00:00", end: "19:00:00" },
        saturday: null,
        sunday: { start: "10:00:00", end: "13:00:00" },
      },
    ];

    const hash = [...userId].reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const schedule = patterns[hash % patterns.length];

    const buildSlots = (days: number[], window: { start: string; end: string }) =>
      days.flatMap((day) => [
        {
          id: crypto.randomUUID(),
          doctor_id: userId,
          availability_type: "physical",
          day_of_week: day,
          start_time: window.start,
          end_time: window.end,
          slot_minutes: 30,
          location_label: "Clinic",
          is_active: true,
        },
        {
          id: crypto.randomUUID(),
          doctor_id: userId,
          availability_type: "virtual",
          day_of_week: day,
          start_time: window.start,
          end_time: window.end,
          slot_minutes: 30,
          location_label: "Teleconsult",
          is_active: true,
        },
      ]);

    const slots = [
      ...buildSlots([1, 2, 3, 4, 5], schedule.weekdays),
      ...(schedule.saturday ? buildSlots([6], schedule.saturday) : []),
      ...(schedule.sunday ? buildSlots([0], schedule.sunday) : []),
    ];

    const { error: availabilityError } = await supabase.from("doctor_availability").insert(slots);
    if (availabilityError) {
      throw new Error(`Failed to seed doctor availability: ${availabilityError.message}`);
    }
  }

  if (input.specialization) {
    await supabase.from("doctor_specializations").upsert({
      id: crypto.randomUUID(),
      doctor_id: userId,
      specialization_code: slugify(input.specialization),
      specialization_name: input.specialization,
    });
  }

  return { userId, email, fullName };
}

export async function ensureEmployeePrincipal(
  app: FastifyInstance,
  input: {
    companyId: string;
    email?: string;
    phone?: string;
    fullName?: string;
    handle?: string;
    employeeCode?: string;
  }
) {
  const supabase = requireSupabase(app);
  const handle = slugify(input.handle ?? input.email ?? input.fullName ?? "employee");
  const email = (input.email?.trim().toLowerCase() || `${handle}@employee.astikan.local`);
  const fullName = input.fullName?.trim() || "Astikan Employee";
  const employeeCode = input.employeeCode?.trim() || `EMP-${handle.toUpperCase().replace(/-/g, "").slice(0, 10)}`;
  const userId = await ensureAuthUser(app, { email, phone: input.phone, fullName });
  const now = new Date().toISOString();

  await upsertAppUser(app, {
    userId,
    primaryRole: "employee",
    fullName,
    email,
    phone: input.phone,
  });

  const { error: profileError } = await supabase.from("employee_profiles").upsert({
    user_id: userId,
    company_id: input.companyId,
    employee_code: employeeCode,
    payroll_id: employeeCode,
    department: "General",
    designation: "Employee",
    status: "active",
    updated_at: now,
  });
  if (profileError) {
    throw new Error(`Failed to ensure employee profile: ${profileError.message}`);
  }

  return { userId, email, fullName, employeeCode };
}
