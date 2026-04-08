const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const { MongoClient } = require("mongodb");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const COMMENTS = [
  "Very attentive and explained everything clearly.",
  "Great bedside manner and quick diagnosis.",
  "Felt listened to and cared for.",
  "Professional, patient, and helpful.",
  "Clear guidance with follow-up tips.",
  "Excellent consultation and friendly approach.",
  "Helped me understand the next steps.",
  "Prompt and thorough — highly recommended.",
  "Answered all questions patiently.",
  "Efficient and reassuring visit.",
];

function seededRandom(seed) {
  const h = crypto.createHash("sha256").update(String(seed)).digest();
  let idx = 0;
  return () => {
    const value = h[idx % h.length] / 255;
    idx += 1;
    return value;
  };
}

async function main() {
  const { data: doctors, error } = await supabase.from("doctor_profiles").select("user_id");
  if (error) throw new Error(`Failed to load doctors: ${error.message}`);
  const rows = doctors ?? [];
  if (rows.length === 0) {
    console.log("No doctors found.");
    return;
  }

  const updates = [];
  const reviewDocs = [];
  const now = new Date().toISOString();

  for (const doc of rows) {
    const rand = seededRandom(doc.user_id);
    const rating = 4.6 + rand() * 0.4;
    const ratingAvg = Math.round(rating * 10) / 10;
    const ratingCount = Math.floor(45 + rand() * 180);
    updates.push({
      user_id: doc.user_id,
      rating_avg: ratingAvg,
      rating_count: ratingCount,
      updated_at: now,
    });

    const reviewCount = Math.max(3, Math.floor(3 + rand() * 6));
    for (let i = 0; i < reviewCount; i += 1) {
      const comment = COMMENTS[Math.floor(rand() * COMMENTS.length)];
      reviewDocs.push({
        _id: crypto.randomUUID(),
        doctorId: doc.user_id,
        rating: Math.round((4.6 + rand() * 0.4) * 10) / 10,
        comment,
        createdAt: new Date(Date.now() - Math.floor(rand() * 90) * 86400000),
        source: "seed",
      });
    }
  }

  for (let i = 0; i < updates.length; i += 200) {
    const batch = updates.slice(i, i + 200);
    const { error: upErr } = await supabase.from("doctor_profiles").upsert(batch);
    if (upErr) throw new Error(`Failed updating ratings: ${upErr.message}`);
  }

  if (process.env.MONGO_URI) {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db();
    const coll = db.collection("doctor_reviews");
    await coll.deleteMany({ source: "seed" });
    if (reviewDocs.length) {
      const chunk = 1000;
      for (let i = 0; i < reviewDocs.length; i += chunk) {
        await coll.insertMany(reviewDocs.slice(i, i + chunk));
      }
    }
    await client.close();
    console.log(`Seeded ${reviewDocs.length} doctor reviews in Mongo.`);
  } else {
    console.log("MONGO_URI missing; skipped doctor_reviews seeding.");
  }

  console.log(`Updated ratings for ${updates.length} doctors.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
