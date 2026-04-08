import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { enqueueOutboxEvent } from "../core/data";

type Provider = "webrtc";
type SessionStatus = "scheduled" | "live" | "completed" | "cancelled";

type SessionRecord = {
  id: string;
  appointmentId: string | null;
  companyId: string;
  employeeId: string;
  doctorId: string;
  scheduledAt: string;
  status: SessionStatus;
  activeProvider: Provider;
  failoverCount: number;
  channelName: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  createdAt: string;
  updatedAt: string;
};

type PrescriptionRecord = {
  id: string;
  appointmentId: string | null;
  teleconsultSessionId: string;
  doctorId: string;
  employeeId: string | null;
  notes: string;
  conditionSummary: string | null;
  medicines: Array<{ name: string; dosage?: string; schedule?: string; duration?: string }>;
  labTests: Array<{ name: string; instructions?: string }>;
  followUpDate: string | null;
  fileUrl: string | null;
  createdAt: string;
};

const sessionsFallback = new Map<string, SessionRecord>();
const prescriptionsFallback = new Map<string, PrescriptionRecord>();

const hasSupabase = (app: Parameters<FastifyPluginAsync>[0]) => Boolean(app.dbClients.supabase);
const hasMongo = (app: Parameters<FastifyPluginAsync>[0]) => Boolean(app.dbClients.mongo);

