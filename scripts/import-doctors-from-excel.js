const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const INPUT = path.resolve(__dirname, "doctor_import.json");
const EXPORT = path.resolve(process.cwd(), "doctor_registration_export.csv");
const NCR_FALLBACKS = [
  "Connaught Place, New Delhi",
  "Dwarka Sector 10, New Delhi",
  "Saket, New Delhi",
  "Karol Bagh, New Delhi",
  "Lajpat Nagar, New Delhi",
  "Preet Vihar, Delhi",
  "Sector 62, Noida",
  "Sector 18, Noida",
  "DLF Phase 3, Gurugram",
  "Cyber City, Gurugram",
  "Sector 15, Faridabad",
  "Indirapuram, Ghaziabad",
  "Greater Noida West, Noida",
  "Meerut, Uttar Pradesh",
];
const NCR_TOKENS = [
  "delhi",
  "new delhi",
  "noida",
  "greater noida",
  "gurgaon",
  "gurugram",
  "ghaziabad",
  "faridabad",
  "meerut",
];

function slug(input) {
  return String(input || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function parseExperience(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:years|yrs|year)/i);
  if (match) return Math.round(Number(match[1]));
  const num = Number(text);
  return Number.isFinite(num) ? Math.round(num) : null;
}

function normalizeAddress(value, index) {
  const raw = String(value || "").trim();
  if (!raw) return NCR_FALLBACKS[index % NCR_FALLBACKS.length];
  const lower = raw.toLowerCase();
  const matches = NCR_TOKENS.some((token) => lower.includes(token));
  if (matches) return raw;
  return NCR_FALLBACKS[index % NCR_FALLBACKS.length];
}

function inferGender(name) {
  const text = String(name || "").toLowerCase();
  const tokens = text.split(/[^a-z]+/).filter(Boolean);
  const femaleTitles = ["mrs", "ms", "miss", "smt", "kumari"];
  if (femaleTitles.some((t) => tokens.includes(t))) return "female";
  const femaleNames = new Set([
    "rachna", "nutan", "sonia", "uma", "gita", "geeta", "pooja", "priya", "neha", "poornima",
    "swati", "anita", "sunita", "kiran", "shilpa", "monika", "meenakshi", "sneha", "juhi", "divya",
  ]);
  if (tokens.some((t) => femaleNames.has(t))) return "female";
  return "male";
}

