import type { FastifyPluginAsync } from "fastify";
import { requireMongo } from "../core/data";
import crypto from "node:crypto";

type Badge = {
  id: string;
  title: string;
  subtitle: string;
  rarity: "Common" | "Rare" | "Epic";
  target: number;
};

type LeaderRow = {
  employeeId: string;
  name: string;
  initials: string;
  coins: number;
  badges: number;
  level: number;
  streak: number;
  trend: number;
  isYou?: boolean;
};

const BADGES: Badge[] = [
  { id: "hydration", title: "Hydration Hero", subtitle: "Hit water goal for 7 days", rarity: "Common", target: 7 },
  { id: "steps", title: "10K Streak", subtitle: "10,000 steps for 5 days", rarity: "Common", target: 5 },
  { id: "sleep", title: "Sleep Champion", subtitle: "7+ hrs sleep for 5 days", rarity: "Common", target: 5 },
  { id: "mindful", title: "Mindful Minute", subtitle: "Meditate 10 mins for 7 days", rarity: "Rare", target: 7 },
  { id: "sugar", title: "Low Sugar", subtitle: "Stay under limit for 10 days", rarity: "Rare", target: 10 },
  { id: "weekly", title: "Weekend Warrior", subtitle: "Complete 4 weekend tasks", rarity: "Epic", target: 4 },
  { id: "weight", title: "Healthy Balance", subtitle: "Log weight weekly for 6 weeks", rarity: "Epic", target: 6 },
  { id: "stress", title: "Stress Slayer", subtitle: "Use calm tools 10 times", rarity: "Rare", target: 10 },
  { id: "checkup", title: "Health Check", subtitle: "Complete 3 health checks", rarity: "Common", target: 3 },
  { id: "leader", title: "Leaderboard Star", subtitle: "Reach top 10 in rank", rarity: "Epic", target: 10 },
];

const SAMPLE_NAMES = [
  "Sarah Johnson",
  "Michael Chen",
  "Emily Rodriguez",
  "David Kim",
  "Jessica Taylor",
  "Aarav Sharma",
  "Riya Gupta",
  "Vikram Singh",
  "Ananya Kapoor",
  "Neha Verma",
  "Priya Nair",
  "Arjun Mehta",
];

