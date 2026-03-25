import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { requireSupabase } from "../core/data";

function hashPassword(password: string, saltHex: string) {
  return crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
}

function createPasswordHash(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = hashPassword(password, salt);
  return `scrypt$${salt}$${digest}`;
}

const superadminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/doctors", async (request) => {
    const query = request.query as { limit?: number; offset?: number };
    const supabase = requireSupabase(app);
    const limit = Math.min(Number(query.limit ?? 100) || 100, 500);
    const offset = Math.max(Number(query.offset ?? 0) || 0, 0);

    const { data: profiles, error } = await supabase
      .from("doctor_profiles")
      .select("user_id, full_display_name, email, mobile, verification_status, updated_at")
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Failed to fetch doctors: ${error.message}`);
    }

    const userIds = (profiles ?? []).map((row) => row.user_id).filter(Boolean);
    const { data: users } = userIds.length
      ? await supabase.from("app_users").select("id, full_name, email, phone, avatar_url, status").in("id", userIds)
      : { data: [] as Array<{ id: string; full_name?: string; email?: string; phone?: string; avatar_url?: string; status?: string }> };

    const { data: logins } = userIds.length
      ? await supabase
          .from("login_accounts")
          .select("user_id, identifier, identifier_type")
          .eq("role", "doctor")
          .in("user_id", userIds)
      : { data: [] as Array<{ user_id: string; identifier?: string; identifier_type?: string }> };

    const userMap = new Map((users ?? []).map((u) => [u.id, u]));
    const loginMap = new Map((logins ?? []).map((l) => [l.user_id, l]));

    return {
      status: "ok",
      data: (profiles ?? []).map((profile) => {
        const user = userMap.get(profile.user_id);
        const login = loginMap.get(profile.user_id);
        return {
          id: profile.user_id,
          name: user?.full_name ?? profile.full_display_name ?? "Doctor",
          username: login?.identifier ?? profile.mobile ?? user?.phone ?? "",
          password: "********",
          email: profile.email ?? user?.email ?? "",
          phone: profile.mobile ?? user?.phone ?? "",
          specialty: "General Physician",
          status: user?.status === "inactive" ? "Inactive" : profile.verification_status ?? "Pending",
          image: user?.avatar_url ?? null,
        };
      }),
    };
  });

  app.put("/doctors/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      username?: string;
      password?: string;
      email?: string;
      phone?: string;
      specialty?: string;
      status?: string;
      image?: string;
    };

    const supabase = requireSupabase(app);
    const now = new Date().toISOString();

    await supabase.from("app_users").upsert({
      id,
      full_name: body.name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      avatar_url: body.image ?? null,
      status: body.status === "Inactive" ? "inactive" : "active",
      updated_at: now,
    });

    await supabase.from("doctor_profiles").upsert({
      user_id: id,
      full_display_name: body.name ?? null,
      email: body.email ?? null,
      mobile: body.phone ?? null,
      verification_status: body.status ?? "Pending",
      updated_at: now,
    });

    if (body.username) {
      await supabase.from("login_accounts").upsert({
        id: crypto.randomUUID(),
        user_id: id,
        company_id: null,
        role: "doctor",
        identifier_type: "mobile",
        identifier: body.username,
        status: "active",
        updated_at: now,
      }, { onConflict: "identifier_type,identifier" });
    }

    if (body.password) {
      await supabase.from("login_accounts").update({
        password_hash: createPasswordHash(body.password),
        updated_at: now,
      }).eq("user_id", id).eq("role", "doctor");
    }

    return { status: "ok", data: { id } };
  });
};

export default superadminRoutes;
