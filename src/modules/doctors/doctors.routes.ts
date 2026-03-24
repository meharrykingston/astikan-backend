import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { enqueueOutboxEvent, requireMongo, requireSupabase } from "../core/data";
import { ensureDoctorPrincipal } from "../core/identity";
import { uploadBase64ToGridFs } from "../core/mongo-upload";

const doctorsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/bootstrap", async (request) => {
    const body = request.body as {
      email?: string;
      phone?: string;
      fullName?: string;
      handle?: string;
      specialization?: string;
    };

    const doctor = await ensureDoctorPrincipal(app, body);
    return {
      status: "ok",
      data: doctor,
    };
  });

  app.get("/", async (request) => {
    const query = request.query as {
      search?: string;
      verificationStatus?: string;
      specialization?: string;
      limit?: number;
      offset?: number;
    };

    const supabase = requireSupabase(app);
    const limit = Math.min(Number(query.limit ?? 50) || 50, 100);
    const offset = Math.max(Number(query.offset ?? 0) || 0, 0);
    const search = query.search?.trim();

    let dbQuery = supabase
      .from("doctor_profiles")
      .select("*, doctor_specializations(*), doctor_languages(*), doctor_availability(*), doctor_verification_documents(*)")
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (query.verificationStatus) {
      dbQuery = dbQuery.eq("verification_status", query.verificationStatus);
    }

    if (search) {
      dbQuery = dbQuery.or(`full_display_name.ilike.%${search}%,doctor_code.ilike.%${search}%,mobile.ilike.%${search}%`);
    }

    const { data, error } = await dbQuery;
    if (error) {
      throw new Error(`Failed to list doctors: ${error.message}`);
    }

    const filtered = query.specialization
      ? (data ?? []).filter((doctor) =>
          Array.isArray(doctor.doctor_specializations) &&
          doctor.doctor_specializations.some(
            (item: { specialization_code?: string; specialization_name?: string }) =>
              item.specialization_code === query.specialization || item.specialization_name === query.specialization
          )
        )
      : (data ?? []);

    const userIds = filtered.map((doctor) => doctor.user_id).filter(Boolean);
    const { data: users } = userIds.length
      ? await supabase.from("app_users").select("id, full_name, avatar_url, email, phone").in("id", userIds)
      : { data: [] as Array<{ id: string; full_name?: string; avatar_url?: string; email?: string; phone?: string }> };
    const userMap = new Map((users ?? []).map((item) => [item.id, item]));

    return {
      status: "ok",
      data: filtered.map((doctor) => {
        const user = userMap.get(doctor.user_id);
        return {
          ...doctor,
          full_name: user?.full_name ?? doctor.full_display_name,
          avatar_url: user?.avatar_url ?? null,
          email: doctor.email ?? user?.email ?? null,
          mobile: doctor.mobile ?? user?.phone ?? null,
        };
      }),
    };
  });

  app.get("/:userId", async (request) => {
    const { userId } = request.params as { userId: string };
    const supabase = requireSupabase(app);

    const { data, error } = await supabase
      .from("doctor_profiles")
      .select("*, doctor_specializations(*), doctor_languages(*), doctor_availability(*), doctor_verification_documents(*)")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch doctor profile: ${error.message}`);
    }

    const { data: user } = await supabase.from("app_users").select("id, full_name, avatar_url, email, phone").eq("id", userId).maybeSingle();

    return {
      status: "ok",
      data: data
        ? {
            ...data,
            full_name: user?.full_name ?? data.full_display_name,
            avatar_url: user?.avatar_url ?? null,
            email: data.email ?? user?.email ?? null,
            mobile: data.mobile ?? user?.phone ?? null,
          }
        : null,
    };
  });

  app.put("/:userId/profile", async (request) => {
    const { userId } = request.params as { userId: string };
    const body = request.body as {
      primaryRole?: "doctor";
      fullName?: string;
      email?: string;
      phone?: string;
      avatarUrl?: string;
      fullDisplayName?: string;
      mobile?: string;
      shortBio?: string;
      highestQualification?: string;
      experienceYears?: number;
      medicalCouncilNumber?: string;
      governmentIdNumber?: string;
      practiceAddress?: string;
      consultationFeeInr?: number;
      verificationStatus?: string;
      specializations?: Array<{ code: string; name: string }>;
      languages?: Array<{ code: string; name: string }>;
    };

    const supabase = requireSupabase(app);
    const now = new Date().toISOString();

    const { error: userError } = await supabase.from("app_users").upsert({
      id: userId,
      primary_role: body.primaryRole ?? "doctor",
      full_name: body.fullName ?? body.fullDisplayName ?? null,
      email: body.email ?? null,
      phone: body.phone ?? body.mobile ?? null,
      avatar_url: body.avatarUrl ?? null,
      status: body.verificationStatus === "suspended" ? "inactive" : "active",
      updated_at: now,
    });
    if (userError) {
      throw new Error(`Failed to upsert app user: ${userError.message}`);
    }

    const { error: profileError } = await supabase.from("doctor_profiles").upsert({
      user_id: userId,
      full_display_name: body.fullDisplayName ?? body.fullName ?? null,
      email: body.email ?? null,
      mobile: body.mobile ?? body.phone ?? null,
      short_bio: body.shortBio ?? null,
      highest_qualification: body.highestQualification ?? null,
      experience_years: body.experienceYears ?? null,
      medical_council_number: body.medicalCouncilNumber ?? null,
      government_id_number: body.governmentIdNumber ?? null,
      practice_address: body.practiceAddress ?? null,
      consultation_fee_inr: body.consultationFeeInr ?? 0,
      verification_status: body.verificationStatus ?? "draft",
      updated_at: now,
    });
    if (profileError) {
      throw new Error(`Failed to upsert doctor profile: ${profileError.message}`);
    }

    if (Array.isArray(body.specializations)) {
      await supabase.from("doctor_specializations").delete().eq("doctor_id", userId);
      if (body.specializations.length) {
        const { error } = await supabase.from("doctor_specializations").insert(
          body.specializations.map((item) => ({
            id: crypto.randomUUID(),
            doctor_id: userId,
            specialization_code: item.code,
            specialization_name: item.name,
          }))
        );
        if (error) {
          throw new Error(`Failed to replace doctor specializations: ${error.message}`);
        }
      }
    }

    if (Array.isArray(body.languages)) {
      await supabase.from("doctor_languages").delete().eq("doctor_id", userId);
      if (body.languages.length) {
        const { error } = await supabase.from("doctor_languages").insert(
          body.languages.map((item) => ({
            id: crypto.randomUUID(),
            doctor_id: userId,
            language_code: item.code,
            language_name: item.name,
          }))
        );
        if (error) {
          throw new Error(`Failed to replace doctor languages: ${error.message}`);
        }
      }
    }

    await enqueueOutboxEvent(app, {
      event_type: "doctor.profile.upserted",
      aggregate_type: "doctor_profile",
      aggregate_id: userId,
      payload: { userId },
      idempotency_key: `doctor-profile-upserted:${userId}:${now}`,
    });

    return { status: "ok", data: { userId } };
  });

  app.put("/:userId/availability", async (request) => {
    const { userId } = request.params as { userId: string };
    const body = request.body as {
      slots: Array<{
        availabilityType: "virtual" | "physical";
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        slotMinutes?: number;
        locationLabel?: string;
        isActive?: boolean;
      }>;
    };

    const supabase = requireSupabase(app);
    await supabase.from("doctor_availability").delete().eq("doctor_id", userId);

    if (Array.isArray(body.slots) && body.slots.length) {
      const { error } = await supabase.from("doctor_availability").insert(
        body.slots.map((slot) => ({
          id: crypto.randomUUID(),
          doctor_id: userId,
          availability_type: slot.availabilityType,
          day_of_week: slot.dayOfWeek,
          start_time: slot.startTime,
          end_time: slot.endTime,
          slot_minutes: slot.slotMinutes ?? 30,
          location_label: slot.locationLabel ?? null,
          is_active: slot.isActive ?? true,
        }))
      );
      if (error) {
        throw new Error(`Failed to replace doctor availability: ${error.message}`);
      }
    }

    return { status: "ok", data: { userId, slots: body.slots?.length ?? 0 } };
  });

  app.post("/:userId/documents", async (request) => {
    const { userId } = request.params as { userId: string };
    const body = request.body as {
      documentType: "government_id" | "license_certificate" | "other_certificate" | "profile_photo";
      fileName: string;
      mimeType: string;
      storageKey?: string;
      fileSizeBytes?: number;
      fileBase64?: string;
    };

    const supabase = requireSupabase(app);
    const mongo = requireMongo(app);
    const documentId = crypto.randomUUID();
    const uploaded = body.fileBase64
      ? await uploadBase64ToGridFs(app, {
          fileName: body.fileName,
          mimeType: body.mimeType,
          fileBase64: body.fileBase64,
          metadata: {
            doctorId: userId,
            documentType: body.documentType,
          },
        })
      : null;
    const resolvedStorageKey = uploaded?.fileId ?? body.storageKey ?? `doctor-docs/${userId}/${documentId}/${body.fileName}`;

    const { error } = await supabase.from("doctor_verification_documents").insert({
      id: documentId,
      doctor_id: userId,
      document_type: body.documentType,
      file_name: body.fileName,
      mime_type: body.mimeType,
      storage_provider: "mongo_gridfs",
      storage_key: resolvedStorageKey,
      file_size_bytes: uploaded?.sizeBytes ?? body.fileSizeBytes ?? 0,
      verification_status: "uploaded",
    });
    if (error) {
      throw new Error(`Failed to create doctor document metadata: ${error.message}`);
    }

    await mongo.collection("document_metadata").insertOne({
      ownerId: userId,
      documentType: body.documentType,
      gridFsFileId: resolvedStorageKey,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: uploaded?.sizeBytes ?? body.fileSizeBytes ?? 0,
      linkedTable: "doctor_verification_documents",
      linkedId: documentId,
      createdAt: new Date().toISOString(),
      schemaVersion: 1,
    });

    return { status: "ok", data: { documentId, storageKey: resolvedStorageKey } };
  });

  app.post("/:userId/verify", async (request) => {
    const { userId } = request.params as { userId: string };
    const body = request.body as {
      verificationStatus: "verified" | "rejected" | "in_review" | "submitted";
      reviewedBy?: string;
      reviewNotes?: string;
      documentIds?: string[];
    };

    const supabase = requireSupabase(app);
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("doctor_profiles")
      .update({
        verification_status: body.verificationStatus,
        verified_by: body.reviewedBy ?? null,
        verified_at: body.verificationStatus === "verified" ? now : null,
        updated_at: now,
      })
      .eq("user_id", userId);
    if (error) {
      throw new Error(`Failed to update doctor verification status: ${error.message}`);
    }

    if (Array.isArray(body.documentIds) && body.documentIds.length) {
      const targetStatus = body.verificationStatus === "rejected" ? "rejected" : "accepted";
      const { error: docError } = await supabase
        .from("doctor_verification_documents")
        .update({
          verification_status: targetStatus,
          review_notes: body.reviewNotes ?? null,
          reviewed_by: body.reviewedBy ?? null,
          reviewed_at: now,
        })
        .in("id", body.documentIds);
      if (docError) {
        throw new Error(`Failed to update doctor documents: ${docError.message}`);
      }
    }

    await enqueueOutboxEvent(app, {
      event_type: "doctor.verification.updated",
      aggregate_type: "doctor_profile",
      aggregate_id: userId,
      payload: {
        userId,
        verificationStatus: body.verificationStatus,
      },
      idempotency_key: `doctor-verification-updated:${userId}:${body.verificationStatus}:${now}`,
    });

    return { status: "ok", data: { userId, verificationStatus: body.verificationStatus } };
  });
};

export default doctorsRoutes;