function buildIceServers(app: Parameters<FastifyPluginAsync>[0]) {
  const servers: Array<{ urls: string[]; username?: string; credential?: string }> = [
    { urls: ["stun:stun.l.google.com:19302"] },
    { urls: ["stun:stun1.l.google.com:19302"] },
    { urls: ["stun:stun2.l.google.com:19302"] },
  ];

  const turnUrls = (app.config.TURN_URLS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const username = (app.config.TURN_USERNAME || "").trim();
  const credential = (app.config.TURN_CREDENTIAL || "").trim();

  if (turnUrls.length > 0 && username && credential) {
    servers.push({
      urls: turnUrls,
      username,
      credential,
    });
  }

  return servers;
}

function buildRtcPayload(app: Parameters<FastifyPluginAsync>[0], params: { channelName: string }) {
  return {
    provider: "webrtc" as const,
    channelName: params.channelName,
    iceServers: buildIceServers(app),
  };
}

async function persistMongoEvent(
  app: Parameters<FastifyPluginAsync>[0],
  event: {
    teleconsultSessionId: string;
    companyId?: string;
    employeeId?: string;
    doctorId?: string;
    eventType: string;
    payload?: Record<string, unknown>;
  }
) {
  if (!hasMongo(app)) {
    return;
  }
  try {
    await app.dbClients.mongo!.collection("teleconsult_events").insertOne({
      ...event,
      source: "backend-api",
      schemaVersion: 1,
      eventAt: new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
    });
  } catch (error) {
    app.log.warn({ error }, "Skipping teleconsult Mongo event write");
  }
}

// Token persistence removed for native WebRTC signaling.

const teleconsultRoutes: FastifyPluginAsync = async (app) => {
  app.post("/sessions", async (request) => {
    const body = request.body as {
      appointmentId?: string;
      companyId: string;
      employeeId: string;
      doctorId: string;
      scheduledAt?: string;
    };

    if (!body.companyId || !body.employeeId || !body.doctorId) {
      throw new Error("companyId, employeeId and doctorId are required");
    }

    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const activeProvider: Provider = "webrtc";
    const session: SessionRecord = {
      id: sessionId,
      appointmentId: body.appointmentId ?? null,
      companyId: body.companyId,
      employeeId: body.employeeId,
      doctorId: body.doctorId,
      scheduledAt: body.scheduledAt ?? now,
      status: "scheduled",
      activeProvider,
      failoverCount: 0,
      channelName: `astikan-${sessionId.slice(0, 8)}`,
      startedAt: null,
      endedAt: null,
      durationSeconds: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (hasSupabase(app)) {
      const { error } = await app.dbClients.supabase!.from("teleconsult_sessions").insert({
        id: session.id,
        appointment_id: session.appointmentId,
        company_id: session.companyId,
        employee_id: session.employeeId,
        doctor_id: session.doctorId,
        scheduled_at: session.scheduledAt,
        status: session.status,
        active_provider: session.activeProvider,
        failover_count: session.failoverCount,
        channel_name: session.channelName,
        started_at: session.startedAt,
        ended_at: session.endedAt,
        duration_seconds: session.durationSeconds,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      });

      if (error) {
        app.log.warn({ error }, "teleconsult_sessions insert failed; using in-memory fallback");
        sessionsFallback.set(session.id, session);
      }
    } else {
      sessionsFallback.set(session.id, session);
    }

    try {
      if (hasSupabase(app)) {
        await enqueueOutboxEvent(app, {
          event_type: "teleconsult.session.created",
          aggregate_type: "teleconsult_session",
          aggregate_id: session.id,
          payload: {
            companyId: session.companyId,
            employeeId: session.employeeId,
            doctorId: session.doctorId,
            provider: session.activeProvider,
          },
          idempotency_key: `teleconsult-session-created:${session.id}`,
        });
      }
    } catch (error) {
      app.log.warn({ error }, "Failed to enqueue teleconsult created event");
    }

    await persistMongoEvent(app, {
      teleconsultSessionId: session.id,
      companyId: session.companyId,
      employeeId: session.employeeId,
      doctorId: session.doctorId,
      eventType: "session_created",
      payload: { provider: session.activeProvider },
    });

    const employeeRtc = buildRtcPayload(app, { channelName: session.channelName });

    return {
      status: "ok",
      data: {
        sessionId: session.id,
        status: session.status,
        provider: session.activeProvider,
        channelName: session.channelName,
        rtc: employeeRtc,
      },
    };
  });

  app.post("/sessions/:id/join", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      participantType?: "employee" | "doctor";
      participantId?: string;
      allowEarlyJoin?: boolean;
    };

    let session: SessionRecord | null = null;
    if (hasSupabase(app)) {
      const { data } = await app.dbClients.supabase!
        .from("teleconsult_sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (data) {
        session = {
          id: data.id,
          appointmentId: data.appointment_id,
          companyId: data.company_id,
          employeeId: data.employee_id,
          doctorId: data.doctor_id,
          scheduledAt: data.scheduled_at,
          status: data.status,
          activeProvider: data.active_provider,
          failoverCount: data.failover_count ?? 0,
          channelName: data.channel_name ?? `astikan-${id.slice(0, 8)}`,
          startedAt: data.started_at ?? null,
          endedAt: data.ended_at ?? null,
          durationSeconds: data.duration_seconds ?? 0,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
      }
    }

    if (!session) {
      session = sessionsFallback.get(id) ?? null;
    }

    if (!session) {
      throw new Error("Teleconsult session not found");
    }

    const scheduledAtMs = Date.parse(session.scheduledAt);
    const joinWindowStart = new Date(scheduledAtMs - 60 * 1000).toISOString();
    const joinWindowEnd = new Date(scheduledAtMs + 30 * 60 * 1000).toISOString();
    const now = Date.now();
    if (Number.isFinite(scheduledAtMs) && now < scheduledAtMs - 60 * 1000 && !body.allowEarlyJoin) {
      return {
        status: "error",
        message: "Teleconsult can be joined only within 1 minute of the scheduled time.",
        data: {
          joinWindowStart,
          joinWindowEnd,
        },
      };
    }

    session.status = "live";
    session.activeProvider = "webrtc";
    session.updatedAt = new Date().toISOString();
    session.startedAt = session.startedAt ?? session.updatedAt;

    if (hasSupabase(app)) {
      const { error } = await app.dbClients.supabase!
        .from("teleconsult_sessions")
        .update({
          status: session.status,
          active_provider: session.activeProvider,
          failover_count: session.failoverCount,
          started_at: session.startedAt,
          updated_at: session.updatedAt,
        })
        .eq("id", session.id);

      if (error) {
        app.log.warn({ error }, "teleconsult_sessions update failed; using in-memory state");
      }
    }
    sessionsFallback.set(session.id, session);

    await persistMongoEvent(app, {
      teleconsultSessionId: session.id,
      companyId: session.companyId,
      employeeId: session.employeeId,
      doctorId: session.doctorId,
      eventType: "participant_joined",
      payload: {
        participantType: body.participantType ?? "employee",
        participantId: body.participantId ?? null,
        provider: session.activeProvider,
        failoverCount: session.failoverCount,
      },
    });

    const rtcPayload = buildRtcPayload(app, { channelName: session.channelName });

    return {
      status: "ok",
      data: {
        sessionId: session.id,
        sessionStatus: session.status,
        provider: session.activeProvider,
        failoverCount: session.failoverCount,
        channelName: session.channelName,
        joinWindowStart,
        joinWindowEnd,
        rtc: rtcPayload,
      },
    };
  });

  app.post("/sessions/:id/prescription", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      appointmentId?: string;
      doctorId: string;
      employeeId?: string;
      notes: string;
      conditionSummary?: string;
      medicines?: Array<{ name: string; dosage?: string; schedule?: string; duration?: string }>;
      labTests?: Array<{ name: string; instructions?: string }>;
      followUpDate?: string;
      fileUrl?: string;
    };

    if (!body.doctorId || !body.notes) {
      throw new Error("doctorId and notes are required");
    }

    const prescription: PrescriptionRecord = {
      id: crypto.randomUUID(),
      appointmentId: body.appointmentId ?? null,
      teleconsultSessionId: id,
      doctorId: body.doctorId,
      employeeId: body.employeeId ?? null,
      notes: body.notes,
      conditionSummary: body.conditionSummary ?? null,
      medicines: Array.isArray(body.medicines) ? body.medicines : [],
      labTests: Array.isArray(body.labTests) ? body.labTests : [],
      followUpDate: body.followUpDate ?? null,
      fileUrl: body.fileUrl ?? null,
      createdAt: new Date().toISOString(),
    };

    if (hasSupabase(app)) {
      const { error } = await app.dbClients.supabase!.from("prescription_headers").insert({
        id: prescription.id,
        appointment_id: prescription.appointmentId,
        teleconsult_session_id: prescription.teleconsultSessionId,
        doctor_id: prescription.doctorId,
        employee_id: prescription.employeeId,
        notes: prescription.notes,
        condition_summary: prescription.conditionSummary,
        medicines_json: prescription.medicines,
        follow_up_date: prescription.followUpDate,
        file_url: prescription.fileUrl,
        created_at: prescription.createdAt,
      });
      if (error) {
        app.log.warn({ error }, "prescription_headers insert failed; using in-memory fallback");
      }
    }
    prescriptionsFallback.set(id, prescription);

    await persistMongoEvent(app, {
      teleconsultSessionId: id,
      employeeId: body.employeeId,
      doctorId: body.doctorId,
      eventType: "prescription_created",
      payload: {
        prescriptionId: prescription.id,
        medicineCount: prescription.medicines.length,
        labTestCount: prescription.labTests.length,
      },
    });

    return {
      status: "ok",
      data: {
        prescriptionId: prescription.id,
        teleconsultSessionId: prescription.teleconsultSessionId,
      },
    };
  });

  app.get("/sessions/:id/prescription", async (request) => {
    const { id } = request.params as { id: string };

    if (hasSupabase(app)) {
      const { data } = await app.dbClients.supabase!
        .from("prescription_headers")
        .select("*")
        .eq("teleconsult_session_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        return {
          status: "ok",
          data: {
            id: data.id,
            appointmentId: data.appointment_id ?? null,
            teleconsultSessionId: data.teleconsult_session_id,
            doctorId: data.doctor_id,
            employeeId: data.employee_id ?? null,
            notes: data.notes ?? "",
            conditionSummary: data.condition_summary ?? null,
            medicines: data.medicines_json ?? [],
            labTests: [],
            followUpDate: data.follow_up_date ?? null,
            fileUrl: data.file_url ?? null,
            createdAt: data.created_at,
          },
        };
      }
    }

    const fallback = prescriptionsFallback.get(id);
    if (!fallback) {
      return {
        status: "ok",
        data: null,
      };
    }

    return {
      status: "ok",
      data: fallback,
    };
  });

  app.post("/sessions/:id/complete", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      completedBy?: string;
      endedAt?: string;
    };

    let session: SessionRecord | null = null;
    if (hasSupabase(app)) {
      const { data } = await app.dbClients.supabase!
        .from("teleconsult_sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (data) {
        session = {
          id: data.id,
          appointmentId: data.appointment_id,
          companyId: data.company_id,
          employeeId: data.employee_id,
          doctorId: data.doctor_id,
          scheduledAt: data.scheduled_at,
          status: data.status,
          activeProvider: data.active_provider,
          failoverCount: data.failover_count ?? 0,
          channelName: data.channel_name ?? `astikan-${id.slice(0, 8)}`,
          startedAt: data.started_at ?? null,
          endedAt: data.ended_at ?? null,
          durationSeconds: data.duration_seconds ?? 0,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
      }
    }

    if (!session) {
      session = sessionsFallback.get(id) ?? null;
    }
    if (!session) {
      throw new Error("Teleconsult session not found");
    }

    const endedAt = body.endedAt ?? new Date().toISOString();
    const startedAt = session.startedAt ?? session.createdAt;
    const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));

    session.status = "completed";
    session.endedAt = endedAt;
    session.updatedAt = endedAt;
    session.durationSeconds = durationSeconds;
    sessionsFallback.set(session.id, session);

    if (hasSupabase(app)) {
      const { error } = await app.dbClients.supabase!
        .from("teleconsult_sessions")
        .update({
          status: "completed",
          ended_at: endedAt,
          duration_seconds: durationSeconds,
          updated_at: endedAt,
        })
        .eq("id", id);
      if (error) {
        app.log.warn({ error }, "teleconsult_sessions completion update failed");
      }

      if (session.appointmentId) {
        await app.dbClients.supabase!
          .from("appointments")
          .update({ status: "completed", updated_at: endedAt })
          .eq("id", session.appointmentId);
      }
    }

    await persistMongoEvent(app, {
      teleconsultSessionId: id,
      companyId: session.companyId,
      employeeId: session.employeeId,
      doctorId: session.doctorId,
      eventType: "session_completed",
      payload: {
        completedBy: body.completedBy ?? null,
        durationSeconds,
      },
    });

    return {
      status: "ok",
      data: {
        sessionId: id,
        sessionStatus: "completed",
        durationSeconds,
      },
    };
  });
};

export default teleconsultRoutes;
