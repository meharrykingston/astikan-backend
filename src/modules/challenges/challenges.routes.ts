import type { FastifyPluginAsync } from "fastify";
import { requireMongo, requireSupabase } from "../core/data";
import { buildAiService } from "../ai/ai.service";

type WeekendChallenge = {
  id: string;
  slug: string;
  title: string;
  description: string;
  points: number;
  category: "Physical" | "Mental" | "Health" | "Lifestyle";
  difficulty: "Easy" | "Medium" | "Hard";
  duration: string;
};

function getWeekStartDateISO(date = new Date()) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay();
  const diff = (day + 6) % 7; // Monday as start
  utc.setUTCDate(utc.getUTCDate() - diff);
  return utc.toISOString().slice(0, 10);
}

const challengesRoutes: FastifyPluginAsync = async (app) => {
  const aiService = buildAiService(app.config);
  app.get("/weekend", async (request) => {
    const { employeeId } = request.query as { employeeId?: string };
    if (!employeeId) {
      return { status: "error", message: "Missing employeeId" };
    }

    const supabase = requireSupabase(app);
    const weekStart = getWeekStartDateISO();

    const { data: challenges, error: challengeError } = await supabase
      .from("weekend_challenges")
      .select("id, slug, title, description, points, category, difficulty, duration")
      .eq("active", true)
      .order("points", { ascending: false });

    if (challengeError) {
      throw new Error(`Failed to load challenges: ${challengeError.message}`);
    }

    const { data: completions, error: completionError } = await supabase
      .from("weekend_challenge_completions")
      .select("challenge_id")
      .eq("employee_id", employeeId)
      .eq("week_start", weekStart);

    if (completionError) {
      throw new Error(`Failed to load completions: ${completionError.message}`);
    }

    const completedIds = new Set((completions ?? []).map((item) => item.challenge_id));
    const payload = (challenges ?? []).map((challenge) => ({
      ...challenge,
      completed: completedIds.has(challenge.id),
    }));

    return {
      status: "ok",
      data: {
        weekStart,
        challenges: payload,
      },
    };
  });

  app.post("/weekend/complete", async (request) => {
    const body = request.body as { employeeId?: string; challengeId?: string };
    if (!body.employeeId || !body.challengeId) {
      return { status: "error", message: "Missing employeeId or challengeId" };
    }

    const supabase = requireSupabase(app);
    const weekStart = getWeekStartDateISO();

    const { error } = await supabase.from("weekend_challenge_completions").upsert(
      {
        employee_id: body.employeeId,
        challenge_id: body.challengeId,
        week_start: weekStart,
        completed_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,challenge_id,week_start" }
    );

    if (error) {
      throw new Error(`Failed to mark completion: ${error.message}`);
    }

    return {
      status: "ok",
      data: {
        weekStart,
        challengeId: body.challengeId,
      },
    };
  });

  app.get("/sugar", async (request) => {
    const { employeeId, companyId } = request.query as { employeeId?: string; companyId?: string };
    if (!employeeId) {
      return { status: "error", message: "Missing employeeId" };
    }
    const mongo = requireMongo(app);
    const record = await mongo
      .collection("sugar_challenge_progress")
      .findOne({ employeeId, companyId: companyId ?? null });
    return { status: "ok", data: { state: record?.state ?? null } };
  });

  app.post("/sugar/save", async (request) => {
    const body = request.body as {
      employeeId?: string;
      companyId?: string;
      state?: Record<string, unknown>;
    };
    if (!body.employeeId) {
      return { status: "error", message: "Missing employeeId" };
    }
    const mongo = requireMongo(app);
    const now = new Date().toISOString();
    await mongo.collection("sugar_challenge_progress").updateOne(
      { employeeId: body.employeeId, companyId: body.companyId ?? null },
      {
        $set: {
          employeeId: body.employeeId,
          companyId: body.companyId ?? null,
          state: body.state ?? {},
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
    return { status: "ok", data: { stored: true } };
  });

  app.post("/sugar/coach", async (request) => {
    const body = request.body as {
      employeeId?: string;
      day?: number;
      sugarTotal?: number;
      limit?: number;
      meals?: Array<{ title?: string; sugar?: number }>;
      question?: string;
    };
    if (!body.employeeId) {
      return { status: "error", message: "Missing employeeId" };
    }
    const summary = `Day ${body.day ?? 1}. Sugar ${body.sugarTotal ?? 0}g of ${body.limit ?? 25}g.`;
    const question = body.question || "Give quick guidance for today.";
    try {
      const ai = await aiService.chat({
        message: `${summary}\nMeals: ${(body.meals ?? [])
          .map((m) => `${m.title ?? "Meal"} ${m.sugar ?? 0}g`)
          .join(", ")}\nUser: ${question}`,
        temperature: 0.4,
        maxTokens: 220,
      });
      return { status: "ok", data: { reply: ai.reply } };
    } catch {
      return {
        status: "ok",
        data: {
          reply:
            "Nice progress so far. Reduce liquid sugars first, then swap sweet snacks with fruit or nuts. Ask me a meal and I’ll estimate sugar.",
        },
      };
    }
  });

  app.get("/leaderboard", async (request) => {
    const { type, companyId, employeeId } = request.query as {
      type?: string;
      companyId?: string;
      employeeId?: string;
    };
    if (type !== "sugar") {
      return { status: "error", message: "Unknown leaderboard type" };
    }
    const mongo = requireMongo(app);
    const match: Record<string, unknown> = {};
    if (companyId) match.companyId = companyId;
    const rows = await mongo
      .collection("sugar_challenge_progress")
      .find(match)
      .project({ employeeId: 1, companyId: 1, state: 1 })
      .toArray();
    const scores = rows.map((row) => {
      const state = (row as any).state ?? {};
      return {
        employeeId: row.employeeId,
        coins: Number(state.coins ?? 0),
        completedDays: Number(state.completedDays ?? 0),
      };
    });
    scores.sort((a, b) => b.coins - a.coins || b.completedDays - a.completedDays);
    const top = scores.slice(0, 10);
    const rank = employeeId ? scores.findIndex((row) => row.employeeId === employeeId) + 1 : null;
    return { status: "ok", data: { leaderboard: top, rank: rank || null } };
  });
};

export default challengesRoutes;
