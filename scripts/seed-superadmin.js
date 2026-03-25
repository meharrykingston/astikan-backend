require("dotenv").config();
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

async function ensureAuthUser({ email, fullName, password }) {
  const existing = await findAuthUserByEmail(email);
  if (existing) return existing.id;

  const created = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? "Failed to create auth user");
  }
  return created.data.user.id;
}

async function main() {
  const username = (process.env.SUPERADMIN_SEED_USERNAME || "superadmin").trim().toLowerCase();
  const password = process.env.SUPERADMIN_SEED_PASSWORD || "Astikan@2026";
  const email = (process.env.SUPERADMIN_SEED_EMAIL || "superadmin@astikan.local").trim().toLowerCase();

  const userId = await ensureAuthUser({
    email,
    fullName: "Astikan Super Admin",
    password,
  });

  const now = new Date().toISOString();

  await supabase.from("app_users").upsert({
    id: userId,
    primary_role: "super_admin",
    full_name: "Astikan Super Admin",
    email,
    status: "active",
    updated_at: now,
  });

  await supabase.from("user_roles").upsert({
    id: crypto.randomUUID(),
    user_id: userId,
    role: "super_admin",
    company_id: null,
    is_primary: true,
    created_at: now,
  });

  await supabase.from("login_accounts").upsert({
    id: crypto.randomUUID(),
    user_id: userId,
    company_id: null,
    role: "super_admin",
    identifier_type: "username",
    identifier: username,
    password_hash: hashPassword(password),
    status: "active",
    updated_at: now,
  }, { onConflict: "identifier_type,identifier" });

  console.log(JSON.stringify({
    username,
    password,
    email,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
