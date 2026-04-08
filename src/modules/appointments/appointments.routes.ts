import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { enqueueOutboxEvent, requireMongo, requireSupabase } from "../core/data";

const appointmentsFallback = new Map<string, Record<string, any>>();

const appointmentsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (request) => {
    const body = request.body as {
      companyId: string;
      employeeId?: string;
      patientId?: string;
      doctorId: string;
      createdByUserId: string;
      appointmentType: "teleconsult" | "opd";
      source: "astikan_assigned" | "doctor_added_patient" | "freelance_case" | "admin_created" | "employee_booked";
      scheduledStart: string;
      scheduledEnd: string;
      status?: string;
      reason?: string;
      patientSummary?: string;
      symptomSnapshot?: Record<string, unknown>;
      aiTriageSummary?: string;
      meetingJoinWindowStart?: string;
      meetingJoinWindowEnd?: string;
      clinicLocation?: string;
      patientEtaMinutes?: number;
    };

    const supabase = app.dbClients.supabase;
    const mongo = app.dbClients.mongo;
    const now = new Date().toISOString();
    const appointmentId = crypto.randomUUID();
    const record = {
      id: appointmentId,
      company_id: body.companyId,
      employee_id: body.employeeId ?? null,
      patient_id: body.patientId ?? null,
      doctor_id: body.doctorId,
      created_by_user_id: body.createdByUserId,
      appointment_type: body.appointmentType,
      source: body.source,
      scheduled_start: body.scheduledStart,
      scheduled_end: body.scheduledEnd,
      status: body.status ?? "scheduled",
      reason: body.reason ?? null,
      patient_summary: body.patientSummary ?? null,
      symptom_snapshot_json: body.symptomSnapshot ?? {},
      ai_triage_summary: body.aiTriageSummary ?? null,
      meeting_join_window_start: body.meetingJoinWindowStart ?? null,
      meeting_join_window_end: body.meetingJoinWindowEnd ?? null,
      created_at: now,
      updated_at: now,
    };

    if (supabase) {
      const { error } = await supabase.from("appointments").insert(record);
      if (error) {
        app.log.warn({ error }, "appointments insert failed; using fallback");
        appointmentsFallback.set(appointmentId, record);
      } else {
        appointmentsFallback.delete(appointmentId);
      }

      const { error: historyError } = await supabase.from("appointment_status_history").insert({
        id: crypto.randomUUID(),
        appointment_id: appointmentId,
        old_status: null,
        new_status: body.status ?? "scheduled",
        changed_by: body.createdByUserId,
        change_reason: "appointment_created",
        created_at: now,
      });
      if (historyError) {
        app.log.warn({ error: historyError }, "appointment_status_history insert failed");
      }

      if (body.appointmentType === "opd") {
        const { error: opdError } = await supabase.from("opd_visits").insert({
          id: crypto.randomUUID(),
          appointment_id: appointmentId,
          company_id: body.companyId,
          employee_id: body.employeeId ?? null,
          patient_id: body.patientId ?? null,
          doctor_id: body.doctorId,
          clinic_location: body.clinicLocation ?? null,
          patient_eta_minutes: body.patientEtaMinutes ?? null,
          status: body.status === "confirmed" ? "scheduled" : body.status ?? "scheduled",
        });
        if (opdError) {
          app.log.warn({ error: opdError }, "opd_visits insert failed");
        }
      }
    } else {
      appointmentsFallback.set(appointmentId, record);
    }

    if (mongo) {
      try {
        await mongo.collection("appointment_events").insertOne({
          appointmentId,
          companyId: body.companyId,
          employeeId: body.employeeId ?? null,
          patientId: body.patientId ?? null,
          doctorId: body.doctorId,
          eventType: "appointment_created",
          payload: {
            appointmentType: body.appointmentType,
            source: body.source,
            status: body.status ?? "scheduled",
          },
          source: "backend-api",
          eventAt: now,
          ingestedAt: now,
          schemaVersion: 1,
        });
      } catch (error) {
        app.log.warn({ error }, "Skipping appointment_events Mongo insert");
      }
    }

    if (supabase) {
      try {
        await enqueueOutboxEvent(app, {
          event_type: "appointment.created",
          aggregate_type: "appointment",
          aggregate_id: appointmentId,
          payload: {
            companyId: body.companyId,
            employeeId: body.employeeId ?? null,
            doctorId: body.doctorId,
            appointmentType: body.appointmentType,
          },
          idempotency_key: `appointment-created:${appointmentId}`,
        });
      } catch (error) {
        app.log.warn({ error }, "Failed to enqueue appointment created event");
      }
    }

    return { status: "ok", data: { appointmentId } };
  });

  app.get("/", async (request) => {
    const query = request.query as {
      companyId?: string;
      doctorId?: string;
      employeeId?: string;
      patientId?: string;
      status?: string;
      appointmentType?: "teleconsult" | "opd";
      limit?: number;
    };

    const supabase = app.dbClients.supabase;
    const limit = Math.min(Number(query.limit ?? 100) || 100, 250);

    const formatFallback = (items: Record<string, any>[]) => ({
      status: "ok",
      data: items.map((item) => ({
        ...item,
        opd_visits: item.appointment_type === "opd" ? { patient_eta_minutes: item.patient_eta_minutes ?? null, clinic_location: item.clinic_location ?? null, status: item.status } : null,
        employee_name: null,
        employee_avatar_url: null,
        doctor_name: null,
        doctor_avatar_url: null,
        patient_name: item.patient_summary ?? "Patient",
        patient_age: null,
        patient_gender: null,
        patient_phone: null,
        patient_avatar_url: null,
      })),
    });

    if (!supabase) {
      const fallbackItems = Array.from(appointmentsFallback.values());
      return formatFallback(fallbackItems.slice(0, limit));
    }

    let dbQuery = supabase
      .from("appointments")
      .select("*, opd_visits(patient_eta_minutes, clinic_location, status)")
      .order("scheduled_start", { ascending: true })
      .limit(limit);
    if (query.companyId) dbQuery = dbQuery.eq("company_id", query.companyId);
    if (query.doctorId) dbQuery = dbQuery.eq("doctor_id", query.doctorId);
    if (query.employeeId) dbQuery = dbQuery.eq("employee_id", query.employeeId);
    if (query.patientId) dbQuery = dbQuery.eq("patient_id", query.patientId);
    if (query.status) dbQuery = dbQuery.eq("status", query.status);
    if (query.appointmentType) dbQuery = dbQuery.eq("appointment_type", query.appointmentType);

    const { data, error } = await dbQuery;
    if (error) {
      app.log.warn({ error }, "Failed to list appointments; using fallback");
      const fallbackItems = Array.from(appointmentsFallback.values());
      return formatFallback(fallbackItems.slice(0, limit));
    }
    const appointments = data ?? [];
    const appointmentIds = appointments.map((item) => item.id).filter(Boolean);
    const employeeIds = appointments.map((item) => item.employee_id).filter(Boolean);
    const doctorIds = appointments.map((item) => item.doctor_id).filter(Boolean);
    const patientIds = appointments.map((item) => item.patient_id).filter(Boolean);
    const userIds = Array.from(new Set([...employeeIds, ...doctorIds]));
    const { data: teleconsultSessions } = appointmentIds.length
      ? await supabase
          .from("teleconsult_sessions")
          .select("id, appointment_id, company_id, employee_id, doctor_id, scheduled_at, status")
          .in("appointment_id", appointmentIds)
      : { data: [] as Array<Record<string, any>> };
    const teleconsultSessionMap = new Map<string, Array<Record<string, any>>>();
    for (const session of teleconsultSessions ?? []) {
      const bucket = teleconsultSessionMap.get(session.appointment_id) ?? [];
      bucket.push(session);
      teleconsultSessionMap.set(session.appointment_id, bucket);
    }

    const { data: users } = userIds.length
      ? await supabase.from("app_users").select("id, full_name, avatar_url").in("id", userIds)
      : { data: [] as Array<{ id: string; full_name?: string; avatar_url?: string }> };
    const { data: patients } = patientIds.length
      ? await supabase.from("patient_profiles").select("id, full_name, age, gender, phone").in("id", patientIds)
      : { data: [] as Array<{ id: string; full_name?: string; age?: number; gender?: string; phone?: string }> };

    const userMap = new Map((users ?? []).map((item) => [item.id, item]));
    const patientMap = new Map((patients ?? []).map((item) => [item.id, item]));

    return {
      status: "ok",
      data: appointments.map((item) => {
        const employee = item.employee_id ? userMap.get(item.employee_id) : null;
        const doctor = item.doctor_id ? userMap.get(item.doctor_id) : null;
        const patient = item.patient_id ? patientMap.get(item.patient_id) : null;
        return {
          ...item,
          teleconsult_sessions: teleconsultSessionMap.get(item.id) ?? [],
          employee_name: employee?.full_name ?? null,
          employee_avatar_url: employee?.avatar_url ?? null,
          doctor_name: doctor?.full_name ?? null,
          doctor_avatar_url: doctor?.avatar_url ?? null,
          patient_name: patient?.full_name ?? employee?.full_name ?? item.patient_summary ?? "Patient",
          patient_age: patient?.age ?? null,
          patient_gender: patient?.gender ?? null,
          patient_phone: patient?.phone ?? null,
          patient_avatar_url: employee?.avatar_url ?? null,
        };
      }),
    };
  });

  app.get("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const supabase = app.dbClients.supabase;

    if (!supabase) {
      const fallback = appointmentsFallback.get(id) ?? null;
      return { status: "ok", data: fallback };
    }

    const { data, error } = await supabase
      .from("appointments")
      .select("*, appointment_status_history(*), teleconsult_sessions(*), opd_visits(*), consultation_reviews(*)")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      app.log.warn({ error }, "Failed to fetch appointment; using fallback");
      const fallback = appointmentsFallback.get(id) ?? null;
      return { status: "ok", data: fallback };
    }

    return { status: "ok", data };
  });

  app.post("/:id/status", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      status: "scheduled" | "confirmed" | "underway" | "completed" | "rescheduled" | "cancelled" | "no_show";
      changedBy: string;
      changeReason?: string;
    };

    const supabase = requireSupabase(app);
    const mongo = requireMongo(app);
    const now = new Date().toISOString();

    const { data: existing, error: readError } = await supabase.from("appointments").select("*").eq("id", id).maybeSingle();
    if (readError || !existing) {
      throw new Error("Appointment not found");
    }

    const { error } = await supabase
      .from("appointments")
      .update({ status: body.status, updated_at: now })
      .eq("id", id);
    if (error) {
      throw new Error(`Failed to update appointment status: ${error.message}`);
    }

    await supabase.from("appointment_status_history").insert({
      id: crypto.randomUUID(),
      appointment_id: id,
      old_status: existing.status,
      new_status: body.status,
      changed_by: body.changedBy,
      change_reason: body.changeReason ?? null,
      created_at: now,
    });

    if (existing.appointment_type === "opd") {
      await supabase
        .from("opd_visits")
        .update({
          status:
            body.status === "underway"
              ? "underway"
              : body.status === "completed"
                ? "completed"
                : body.status === "rescheduled"
                  ? "rescheduled"
                  : body.status === "cancelled"
                    ? "cancelled"
                    : existing.status,
          updated_at: now,
        })
        .eq("appointment_id", id);
    }

    await mongo.collection("appointment_events").insertOne({
      appointmentId: id,
      companyId: existing.company_id,
      employeeId: existing.employee_id,
      patientId: existing.patient_id,
      doctorId: existing.doctor_id,
      eventType: "appointment_status_changed",
      payload: {
        oldStatus: existing.status,
        newStatus: body.status,
        changeReason: body.changeReason ?? null,
      },
      source: "backend-api",
      eventAt: now,
      ingestedAt: now,
      schemaVersion: 1,
    });

    return { status: "ok", data: { appointmentId: id, status: body.status } };
  });
};

export default appointmentsRoutes;
