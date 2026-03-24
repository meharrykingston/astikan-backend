const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const fs = require("node:fs");
const crypto = require("node:crypto");
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
const { MongoClient } = require("mongodb");

const DELHI_ADDRESSES = [
  "Astikan OPD Clinic, Connaught Place, New Delhi",
  "Astikan Health Center, Saket, New Delhi",
  "Astikan Care Hub, Sector 29, Gurugram",
  "Astikan Medical Point, Sector 62, Noida",
  "Astikan Clinic, Dwarka Sector 10, New Delhi",
  "Astikan OPD Wing, Karol Bagh, New Delhi",
];

const DEFAULT_SPECIALIZATIONS = [
  "General Medicine",
  "Cardiology",
  "Dermatology",
  "Pediatrics",
  "Orthopedics",
  "Neurology",
  "Pulmonology",
  "Endocrinology",
];

const DEFAULT_LANGUAGES = ["English", "Hindi"];

function isBlank(value) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function slug(input) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function deriveEmail(base, index) {
  const cleaned = (base || `doctor${index + 1}`).toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${cleaned}@demo.astikan.local`;
}

function derivePhone(index) {
  const suffix = String((index + 1) % 100).padStart(2, "0");
  return `90000000${suffix}`;
}

function deriveCouncilNumber(userId) {
  const tail = userId.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase() || crypto.randomBytes(3).toString("hex").toUpperCase();
  return `MCN-${tail}`;
}

function deriveGovernmentId(userId) {
  const tail = userId.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase() || crypto.randomBytes(3).toString("hex").toUpperCase();
  return `GOV-${tail}`;
}

function delhiAddress(index) {
  return DELHI_ADDRESSES[index % DELHI_ADDRESSES.length];
}

function availabilitySummary(rows) {
  if (!rows || rows.length === 0) return "";
  const byType = rows.reduce((acc, row) => {
    const key = row.availability_type || "unknown";
    acc[key] = acc[key] || [];
    acc[key].push(row);
    return acc;
  }, {});
  const parts = [];
  Object.keys(byType).forEach((key) => {
    const items = byType[key];
    const first = items[0];
    parts.push(`${key}: ${first.day_of_week ?? "?"} ${first.start_time ?? "?"}-${first.end_time ?? "?"}`);
  });
  return parts.join(" | ");
}

async function main() {
  const now = new Date().toISOString();
  const { data: doctors, error } = await supabase
    .from("doctor_profiles")
    .select("*, doctor_specializations(*), doctor_languages(*), doctor_availability(*)")
    .order("updated_at", { ascending: false })
    .limit(1000);

  if (error) {
    throw new Error(`Failed to fetch doctor profiles: ${error.message}`);
  }

  const doctorRows = doctors ?? [];
  const userIds = doctorRows.map((doc) => doc.user_id).filter(Boolean);

  const { data: users } = userIds.length
    ? await supabase.from("app_users").select("id, full_name, email, phone, avatar_url").in("id", userIds)
    : { data: [] };

  const userMap = new Map((users ?? []).map((u) => [u.id, u]));

  const exportRows = [];

  const duplicates = new Map();
  doctorRows.forEach((doc) => {
    const user = userMap.get(doc.user_id);
    const email = (user?.email || doc.email || "").toLowerCase().trim();
    const phone = (user?.phone || doc.mobile || "").replace(/\D/g, "");
    const key = email ? `email:${email}` : phone ? `phone:${phone}` : null;
    if (!key) return;
    if (!duplicates.has(key)) {
      duplicates.set(key, []);
    }
    duplicates.get(key).push({ doc, user });
  });

  for (const [key, group] of duplicates.entries()) {
    if (!group || group.length <= 1) continue;
    group.sort((a, b) => {
      const aUpdated = Date.parse(a.doc.updated_at || a.user?.updated_at || "") || 0;
      const bUpdated = Date.parse(b.doc.updated_at || b.user?.updated_at || "") || 0;
      return bUpdated - aUpdated;
    });
    const keep = group[0];
    const remove = group.slice(1);
    for (const entry of remove) {
      const userId = entry.doc.user_id;
      if (!userId) continue;
      await supabase.from("doctor_specializations").delete().eq("doctor_id", userId);
      await supabase.from("doctor_languages").delete().eq("doctor_id", userId);
      await supabase.from("doctor_availability").delete().eq("doctor_id", userId);
      await supabase.from("doctor_verification_documents").delete().eq("doctor_id", userId);
      await supabase.from("doctor_profiles").delete().eq("user_id", userId);
      await supabase.from("app_users").delete().eq("id", userId);
      try {
        await supabase.auth.admin.deleteUser(userId);
      } catch {
        // ignore auth delete failures
      }
      console.log(`Removed duplicate doctor (${key}): ${userId}`);
    }
  }

  for (let i = 0; i < doctorRows.length; i += 1) {
    const doc = doctorRows[i];
    const user = userMap.get(doc.user_id);

    const fullName =
      (!isBlank(user?.full_name) && user.full_name) ||
      (!isBlank(doc.full_display_name) && doc.full_display_name) ||
      `Dr. Astikan Clinician ${i + 1}`;
    const email =
      (!isBlank(user?.email) && user.email) ||
      (!isBlank(doc.email) && doc.email) ||
      deriveEmail(fullName, i);
    const phone =
      (!isBlank(user?.phone) && user.phone) ||
      (!isBlank(doc.mobile) && doc.mobile) ||
      derivePhone(i);
    const highestQualification = !isBlank(doc.highest_qualification) ? doc.highest_qualification : "MBBS";
    const experienceYears = typeof doc.experience_years === "number" ? doc.experience_years : 5 + (i % 12);
    const shortBio =
      !isBlank(doc.short_bio)
        ? doc.short_bio
        : "Patient-first clinician focused on continuity care and evidence-based practice.";
    const practiceAddress = delhiAddress(i);
    const medicalCouncilNumber = !isBlank(doc.medical_council_number)
      ? doc.medical_council_number
      : deriveCouncilNumber(doc.user_id);
    const governmentIdNumber = !isBlank(doc.government_id_number)
      ? doc.government_id_number
      : deriveGovernmentId(doc.user_id);
    const fee = typeof doc.consultation_fee_inr === "number" ? doc.consultation_fee_inr : 400 + (i % 5) * 50;
    const verificationStatus = !isBlank(doc.verification_status) ? doc.verification_status : "submitted";

    await supabase.from("app_users").upsert({
      id: doc.user_id,
      primary_role: "doctor",
      full_name: fullName,
      email,
      phone,
      avatar_url: user?.avatar_url ?? doc.avatar_url ?? null,
      status: "active",
      updated_at: now,
    });

    await supabase.from("doctor_profiles").upsert({
      user_id: doc.user_id,
      full_display_name: fullName,
      email,
      mobile: phone,
      short_bio: shortBio,
      highest_qualification: highestQualification,
      experience_years: experienceYears,
      medical_council_number: medicalCouncilNumber,
      government_id_number: governmentIdNumber,
      practice_address: practiceAddress,
      consultation_fee_inr: fee,
      verification_status: verificationStatus,
      updated_at: now,
    });

    if (!Array.isArray(doc.doctor_specializations) || doc.doctor_specializations.length === 0) {
      const specialization = DEFAULT_SPECIALIZATIONS[i % DEFAULT_SPECIALIZATIONS.length];
      await supabase.from("doctor_specializations").insert({
        id: crypto.randomUUID(),
        doctor_id: doc.user_id,
        specialization_code: slug(specialization),
        specialization_name: specialization,
      });
    }

    if (!Array.isArray(doc.doctor_languages) || doc.doctor_languages.length === 0) {
      const langRows = DEFAULT_LANGUAGES.map((lang) => ({
        id: crypto.randomUUID(),
        doctor_id: doc.user_id,
        language_code: slug(lang),
        language_name: lang,
      }));
      await supabase.from("doctor_languages").insert(langRows);
    }

    if (!Array.isArray(doc.doctor_availability) || doc.doctor_availability.length === 0) {
      const slots = [];
      for (let day = 1; day <= 5; day += 1) {
        slots.push({
          id: crypto.randomUUID(),
          doctor_id: doc.user_id,
          availability_type: "physical",
          day_of_week: day,
          start_time: "10:00",
          end_time: "17:00",
          slot_minutes: 30,
          location_label: practiceAddress,
          is_active: true,
        });
        slots.push({
          id: crypto.randomUUID(),
          doctor_id: doc.user_id,
          availability_type: "virtual",
          day_of_week: day,
          start_time: "18:00",
          end_time: "20:00",
          slot_minutes: 20,
          location_label: "Teleconsult",
          is_active: true,
        });
      }
      await supabase.from("doctor_availability").insert(slots);
    } else {
      await supabase.from("doctor_availability")
        .update({ location_label: practiceAddress })
        .eq("doctor_id", doc.user_id)
        .eq("availability_type", "physical");
    }

    const specializations =
      (doc.doctor_specializations ?? []).map((s) => s.specialization_name).filter(Boolean).join(", ") ||
      DEFAULT_SPECIALIZATIONS[i % DEFAULT_SPECIALIZATIONS.length];
    const languages =
      (doc.doctor_languages ?? []).map((l) => l.language_name).filter(Boolean).join(", ") ||
      DEFAULT_LANGUAGES.join(", ");
    const availability = availabilitySummary(doc.doctor_availability ?? []);

    exportRows.push({
      user_id: doc.user_id,
      full_name: fullName,
      email,
      mobile: phone,
      username: email,
      password: "NOT_STORED",
      highest_qualification: highestQualification,
      experience_years: experienceYears,
      medical_council_number: medicalCouncilNumber,
      government_id_number: governmentIdNumber,
      practice_address: practiceAddress,
      consultation_fee_inr: fee,
      verification_status: verificationStatus,
      specializations,
      consultation_languages: languages,
      availability_summary: availability,
    });
  }

  const headers = Object.keys(exportRows[0] ?? {});
  const lines = [headers.join(",")];
  exportRows.forEach((row) => {
    const line = headers
      .map((key) => {
        const value = row[key] ?? "";
        const escaped = String(value).replace(/"/g, '""');
        return `"${escaped}"`;
      })
      .join(",");
    lines.push(line);
  });

  const outPath = path.resolve(__dirname, "..", "..", "doctor_registration_export.csv");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Seeded missing doctor fields and exported CSV to ${outPath}`);

  if (process.env.MONGODB_URI) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const dbName = process.env.MONGODB_DB || "astikandb";
    const db = client.db(dbName);
    const collection = db.collection("employee_addresses");
    const existing = await collection.find({}).toArray();
    for (let i = 0; i < existing.length; i += 1) {
      const homeAddress = DELHI_ADDRESSES[i % DELHI_ADDRESSES.length];
      const officeAddress = DELHI_ADDRESSES[(i + 2) % DELHI_ADDRESSES.length];
      await collection.updateOne(
        { _id: existing[i]._id },
        {
          $set: {
            homeAddress,
            officeAddress,
            updatedAt: now,
          },
        },
      );
    }
    await client.close();
    console.log(`Updated ${existing.length} employee addresses to Delhi/NCR`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