function seedRandom(seed: string) {
  const hash = crypto.createHash("sha256").update(seed).digest();
  let idx = 0;
  return () => {
    const value = hash[idx % hash.length] / 255;
    idx += 1;
    return value;
  };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "ME";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

async function ensureEmployeeGamification(mongo: ReturnType<typeof requireMongo>, employeeId: string, companyId?: string | null) {
  const collection = mongo.collection("employee_gamification");
  let doc = await collection.findOne({ employeeId, companyId: companyId ?? null });
  if (doc) return doc;

  const rand = seedRandom(employeeId);
  const coins = Math.floor(900 + rand() * 5200);
  const streak = Math.floor(3 + rand() * 32);
  const level = Math.floor(6 + rand() * 18);
  const badgesUnlocked = Math.floor(3 + rand() * 10);

  const badgeProgress = BADGES.map((badge) => {
    const progress = Math.min(100, Math.floor(rand() * 120));
    return { id: badge.id, progress, unlocked: progress >= 100 };
  });

  doc = {
    employeeId,
    companyId: companyId ?? null,
    coins,
    streak,
    level,
    badgesUnlocked,
    badgeProgress,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await collection.insertOne(doc as any);
  return doc;
}

async function ensureLeaderboard(mongo: ReturnType<typeof requireMongo>, companyId?: string | null) {
  const collection = mongo.collection("gamification_leaderboard");
  const rows = await collection.find({ companyId: companyId ?? null }).toArray();
  if (rows.length >= 8) return rows;

  const now = new Date().toISOString();
  const seed = seedRandom(String(companyId ?? "global"));
  const inserts: LeaderRow[] = [];
  for (let i = 0; i < 8; i += 1) {
    const name = SAMPLE_NAMES[i % SAMPLE_NAMES.length];
    inserts.push({
      employeeId: crypto.randomUUID(),
      name,
      initials: initials(name),
      coins: Math.floor(2800 + seed() * 4000),
      badges: Math.floor(8 + seed() * 18),
      level: Math.floor(12 + seed() * 16),
      streak: Math.floor(10 + seed() * 30),
      trend: seed() > 0.6 ? 1 : seed() < 0.3 ? -1 : 0,
      companyId: companyId ?? null,
      createdAt: now,
    } as any);
  }
  await collection.insertMany(inserts as any[]);
  return collection.find({ companyId: companyId ?? null }).toArray();
}

const gamificationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/summary", async (request) => {
    const { employeeId, companyId } = request.query as { employeeId?: string; companyId?: string };
    if (!employeeId) {
      return { status: "error", message: "Missing employeeId" };
    }
    const mongo = requireMongo(app);
    const doc: any = await ensureEmployeeGamification(mongo, employeeId, companyId ?? null);

    const milestones = [
      { label: "500 coins", badge: "Bronze Badge", progress: 100, claimed: true },
      { label: "1000 coins", badge: "Silver Badge", progress: doc.coins >= 1000 ? 100 : Math.floor((doc.coins / 1000) * 100), claimed: doc.coins >= 1000 },
      { label: "2000 coins", badge: "Gold Badge", progress: Math.min(100, Math.floor((doc.coins / 2000) * 100)), claimed: doc.coins >= 2000 },
      { label: "5000 coins", badge: "Platinum Badge", progress: Math.min(100, Math.floor((doc.coins / 5000) * 100)), claimed: doc.coins >= 5000 },
    ];

    const transactions = [
      { title: "Completed Weekend Challenge", meta: "Weekend Task", value: 500 },
      { title: "Daily Meditation - 7 day", meta: "Mental Health", value: 350 },
      { title: "10,000 Steps Achievement", meta: "Physical Health", value: 200 },
      { title: "Hydration Goal Met", meta: "Health Goal", value: 100 },
      { title: "Premium Health Report", meta: "Service", value: -300 },
    ];

    return {
      status: "ok",
      data: {
        coins: doc.coins,
        streak: doc.streak,
        level: doc.level,
        rank: doc.rank ?? null,
        badgesUnlocked: doc.badgesUnlocked,
        milestones,
        transactions,
      },
    };
  });

  app.get("/badges", async (request) => {
    const { employeeId, companyId } = request.query as { employeeId?: string; companyId?: string };
    if (!employeeId) {
      return { status: "error", message: "Missing employeeId" };
    }
    const mongo = requireMongo(app);
    const doc: any = await ensureEmployeeGamification(mongo, employeeId, companyId ?? null);
    const leaderboard = (await ensureLeaderboard(mongo, companyId ?? null)) as any[];

    const topRanks = leaderboard.slice(0, 3).map((item, idx) => ({
      initials: item.initials ?? initials(item.name),
      name: item.name,
      coins: item.coins,
      badges: item.badges,
      tone: idx === 0 ? "silver" : idx === 1 ? "gold" : "bronze",
    }));

    const rankings = leaderboard.slice(0, 5).map((item, idx) => ({
      rank: idx + 1,
      initials: item.initials ?? initials(item.name),
      name: item.name,
      level: item.level ?? 12,
      streak: item.streak ?? 20,
      coins: item.coins,
      badges: item.badges,
      trend: item.trend ?? 0,
    }));

    rankings.push({
      rank: 42,
      initials: initials("You"),
      name: "You",
      level: doc.level,
      streak: doc.streak,
      coins: doc.coins,
      badges: doc.badgesUnlocked,
      trend: 1,
      isYou: true,
    });

    const badgeCollection = BADGES.map((badge) => {
      const progressEntry = doc.badgeProgress?.find((row: any) => row.id === badge.id);
      const progress = progressEntry ? progressEntry.progress : 0;
      return {
        title: badge.title,
        subtitle: badge.subtitle,
        rarity: badge.rarity,
        unlocked: Boolean(progressEntry?.unlocked),
        progress: Math.min(100, progress),
      };
    });

    return {
      status: "ok",
      data: {
        yourRank: 42,
        level: doc.level,
        streak: doc.streak,
        coins: doc.coins,
        badgesUnlocked: doc.badgesUnlocked,
        topRanks,
        rankings,
        badgeCollection,
      },
    };
  });
};

export default gamificationRoutes;
