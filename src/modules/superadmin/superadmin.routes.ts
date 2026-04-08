import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { ObjectId } from "mongodb";
import { requireMongoBucket, requireSupabase } from "../core/data";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function to12Hour(time?: string | null) {
  if (!time) return "";
  const [hh, mm] = time.split(":").map(Number);
  const hours = Number.isFinite(hh) ? hh : 0;
  const minutes = Number.isFinite(mm) ? mm : 0;
  const meridiem = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(displayHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

function to24Hour(time?: string | null) {
  if (!time) return null;
  const [rawTime, meridiem] = time.split(" ");
  const [rawHours, rawMinutes] = rawTime.split(":").map(Number);
  let hours = rawHours;
  if (meridiem?.toUpperCase() === "PM" && hours !== 12) hours += 12;
  if (meridiem?.toUpperCase() === "AM" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${String(rawMinutes || 0).padStart(2, "0")}:00`;
}

function hashPassword(password: string, saltHex: string) {
  return crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
}

function createPasswordHash(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = hashPassword(password, salt);
  return `scrypt$${salt}$${digest}`;
}

function randomPassword(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function buildCompanyCode(name: string) {
  const base = name.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8) || "ASTIKAN";
  const year = new Date().getFullYear();
  const suffix = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${base}${year}${suffix}`;
}

function buildUsername(name: string) {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 10) || "corp";
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${base}${suffix}`;
}

const superadminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/doctors", async (request) => {
    const query = request.query as { limit?: number; offset?: number };
    const supabase = requireSupabase(app);
    const limit = Math.min(Number(query.limit ?? 100) || 100, 500);
    const offset = Math.max(Number(query.offset ?? 0) || 0, 0);
    const configuredBase = (app.config.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
    const forwardedHost = request.headers["x-forwarded-host"];
    const hostHeader = request.headers.host;
    const forwardedProto = request.headers["x-forwarded-proto"];
    const requestHost =
      (typeof forwardedHost === "string" && forwardedHost) ||
      (typeof hostHeader === "string" && hostHeader) ||
      request.hostname;
    const requestProto =
      (typeof forwardedProto === "string" && forwardedProto) || request.protocol;
    const requestBase = `${requestProto}://${requestHost}`;
    const baseUrl = configuredBase || requestBase;

    const resolveImage = (value?: string | null) => {
      if (!value) return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("http") || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
        return trimmed;
      }
      if (trimmed.startsWith("/")) {
        return configuredBase ? `${baseUrl}${trimmed}` : trimmed;
      }
      return configuredBase
        ? `${baseUrl}/assets/${trimmed.replace(/^assets\//, "")}`
        : `/assets/${trimmed.replace(/^assets\//, "")}`;
    };

    const { data: profiles, error, count: totalCount } = await supabase
      .from("doctor_profiles")
      .select("user_id, full_display_name, email, mobile, verification_status, updated_at", { count: "exact" })
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

    const normalizeStatus = (profileStatus?: string | null, userStatus?: string | null) => {
      if (userStatus === "inactive" || profileStatus === "rejected") return "Inactive";
      if (profileStatus === "verified") return "Active";
      if (profileStatus === "submitted" || profileStatus === "in_review") return "Pending KYC";
      return "Pending";
    };

    const pageRows = (profiles ?? []).map((profile) => {
      const user = userMap.get(profile.user_id);
      const login = loginMap.get(profile.user_id);
      const email = profile.email ?? user?.email ?? "";
      const isFakeEmail = email.trim().toLowerCase().endsWith("@doctor.astikan.local");
      return {
        id: profile.user_id,
        name: user?.full_name ?? profile.full_display_name ?? "Doctor",
        username: login?.identifier ?? profile.mobile ?? user?.phone ?? "",
        password: "********",
        email: isFakeEmail ? "" : email,
        phone: profile.mobile ?? user?.phone ?? "",
        specialty: "General Physician",
        status: normalizeStatus(profile.verification_status ?? null, user?.status ?? null),
        image: resolveImage(user?.avatar_url ?? null),
      };
    });

    const { data: allProfiles } = await supabase
      .from("doctor_profiles")
      .select("user_id, verification_status");
    const allIds = (allProfiles ?? []).map((row) => row.user_id).filter(Boolean);
    const { data: allUsers } = allIds.length
      ? await supabase.from("app_users").select("id, status").in("id", allIds)
      : { data: [] as Array<{ id: string; status?: string }> };
    const allUserMap = new Map((allUsers ?? []).map((u) => [u.id, u]));

    let activeCount = 0;
    let pendingCount = 0;
    let kycCount = 0;
    let inactiveCount = 0;
    for (const profile of allProfiles ?? []) {
      const user = allUserMap.get(profile.user_id);
      const status = normalizeStatus(profile.verification_status ?? null, user?.status ?? null);
      if (status === "Inactive") inactiveCount += 1;
      else if (status === "Active") activeCount += 1;
      else if (status === "Pending KYC") kycCount += 1;
      else pendingCount += 1;
    }

    const filteredMeta = {
      total: totalCount ?? pageRows.length,
      active: activeCount,
      pending: pendingCount,
      kyc: kycCount,
      inactive: inactiveCount,
    };

    return {
      status: "ok",
      data: {
        rows: pageRows,
        meta: filteredMeta,
      },
    };
  });

  app.get("/companies", async (request) => {
    const query = request.query as { limit?: number; offset?: number };
    const supabase = requireSupabase(app);
    const limit = Math.min(Number(query.limit ?? 100) || 100, 500);
    const offset = Math.max(Number(query.offset ?? 0) || 0, 0);

    const { data: rows, error, count: totalCount } = await supabase
      .from("companies")
      .select("id, name, email, contact_name, contact_phone, status, created_at, metadata_json", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Failed to fetch companies: ${error.message}`);
    }

    const { data: allStatuses } = await supabase.from("companies").select("status");
    let activeCount = 0;
    let pendingCount = 0;
    let inactiveCount = 0;
    for (const company of allStatuses ?? []) {
      const status = String(company.status ?? "").toLowerCase();
      if (status === "active") activeCount += 1;
      else if (status === "inactive") inactiveCount += 1;
      else pendingCount += 1;
    }

    const companyIds = (rows ?? []).map((company) => company.id).filter(Boolean);

    const { data: accessCodes } = companyIds.length
      ? await supabase
          .from("company_access_codes")
          .select("company_id, code, code_type")
          .in("company_id", companyIds)
          .eq("code_type", "corporate_portal")
      : { data: [] as Array<{ company_id?: string; code?: string; code_type?: string }> };

    const { data: loginAccounts } = companyIds.length
      ? await supabase
          .from("login_accounts")
          .select("company_id, identifier, identifier_type, role")
          .in("company_id", companyIds)
          .eq("role", "corporate_admin")
          .eq("identifier_type", "username")
      : { data: [] as Array<{ company_id?: string; identifier?: string; identifier_type?: string; role?: string }> };

    const accessMap = new Map((accessCodes ?? []).map((code) => [code.company_id, code.code]));
    const loginMap = new Map((loginAccounts ?? []).map((account) => [account.company_id, account.identifier]));

    return {
      status: "ok",
      data: {
        rows: (rows ?? []).map((company) => ({
          id: company.id,
          name: company.name ?? "",
          hrName: company.contact_name ?? "",
          email: company.email ?? "",
          phone: company.contact_phone ?? "",
          companyCode: accessMap.get(company.id) ?? "",
          username:
            loginMap.get(company.id) ??
            (company as any).metadata_json?.portal_username ??
            (company as any).metadata_json?.username ??
            "",
          password:
            (company as any).metadata_json?.portal_password ??
            (company as any).metadata_json?.password ??
            (company as any).metadata_json?.corporate_password ??
            "",
          applicationId: (company as any).metadata_json?.application_id ?? "",
          metadata: (company as any).metadata_json ?? {},
          status: company.status ?? "pending",
        })),
        meta: {
          total: totalCount ?? (allStatuses?.length ?? rows?.length ?? 0),
          active: activeCount,
          pending: pendingCount,
          inactive: inactiveCount,
        },
      },
    };
  });

  app.post("/companies/:id/approve", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      transactionId?: string;
      chequeUpload?: { name?: string; type?: string; size?: number; dataUrl?: string } | null;
      paymentNotes?: string;
    };

    const supabase = requireSupabase(app);
    const { data: company, error } = await supabase
      .from("companies")
      .select("id, name, email, contact_name, contact_phone, status, metadata_json")
      .eq("id", id)
      .maybeSingle();

    if (error || !company) {
      throw new Error("Company not found.");
    }

    if (String(company.status ?? "").toLowerCase() !== "pending") {
      throw new Error("Only pending companies can be approved.");
    }

    const username = buildUsername(company.name ?? "corporate");
    const password = randomPassword(10);
    const companyCode = buildCompanyCode(company.name ?? "ASTIKAN");
    const now = new Date().toISOString();

    const userId = crypto.randomUUID();
    await supabase.from("app_users").upsert({
      id: userId,
      primary_role: "corporate_admin",
      full_name: company.contact_name ?? `${company.name} Admin`,
      email: company.email ?? null,
      phone: company.contact_phone ?? null,
      status: "active",
      updated_at: now,
    });

    await supabase.from("login_accounts").upsert(
      {
        id: crypto.randomUUID(),
        user_id: userId,
        company_id: company.id,
        role: "corporate_admin",
        identifier_type: "username",
        identifier: username,
        password_hash: createPasswordHash(password),
        status: "active",
        updated_at: now,
      },
      { onConflict: "identifier_type,identifier" }
    );

    await supabase.from("company_access_codes").insert({
      id: crypto.randomUUID(),
      company_id: company.id,
      code: companyCode,
      label: company.name ?? "Corporate",
      code_type: "corporate_portal",
      created_at: now,
    });

    const metadata = {
      ...(company as any).metadata_json,
      portal_username: username,
      portal_password: password,
      payment: {
        transaction_id: body.transactionId ?? null,
        cheque_upload: body.chequeUpload ?? null,
        notes: body.paymentNotes ?? null,
        approved_at: now,
      },
    };

    await supabase
      .from("companies")
      .update({
        status: "active",
        metadata_json: metadata,
        updated_at: now,
      })
      .eq("id", company.id);

    return {
      status: "ok",
      data: {
        id: company.id,
        companyCode,
        username,
        password,
        status: "active",
      },
    };
  });

  app.delete("/companies/:id", async (request) => {
    const { id } = request.params as { id: string };
    const supabase = requireSupabase(app);

    await supabase.from("company_access_codes").delete().eq("company_id", id);
    await supabase.from("login_accounts").delete().eq("company_id", id);
    await supabase.from("company_credit_wallets").delete().eq("company_id", id);
    await supabase.from("company_credit_policies").delete().eq("company_id", id);

    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) {
      throw new Error(`Failed to delete company: ${error.message}`);
    }

    return { status: "ok", data: { id } };
  });

  app.get("/doctors/:id", async (request) => {
    const { id } = request.params as { id: string };
    const supabase = requireSupabase(app);
    const baseUrl =
      (app.config.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "") ||
      `${request.protocol}://${request.hostname}`;

    const resolveImage = (value?: string | null) => {
      if (!value) return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("http") || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
        return trimmed;
      }
      if (trimmed.startsWith("/")) {
        return `${baseUrl}${trimmed}`;
      }
      return `${baseUrl}/assets/${trimmed.replace(/^assets\//, "")}`;
    };

    const { data: profile, error } = await supabase
      .from("doctor_profiles")
      .select("*, doctor_specializations(*), doctor_languages(*), doctor_availability(*), doctor_verification_documents(*)")
      .eq("user_id", id)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to fetch doctor profile: ${error.message}`);
    }

    const { data: user } = await supabase.from("app_users").select("id, full_name, email, phone, avatar_url, status").eq("id", id).maybeSingle();
    const { data: login } = await supabase
      .from("login_accounts")
      .select("identifier, identifier_type")
      .eq("user_id", id)
      .eq("role", "doctor")
      .maybeSingle();

    const availability = Array.isArray(profile?.doctor_availability) ? profile?.doctor_availability : [];
    const physicalSlots = availability.filter((slot: { availability_type?: string }) => slot.availability_type === "physical");
    const virtualSlots = availability.filter((slot: { availability_type?: string }) => slot.availability_type === "virtual");

    const opdDays = physicalSlots
      .map((slot: { day_of_week?: number }) => DAY_LABELS[slot.day_of_week ?? 0])
      .filter(Boolean);
    const uniqueOpdDays = Array.from(new Set(opdDays));

    const opdFrom = physicalSlots.length ? to12Hour(physicalSlots[0].start_time) : "";
    const opdTo = physicalSlots.length ? to12Hour(physicalSlots[0].end_time) : "";
    const teleSlots = virtualSlots.map((slot: { start_time?: string; end_time?: string }) => {
      const start = to12Hour(slot.start_time);
      const end = to12Hour(slot.end_time);
      return start && end ? `${start} - ${end}` : "";
    }).filter(Boolean);

    const documents = Array.isArray(profile?.doctor_verification_documents) ? profile?.doctor_verification_documents : [];
    const govtDoc = documents.find((doc: { document_type?: string }) => doc.document_type === "government_id");
    const licenseDoc = documents.find((doc: { document_type?: string }) => doc.document_type === "license_certificate");
    const documentList = documents.map((doc: {
      id?: string;
      document_type?: string;
      file_name?: string;
      storage_key?: string;
      verification_status?: string;
    }) => ({
      id: doc.id ?? null,
      type: doc.document_type ?? "document",
      fileName: doc.file_name ?? "",
      storageKey: doc.storage_key ?? "",
      status: doc.verification_status ?? "uploaded",
      downloadUrl: doc.id ? `${baseUrl}/api/superadmin/doctors/${id}/documents/${doc.id}/download` : "",
    }));

    const profilePhoto = documents.find((doc: { document_type?: string }) => doc.document_type === "profile_photo");
    const resolvedImage = user?.avatar_url
      ? resolveImage(user.avatar_url)
      : profilePhoto?.id
        ? `${baseUrl}/api/superadmin/doctors/${id}/documents/${profilePhoto.id}/download`
        : null;

    return {
      status: "ok",
      data: {
        id,
        name: user?.full_name ?? profile?.full_display_name ?? "Doctor",
        username: login?.identifier ?? profile?.mobile ?? user?.phone ?? "",
        password: "********",
        email: profile?.email ?? user?.email ?? "",
        phone: profile?.mobile ?? user?.phone ?? "",
        specialty: profile?.doctor_specializations?.[0]?.specialization_name ?? "General Physician",
        status: user?.status === "inactive" ? "Inactive" : profile?.verification_status ?? "Pending",
        image: resolvedImage,
        highestQualification: profile?.highest_qualification ?? "",
        experienceYears: profile?.experience_years ?? null,
        shortBio: profile?.short_bio ?? "",
        practiceAddress: profile?.practice_address ?? "",
        consultationFeeInr: profile?.consultation_fee_inr ?? 0,
        medicalCouncilNumber: profile?.medical_council_number ?? "",
        governmentIdNumber: profile?.government_id_number ?? "",
        verificationStatus: profile?.verification_status ?? "draft",
        specializations: Array.isArray(profile?.doctor_specializations)
          ? profile?.doctor_specializations.map((item: { specialization_name?: string }) => item.specialization_name).filter(Boolean)
          : [],
        languages: Array.isArray(profile?.doctor_languages)
          ? profile?.doctor_languages.map((item: { language_name?: string }) => item.language_name).filter(Boolean)
          : [],
        availability: {
          virtualAvailable: virtualSlots.length > 0,
          physicalAvailable: physicalSlots.length > 0,
          opdDays: uniqueOpdDays,
          opdFrom,
          opdTo,
          teleSlots,
        },
        documents: {
          governmentIdDocumentId: govtDoc?.id ?? null,
          licenseDocumentId: licenseDoc?.id ?? null,
        },
        documentList,
      },
    };
  });

  app.get("/doctors/:id/documents/:docId/download", async (request, reply) => {
    const { id, docId } = request.params as { id: string; docId: string };
    const supabase = requireSupabase(app);
    const bucket = requireMongoBucket(app);

    const { data: doc, error } = await supabase
      .from("doctor_verification_documents")
      .select("id, doctor_id, storage_key, file_name, mime_type")
      .eq("id", docId)
      .eq("doctor_id", id)
      .maybeSingle();
    if (error || !doc) {
      reply.code(404);
      return { status: "error", message: "Document not found" };
    }

    const storageKey = doc.storage_key ?? "";
    const fileName = doc.file_name ?? "document";
    const mimeType = doc.mime_type ?? "application/octet-stream";
    reply.header("Content-Type", mimeType);
    reply.header("Content-Disposition", `inline; filename="${fileName}"`);

    let stream;
    try {
      if (ObjectId.isValid(storageKey)) {
        stream = bucket.openDownloadStream(new ObjectId(storageKey));
      } else {
        stream = bucket.openDownloadStreamByName(storageKey);
      }
    } catch {
      reply.code(404);
      return { status: "error", message: "Document not found" };
    }

    return reply.send(stream);
  });

  app.post("/doctors", async (request) => {
    const body = request.body as {
      name?: string;
      username?: string;
      password?: string;
      email?: string;
      phone?: string;
      specialty?: string;
      status?: string;
      image?: string;
      highestQualification?: string;
      experienceYears?: number;
      shortBio?: string;
      practiceAddress?: string;
      consultationFeeInr?: number;
      medicalCouncilNumber?: string;
      governmentIdNumber?: string;
      verificationStatus?: string;
      specializations?: string[];
      languages?: string[];
      availability?: {
        virtualAvailable?: boolean;
        physicalAvailable?: boolean;
        opdDays?: string[];
        opdFrom?: string;
        opdTo?: string;
        teleSlots?: string[];
      };
    };

    const supabase = requireSupabase(app);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const email = body.email?.trim() || `${id.slice(0, 8)}@doctor.astikan.local`;

    const { error: authError } = await supabase.auth.admin.createUser({
      id,
      email,
      phone: body.phone ?? undefined,
      email_confirm: true,
      phone_confirm: Boolean(body.phone),
      password: body.password || undefined,
      user_metadata: { role: "doctor" },
    });
    if (authError) {
      throw new Error(`Failed to create auth user: ${authError.message}`);
    }

    await supabase.from("app_users").insert({
      id,
      primary_role: "doctor",
      full_name: body.name ?? null,
      email,
      phone: body.phone ?? null,
      avatar_url: body.image ?? null,
      status: body.status === "Inactive" ? "inactive" : "active",
      updated_at: now,
    });

    await supabase.from("doctor_profiles").insert({
      user_id: id,
      full_display_name: body.name ?? null,
      email,
      mobile: body.phone ?? null,
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

    if (Array.isArray(body.specializations) && body.specializations.length) {
      await supabase.from("doctor_specializations").insert(
        body.specializations.map((name) => ({
          id: crypto.randomUUID(),
          doctor_id: id,
          specialization_code: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
          specialization_name: name,
        }))
      );
    }

    if (Array.isArray(body.languages) && body.languages.length) {
      await supabase.from("doctor_languages").insert(
        body.languages.map((name) => ({
          id: crypto.randomUUID(),
          doctor_id: id,
          language_code: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
          language_name: name,
        }))
      );
    }

    if (body.username) {
      await supabase.from("login_accounts").insert({
        id: crypto.randomUUID(),
        user_id: id,
        company_id: null,
        role: "doctor",
        identifier_type: "mobile",
        identifier: body.username,
        password_hash: body.password ? createPasswordHash(body.password) : null,
        status: "active",
        updated_at: now,
      });
    }

    if (body.availability) {
      const slots = [];
      if (body.availability.virtualAvailable && Array.isArray(body.availability.teleSlots)) {
        for (const slot of body.availability.teleSlots) {
          const [start, end] = slot.split(" - ");
          slots.push({
            id: crypto.randomUUID(),
            doctor_id: id,
            availability_type: "virtual",
            day_of_week: 1,
            start_time: to24Hour(start) ?? "09:00:00",
            end_time: to24Hour(end) ?? "09:30:00",
            slot_minutes: 30,
            location_label: "Teleconsultation",
            is_active: true,
          });
        }
      }
      if (body.availability.physicalAvailable && Array.isArray(body.availability.opdDays)) {
        for (const day of body.availability.opdDays) {
          const index = DAY_LABELS.indexOf(day);
          slots.push({
            id: crypto.randomUUID(),
            doctor_id: id,
            availability_type: "physical",
            day_of_week: index >= 0 ? index : 1,
            start_time: to24Hour(body.availability.opdFrom) ?? "10:00:00",
            end_time: to24Hour(body.availability.opdTo) ?? "18:00:00",
            slot_minutes: 30,
            location_label: body.practiceAddress ?? "Clinic",
            is_active: true,
          });
        }
      }
      if (slots.length) {
        await supabase.from("doctor_availability").insert(slots);
      }
    }

    return { status: "ok", data: { id } };
  });

  app.put("/doctors/:id/full", async (request) => {
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
      highestQualification?: string;
      experienceYears?: number;
      shortBio?: string;
      practiceAddress?: string;
      consultationFeeInr?: number;
      medicalCouncilNumber?: string;
      governmentIdNumber?: string;
      verificationStatus?: string;
      specializations?: string[];
      languages?: string[];
      availability?: {
        virtualAvailable?: boolean;
        physicalAvailable?: boolean;
        opdDays?: string[];
        opdFrom?: string;
        opdTo?: string;
        teleSlots?: string[];
      };
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

    if (Array.isArray(body.specializations)) {
      await supabase.from("doctor_specializations").delete().eq("doctor_id", id);
      if (body.specializations.length) {
        await supabase.from("doctor_specializations").insert(
          body.specializations.map((name) => ({
            id: crypto.randomUUID(),
            doctor_id: id,
            specialization_code: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
            specialization_name: name,
          }))
        );
      }
    }

    if (Array.isArray(body.languages)) {
      await supabase.from("doctor_languages").delete().eq("doctor_id", id);
      if (body.languages.length) {
        await supabase.from("doctor_languages").insert(
          body.languages.map((name) => ({
            id: crypto.randomUUID(),
            doctor_id: id,
            language_code: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
            language_name: name,
          }))
        );
      }
    }

    await supabase.from("doctor_availability").delete().eq("doctor_id", id);
    if (body.availability) {
      const slots = [];
      if (body.availability.virtualAvailable && Array.isArray(body.availability.teleSlots)) {
        for (const slot of body.availability.teleSlots) {
          const [start, end] = slot.split(" - ");
          slots.push({
            id: crypto.randomUUID(),
            doctor_id: id,
            availability_type: "virtual",
            day_of_week: 1,
            start_time: to24Hour(start) ?? "09:00:00",
            end_time: to24Hour(end) ?? "09:30:00",
            slot_minutes: 30,
            location_label: "Teleconsultation",
            is_active: true,
          });
        }
      }
      if (body.availability.physicalAvailable && Array.isArray(body.availability.opdDays)) {
        for (const day of body.availability.opdDays) {
          const index = DAY_LABELS.indexOf(day);
          slots.push({
            id: crypto.randomUUID(),
            doctor_id: id,
            availability_type: "physical",
            day_of_week: index >= 0 ? index : 1,
            start_time: to24Hour(body.availability.opdFrom) ?? "10:00:00",
            end_time: to24Hour(body.availability.opdTo) ?? "18:00:00",
            slot_minutes: 30,
            location_label: body.practiceAddress ?? "Clinic",
            is_active: true,
          });
        }
      }
      if (slots.length) {
        await supabase.from("doctor_availability").insert(slots);
      }
    }

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

  app.delete("/doctors/:id", async (request) => {
    const { id } = request.params as { id: string };
    const supabase = requireSupabase(app);
    await supabase.from("doctor_specializations").delete().eq("doctor_id", id);
    await supabase.from("doctor_languages").delete().eq("doctor_id", id);
    await supabase.from("doctor_availability").delete().eq("doctor_id", id);
    await supabase.from("doctor_verification_documents").delete().eq("doctor_id", id);
    await supabase.from("doctor_profiles").delete().eq("user_id", id);
    await supabase.from("login_accounts").delete().eq("user_id", id).eq("role", "doctor");
    await supabase.from("app_users").delete().eq("id", id);
    try {
      await supabase.auth.admin.deleteUser(id);
    } catch {
      // ignore
    }
    return { status: "ok", data: { id } };
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
