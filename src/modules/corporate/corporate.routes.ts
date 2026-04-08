import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";

type RegistrationPayload = {
  companyName: string;
  pan: string;
  gstNo: string;
  address: string;
  entityType: string;
  incorporationDate: string;
  employeeCount?: number;
  referralCode?: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  documents: {
    gst: DocumentUpload;
    pan: DocumentUpload;
    incorporation: DocumentUpload;
    insurer?: DocumentUpload | null;
    msme?: DocumentUpload | null;
    labourCompliance?: DocumentUpload | null;
  };
  authorizedSignature: DocumentUpload;
  signedAgreement: DocumentUpload;
  agreementText: string;
};

type DocumentUpload = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

type RegistrationRecord = {
  applicationId: string;
  companyId: string;
  companyName: string;
  contactEmail: string;
  contactPhone: string;
  status: "pending" | "active" | "rejected";
  submittedAt: string;
};

const registrationsFallback = new Map<string, RegistrationRecord>();

const corporateRoutes: FastifyPluginAsync = async (app) => {
  app.post("/registrations", async (request) => {
    const body = request.body as RegistrationPayload;

    if (!body.companyName || !body.pan || !body.gstNo || !body.address || !body.incorporationDate) {
      throw new Error("Missing required company information.");
    }
    if (!body.contactName || !body.contactEmail || !body.contactPhone) {
      throw new Error("Authorized contact details are required.");
    }
    if (!body.documents?.gst || !body.documents?.pan || !body.documents?.incorporation) {
      throw new Error("GST, PAN, and incorporation documents are required.");
    }
    if (!body.authorizedSignature || !body.signedAgreement) {
      throw new Error("Signature and signed agreement are required.");
    }

    const applicationId = `APP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const companyId = crypto.randomUUID();
    const now = new Date().toISOString();

    const metadata = {
      application_id: applicationId,
      pan: body.pan,
      gst_no: body.gstNo,
      entity_type: body.entityType,
      incorporation_date: body.incorporationDate,
      employee_count: body.employeeCount ?? null,
      referral_code: body.referralCode ?? null,
      documents: body.documents,
      authorized_signature: body.authorizedSignature,
      signed_agreement: body.signedAgreement,
      agreement_text: body.agreementText,
      onboarding_status: "pending",
    };

    const record: RegistrationRecord = {
      applicationId,
      companyId,
      companyName: body.companyName,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone,
      status: "pending",
      submittedAt: now,
    };

    if (app.dbClients.supabase) {
      const { error } = await app.dbClients.supabase.from("companies").insert({
        id: companyId,
        name: body.companyName,
        email: body.contactEmail,
        contact_name: body.contactName,
        contact_phone: body.contactPhone,
        status: "pending",
        employee_count: body.employeeCount ?? null,
        metadata_json: metadata,
        created_at: now,
      });

      if (error) {
        app.log.warn({ error }, "Failed to store company registration");
        registrationsFallback.set(applicationId, record);
      }
    } else {
      registrationsFallback.set(applicationId, record);
    }

    return {
      status: "ok",
      data: record,
    };
  });

  app.get("/registrations/:applicationId", async (request) => {
    const { applicationId } = request.params as { applicationId: string };

    if (app.dbClients.supabase) {
      const { data: rows, error } = await app.dbClients.supabase
        .from("companies")
        .select("id, name, email, contact_phone, status, metadata_json, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch registration: ${error.message}`);
      }

      const match = (rows ?? []).find(
        (company) => (company as any).metadata_json?.application_id === applicationId
      );

      if (match) {
        return {
          status: "ok",
          data: {
            applicationId,
            companyId: match.id,
            companyName: match.name ?? "",
            contactEmail: match.email ?? "",
            contactPhone: match.contact_phone ?? "",
            status: (match.status ?? "pending") as "pending" | "active" | "rejected",
            submittedAt: match.created_at ?? new Date().toISOString(),
          },
        };
      }
    }

    const fallback = registrationsFallback.get(applicationId);
    if (!fallback) {
      return { status: "error", message: "Application not found." };
    }

    return { status: "ok", data: fallback };
  });
};

export default corporateRoutes;