function toCsv(rows) {
  const headers = [
    "full_name",
    "email",
    "phone",
    "specialty",
    "qualification",
    "experience_years",
    "registration_number",
    "practice_address",
    "consultation_fee_inr",
    "designation",
    "photo_url",
    "source",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((key) => {
      const raw = row[key] ?? "";
      const value = String(raw).replace(/\r?\n/g, " ").replace(/\"/g, "\"\"");
      return `"${value}"`;
    });
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

function ensureEmail(value, name, index) {
  if (value) return value;
  const base = slug(name || `doctor-${index + 1}`) || `doctor-${index + 1}`;
  const suffix = crypto.randomBytes(2).toString("hex");
  return `${base}.${suffix}@noreply.astikan.local`;
}

async function clearExistingDoctors() {
  const { data: doctors, error } = await supabase.from("doctor_profiles").select("user_id");
  if (error) throw new Error(`Failed to load doctors: ${error.message}`);
  const ids = (doctors || []).map((d) => d.user_id).filter(Boolean);
  const { data: appDoctors } = await supabase.from("app_users").select("id").eq("primary_role", "doctor");
  const moreIds = (appDoctors || []).map((d) => d.id).filter(Boolean);
  const allIds = Array.from(new Set([...ids, ...moreIds]));
  if (allIds.length === 0) return;
  await supabase.from("doctor_specializations").delete().in("doctor_id", allIds);
  await supabase.from("doctor_languages").delete().in("doctor_id", allIds);
  await supabase.from("doctor_availability").delete().in("doctor_id", allIds);
  await supabase.from("doctor_verification_documents").delete().in("doctor_id", allIds);
  await supabase.from("doctor_profiles").delete().in("user_id", allIds);
  await supabase.from("app_users").delete().eq("primary_role", "doctor");
  for (const id of allIds) {
    try {
      await supabase.auth.admin.deleteUser(id);
    } catch {
      // ignore auth delete failures
    }
  }
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    throw new Error(`Missing ${INPUT}. Run the parser first.`);
  }
  const raw = JSON.parse(fs.readFileSync(INPUT, "utf-8"));
  const now = new Date().toISOString();

  await clearExistingDoctors();

  const users = [];
  const profiles = [];
  const specializations = [];
  const languages = [];
  const exportRows = [];

  for (const [index, item] of raw.entries()) {
    const userId = crypto.randomUUID();
    const fullName = item.name || "Doctor";
    const profileEmail = item.email || null;
    let authEmail = ensureEmail(profileEmail, fullName, index);
    const phone = item.phone || null;
    const specialty = item.specialty || "General Medicine";
    const qualification = item.qualification || null;
    const experienceYears = parseExperience(item.experience) ?? null;
    const registrationNumber = item.registration || null;
    const practiceAddress = normalizeAddress(item.address, index);
    const consultationFee = Number(item.fees) || 500;
    const designation = item.designation || null;
    let photoUrl = item.photo || null;
    if (photoUrl && photoUrl.startsWith("/doctor-photos/")) {
      photoUrl = `/assets${photoUrl}`;
    }
    if (!photoUrl) {
      const gender = inferGender(fullName);
      const pick = (text, a, b) => {
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) {
          hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
        }
        return hash % 2 === 0 ? a : b;
      };
      photoUrl =
        gender === "female"
          ? pick(fullName, "/assets/doctor-photos/stock-female-1.jpg", "/assets/doctor-photos/stock-female-2.jpg")
          : pick(fullName, "/assets/doctor-photos/stock-male-1.jpg", "/assets/doctor-photos/stock-male-2.jpg");
    }

    let authError = null;
    const createPayload = {
      id: userId,
      email: authEmail,
      phone: phone || undefined,
      email_confirm: true,
      phone_confirm: Boolean(phone),
      user_metadata: { role: "doctor" },
    };
    const { error: firstError } = await supabase.auth.admin.createUser(createPayload);
    authError = firstError;
    if (authError && /phone/i.test(authError.message)) {
      const { error: retryError } = await supabase.auth.admin.createUser({
        ...createPayload,
        phone: undefined,
        phone_confirm: false,
      });
      authError = retryError;
    }
    if (authError && /email/i.test(authError.message)) {
      authEmail = ensureEmail(null, fullName, index);
      const { error: retryEmail } = await supabase.auth.admin.createUser({
        ...createPayload,
        email: authEmail,
        phone: undefined,
        phone_confirm: false,
      });
      authError = retryEmail;
    }
    if (authError) {
      throw new Error(`Auth user create failed for ${fullName}: ${authError.message}`);
    }

    users.push({
      id: userId,
      primary_role: "doctor",
      full_name: fullName,
      email: authEmail,
      phone,
      avatar_url: photoUrl,
      status: "active",
      updated_at: now,
    });

    profiles.push({
      user_id: userId,
      full_display_name: fullName,
      email: profileEmail || authEmail,
      mobile: phone,
      highest_qualification: qualification,
      experience_years: experienceYears,
      medical_council_number: registrationNumber,
      practice_address: practiceAddress,
      consultation_fee_inr: consultationFee,
      verification_status: "verified",
      updated_at: now,
    });

    specializations.push({
      id: crypto.randomUUID(),
      doctor_id: userId,
      specialization_code: slug(specialty),
      specialization_name: specialty,
    });

    languages.push({
      id: crypto.randomUUID(),
      doctor_id: userId,
      language_code: "english",
      language_name: "English",
    });
    languages.push({
      id: crypto.randomUUID(),
      doctor_id: userId,
      language_code: "hindi",
      language_name: "Hindi",
    });

    exportRows.push({
      full_name: fullName,
      email: (profileEmail || authEmail) || "",
      phone: phone || "",
      specialty,
      qualification: qualification || "",
      experience_years: experienceYears ?? "",
      registration_number: registrationNumber || "",
      practice_address: practiceAddress || "",
      consultation_fee_inr: consultationFee ?? "",
      designation: designation || "",
      photo_url: photoUrl || "",
      source: item.source || "",
    });
  }

  const chunk = async (rows, size, table) => {
    for (let i = 0; i < rows.length; i += size) {
      const batch = rows.slice(i, i + size);
      const { error } = await supabase.from(table).insert(batch);
      if (error) throw new Error(`Insert ${table} failed: ${error.message}`);
    }
  };

  await chunk(users, 200, "app_users");
  await chunk(profiles, 200, "doctor_profiles");
  await chunk(specializations, 200, "doctor_specializations");
  await chunk(languages, 400, "doctor_languages");

  fs.writeFileSync(EXPORT, toCsv(exportRows), "utf-8");
  console.log(`Imported ${raw.length} doctors. Exported -> ${EXPORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
