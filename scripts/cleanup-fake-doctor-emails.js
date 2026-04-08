const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !serviceKey) {
  // eslint-disable-next-line no-console
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

async function run() {
  const fakePattern = "%@doctor.astikan.local";

  const { data: profileIds, error: profileError } = await supabase
    .from("doctor_profiles")
    .select("user_id")
    .ilike("email", fakePattern);

  if (profileError) throw profileError;

  const { data: userIds, error: userError } = await supabase
    .from("app_users")
    .select("id")
    .ilike("email", fakePattern);

  if (userError) throw userError;

  const ids = Array.from(
    new Set([...(profileIds ?? []).map((row) => row.user_id), ...(userIds ?? []).map((row) => row.id)]),
  ).filter(Boolean);

  if (ids.length === 0) {
    // eslint-disable-next-line no-console
    console.log("No fake doctor emails found.");
    return;
  }

  const { error: profileUpdateError } = await supabase
    .from("doctor_profiles")
    .update({ email: null })
    .ilike("email", fakePattern);

  if (profileUpdateError) throw profileUpdateError;

  const { error: userUpdateError } = await supabase
    .from("app_users")
    .update({ email: null })
    .ilike("email", fakePattern);

  if (userUpdateError) throw userUpdateError;

  const { error: loginDeleteError } = await supabase
    .from("login_accounts")
    .delete()
    .ilike("identifier", fakePattern)
    .eq("identifier_type", "email");

  if (loginDeleteError) throw loginDeleteError;

  // eslint-disable-next-line no-console
  console.log(`Cleared fake emails for ${ids.length} doctors.`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Cleanup failed:", err);
  process.exit(1);
});
