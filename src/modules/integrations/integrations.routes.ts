import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { requireMongo, requireSupabase } from "../core/data";

type CompanyIntegrationItem = {
  name: string;
  status: "Connected" | "Error" | "Pending";
  employees: number;
  cadence: string;
  lastSyncAt?: string | null;
};

type CompanyIntegrationState = {
  companyId: string;
  payroll: {
    connected: CompanyIntegrationItem[];
    available: string[];
    inbuiltEnabled?: boolean;
    uploads?: Array<{ filename: string; rows: number; uploadedAt: string }>;
  };
  insurance: {
    connected: CompanyIntegrationItem[];
    available: string[];
  };
  lastSyncAt?: string | null;
  failedSyncs24h?: number;
  updatedAt?: string;
};

type PayrollEmployeeRow = {
  employeeId: string;
  fullName?: string;
  department?: string;
  email?: string;
};

const DEFAULT_PAYROLL_AVAILABLE = [
  "greytHR",
  "Keka HR",
  "Zoho Payroll / Zoho People",
  "HRone",
  "Darwinbox",
];

const DEFAULT_INSURANCE_AVAILABLE = [
  "Bajaj Allianz Group",
  "ICICI Lombard Group",
  "HDFC Ergo Group",
  "Reliance General Group",
];

function buildDefaultState(companyId: string): CompanyIntegrationState {
  return {
    companyId,
    payroll: {
      connected: [],
      available: DEFAULT_PAYROLL_AVAILABLE,
      inbuiltEnabled: false,
      uploads: [],
    },
    insurance: {
      connected: [],
      available: DEFAULT_INSURANCE_AVAILABLE,
    },
    lastSyncAt: null,
    failedSyncs24h: 0,
    updatedAt: new Date().toISOString(),
  };
}

function summarizeState(state: CompanyIntegrationState) {
  const connectedSystems = state.payroll.connected.filter((x) => x.status === "Connected").length +
    state.insurance.connected.filter((x) => x.status === "Connected").length +
    (state.payroll.inbuiltEnabled ? 1 : 0);
  const syncedEmployees = state.payroll.connected.reduce((sum, item) => sum + (item.employees || 0), 0);
  const failedSyncs = state.failedSyncs24h ?? 0;
  const lastSync = state.lastSyncAt;
  return { connectedSystems, syncedEmployees, failedSyncs, lastSync };
}

const integrationsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/mapbox-token", async () => {
    const token = (app.config.MAPBOX_TOKEN || "").trim();
    if (!token) {
      return { status: "error", message: "Mapbox token not configured" };
    }
    return { status: "ok", data: { token } };
  });

  app.get("/providers", async () => {
    const supabase = requireSupabase(app);
    const mongo = requireMongo(app);

    const { data: providers, error } = await supabase
      .from("provider_integrations")
      .select("*, provider_integration_secrets(*)")
      .order("display_name", { ascending: true });
    if (error) {
      throw new Error(`Failed to list providers: ${error.message}`);
    }

    const providerKeys = (providers ?? []).map((item) => item.provider_key);
    const logRows = providerKeys.length
      ? await mongo
          .collection("integration_sync_logs")
          .find({ providerKey: { $in: providerKeys } })
          .sort({ startedAt: -1 })
          .limit(50)
          .toArray()
      : [];

    return { status: "ok", data: { providers: providers ?? [], logs: logRows } };
  });

  app.put("/providers/:providerKey", async (request) => {
    const { providerKey } = request.params as { providerKey: string };
    const body = request.body as {
      displayName?: string;
      status?: "active" | "inactive" | "error" | "testing";
      environment?: "dev" | "staging" | "prod";
      baseUrl?: string;
      env?: {
        appId?: string;
        apiKey?: string;
        secret?: string;
        endpoint?: string;
        modelId?: string;
      };
    };

    const supabase = requireSupabase(app);
    const mongo = requireMongo(app);
    const now = new Date().toISOString();

    const { data: existing, error: existingError } = await supabase
      .from("provider_integrations")
      .select("id, provider_key")
      .eq("provider_key", providerKey)
      .maybeSingle();
    if (existingError) {
      throw new Error(`Failed to fetch provider integration: ${existingError.message}`);
    }
    if (!existing?.id) {
      throw new Error("Provider integration not found");
    }

    const { error } = await supabase
      .from("provider_integrations")
      .update({
        display_name: body.displayName ?? undefined,
        status: body.status ?? undefined,
        environment: body.environment ?? undefined,
        base_url: body.baseUrl ?? body.env?.endpoint ?? undefined,
        updated_at: now,
      })
      .eq("id", existing.id);
    if (error) {
      throw new Error(`Failed to update provider integration: ${error.message}`);
    }

    const secretMap: Array<{ keyName: string; value?: string }> = [
      { keyName: "APP_ID", value: body.env?.appId },
      { keyName: "API_KEY", value: body.env?.apiKey },
      { keyName: "SECRET", value: body.env?.secret },
      { keyName: "ENDPOINT", value: body.env?.endpoint },
      { keyName: "MODEL_ID", value: body.env?.modelId },
    ];

    for (const item of secretMap) {
      if (typeof item.value !== "string") continue;
      const { data: existingSecret } = await supabase
        .from("provider_integration_secrets")
        .select("id")
        .eq("provider_integration_id", existing.id)
        .eq("key_name", item.keyName)
        .maybeSingle();

      if (existingSecret?.id) {
        await supabase
          .from("provider_integration_secrets")
          .update({
            secret_ref: item.value,
            is_active: true,
            last_rotated_at: now,
          })
          .eq("id", existingSecret.id);
      } else {
        await supabase.from("provider_integration_secrets").insert({
          id: crypto.randomUUID(),
          provider_integration_id: existing.id,
          key_name: item.keyName,
          secret_ref: item.value,
          is_active: true,
          last_rotated_at: now,
          created_at: now,
        });
      }
    }

    await mongo.collection("integration_sync_logs").insertOne({
      providerKey,
      syncType: "config_update",
      status: "completed",
      startedAt: now,
      finishedAt: now,
      summary: {
        environment: body.environment ?? null,
        updatedFields: Object.keys(body.env ?? {}),
      },
      schemaVersion: 1,
    });

    return { status: "ok", data: { providerKey } };
  });

  app.post("/providers/:providerKey/reload", async (request) => {
    const { providerKey } = request.params as { providerKey: string };
    const mongo = requireMongo(app);
    const now = new Date().toISOString();

    const inserted = await mongo.collection("integration_sync_logs").insertOne({
      providerKey,
      syncType: "provider_reload",
      status: "queued",
      startedAt: now,
      finishedAt: null,
      summary: { action: "reload_requested" },
      schemaVersion: 1,
    });

    return { status: "ok", data: { runId: inserted.insertedId.toString(), providerKey } };
  });

  app.post("/providers/:providerKey/test", async (request) => {
    const { providerKey } = request.params as { providerKey: string };
    const mongo = requireMongo(app);
    const now = new Date().toISOString();

    const inserted = await mongo.collection("integration_sync_logs").insertOne({
      providerKey,
      syncType: "health_test",
      status: "queued",
      startedAt: now,
      finishedAt: null,
      summary: { action: "health_test_requested" },
      schemaVersion: 1,
    });

    return { status: "ok", data: { runId: inserted.insertedId.toString(), providerKey } };
  });

  app.get("/sync-runs", async (request) => {
    const query = request.query as { providerKey?: string; limit?: number };
    const mongo = requireMongo(app);
    const limit = Math.min(Number(query.limit ?? 100) || 100, 500);
    const filter = query.providerKey ? { providerKey: query.providerKey } : {};
    const rows = await mongo.collection("integration_sync_logs").find(filter).sort({ startedAt: -1 }).limit(limit).toArray();
    return { status: "ok", data: rows };
  });

  const fetchPayrollInsuranceState = async (companyId: string) => {
    const mongo = requireMongo(app);
    const existing = await mongo.collection("company_integrations").findOne({ companyId }) as CompanyIntegrationState | null;
    const state = existing ?? buildDefaultState(companyId);
    if (!existing) {
      await mongo.collection("company_integrations").insertOne(state);
    }
    return { status: "ok", data: { state, summary: summarizeState(state) } };
  };

  app.get("/payroll-insurance", async (request) => {
    const query = request.query as { companyId?: string };
    if (!query.companyId) {
      throw new Error("companyId is required");
    }
    return fetchPayrollInsuranceState(query.companyId);
  });

  app.post("/payroll-insurance", async (request) => {
    const body = request.body as { companyId?: string };
    if (!body.companyId) {
      throw new Error("companyId is required");
    }
    return fetchPayrollInsuranceState(body.companyId);
  });

  app.post("/payroll-insurance/connect", async (request) => {
    const body = request.body as { companyId?: string; type?: "payroll" | "insurance"; name?: string; mode?: "provider" | "inbuilt" };
    if (!body.companyId || !body.type) {
      throw new Error("companyId and type are required");
    }
    const mongo = requireMongo(app);
    const state = (await mongo.collection("company_integrations").findOne({ companyId: body.companyId })) as CompanyIntegrationState | null;
    const next = state ?? buildDefaultState(body.companyId);

    if (body.type === "payroll" && body.mode === "inbuilt") {
      next.payroll.inbuiltEnabled = true;
    } else if (body.type === "payroll" && body.name) {
      if (!next.payroll.connected.find((item) => item.name === body.name)) {
        next.payroll.connected.push({
          name: body.name,
          status: "Connected",
          employees: Math.floor(120 + Math.random() * 1200),
          cadence: "Every 15 mins",
          lastSyncAt: new Date().toISOString(),
        });
      }
    } else if (body.type === "insurance" && body.name) {
      if (!next.insurance.connected.find((item) => item.name === body.name)) {
        next.insurance.connected.push({
          name: body.name,
          status: "Connected",
          employees: Math.floor(120 + Math.random() * 1200),
          cadence: "Daily policy sync",
          lastSyncAt: new Date().toISOString(),
        });
      }
    }

    next.lastSyncAt = new Date().toISOString();
    next.updatedAt = new Date().toISOString();
    await mongo.collection("company_integrations").updateOne(
      { companyId: body.companyId },
      { $set: next },
      { upsert: true },
    );
    return { status: "ok", data: { state: next, summary: summarizeState(next) } };
  });

  app.post("/payroll-insurance/disconnect", async (request) => {
    const body = request.body as { companyId?: string; type?: "payroll" | "insurance"; name?: string };
    if (!body.companyId || !body.type) {
      throw new Error("companyId and type are required");
    }
    const mongo = requireMongo(app);
    const state = (await mongo.collection("company_integrations").findOne({ companyId: body.companyId })) as CompanyIntegrationState | null;
    if (!state) {
      return { status: "ok", data: { state: buildDefaultState(body.companyId), summary: summarizeState(buildDefaultState(body.companyId)) } };
    }
    if (body.type === "payroll") {
      if (body.name === "inbuilt") {
        state.payroll.inbuiltEnabled = false;
      } else if (body.name) {
        state.payroll.connected = state.payroll.connected.filter((item) => item.name !== body.name);
      }
    } else if (body.type === "insurance" && body.name) {
      state.insurance.connected = state.insurance.connected.filter((item) => item.name !== body.name);
    }
    state.updatedAt = new Date().toISOString();
    await mongo.collection("company_integrations").updateOne({ companyId: body.companyId }, { $set: state });
    return { status: "ok", data: { state, summary: summarizeState(state) } };
  });

  app.post("/payroll-insurance/sync", async (request) => {
    const body = request.body as { companyId?: string; type?: "payroll" | "insurance"; name?: string };
    if (!body.companyId) {
      throw new Error("companyId is required");
    }
    const mongo = requireMongo(app);
    const state = (await mongo.collection("company_integrations").findOne({ companyId: body.companyId })) as CompanyIntegrationState | null;
    const next = state ?? buildDefaultState(body.companyId);
    const now = new Date().toISOString();
    if (body.type === "payroll" && body.name) {
      next.payroll.connected = next.payroll.connected.map((item) =>
        item.name === body.name ? { ...item, lastSyncAt: now, status: "Connected" } : item,
      );
    }
    if (body.type === "insurance" && body.name) {
      next.insurance.connected = next.insurance.connected.map((item) =>
        item.name === body.name ? { ...item, lastSyncAt: now, status: "Connected" } : item,
      );
    }
    next.lastSyncAt = now;
    next.updatedAt = now;
    await mongo.collection("company_integrations").updateOne({ companyId: body.companyId }, { $set: next }, { upsert: true });
    return { status: "ok", data: { state: next, summary: summarizeState(next) } };
  });

  app.post("/payroll-insurance/upload", async (request) => {
    const body = request.body as { companyId?: string; filename?: string; rows?: number; employees?: PayrollEmployeeRow[] };
    if (!body.companyId || !body.filename) {
      throw new Error("companyId and filename are required");
    }
    const mongo = requireMongo(app);
    const state = (await mongo.collection("company_integrations").findOne({ companyId: body.companyId })) as CompanyIntegrationState | null;
    const next = state ?? buildDefaultState(body.companyId);
    const now = new Date().toISOString();
    const record = { filename: body.filename, rows: body.rows ?? 0, uploadedAt: now };
    next.payroll.uploads = [record, ...(next.payroll.uploads ?? [])].slice(0, 10);
    next.updatedAt = now;
    next.lastSyncAt = now;
    next.updatedAt = new Date().toISOString();
    await mongo.collection("company_integrations").updateOne({ companyId: body.companyId }, { $set: next }, { upsert: true });

    if (Array.isArray(body.employees) && body.employees.length > 0) {
      const bulk = body.employees.slice(0, 2000).map((row, index) => {
        const statusRoll = Math.random();
        const status = statusRoll > 0.85 ? "Failed" : statusRoll > 0.7 ? "Pending" : "Synced";
        return {
          updateOne: {
            filter: { companyId: body.companyId, employeeId: row.employeeId || `EMP-${index + 1}` },
            update: {
              $set: {
                companyId: body.companyId,
                employeeId: row.employeeId || `EMP-${index + 1}`,
                fullName: row.fullName ?? "Employee",
                department: row.department ?? "General",
                email: row.email ?? null,
                status,
                lastSyncAt: now,
                source: "upload",
                updatedAt: now,
              },
              $setOnInsert: { createdAt: now },
            },
            upsert: true,
          },
        };
      });
      if (bulk.length) {
        await mongo.collection("company_payroll_employees").bulkWrite(bulk);
      }
    }

    return { status: "ok", data: { state: next, summary: summarizeState(next) } };
  });

  app.get("/payroll-insurance/employees", async (request) => {
    const query = request.query as { companyId?: string; limit?: number };
    if (!query.companyId) {
      throw new Error("companyId is required");
    }
    const mongo = requireMongo(app);
    const limit = Math.min(Number(query.limit ?? 50) || 50, 200);
    const rows = await mongo
      .collection("company_payroll_employees")
      .find({ companyId: query.companyId })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();

    const total = await mongo.collection("company_payroll_employees").countDocuments({ companyId: query.companyId });
    const synced = await mongo.collection("company_payroll_employees").countDocuments({ companyId: query.companyId, status: "Synced" });
    const pending = await mongo.collection("company_payroll_employees").countDocuments({ companyId: query.companyId, status: "Pending" });
    const failed = await mongo.collection("company_payroll_employees").countDocuments({ companyId: query.companyId, status: "Failed" });

    return { status: "ok", data: { rows, stats: { total, synced, pending, failed } } };
  });

  app.post("/payroll-insurance/employees", async (request) => {
    const body = request.body as { companyId?: string; limit?: number };
    if (!body.companyId) {
      throw new Error("companyId is required");
    }
    const mongo = requireMongo(app);
    const limit = Math.min(Number(body.limit ?? 50) || 50, 200);
    const rows = await mongo
      .collection("company_payroll_employees")
      .find({ companyId: body.companyId })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();

    const total = await mongo.collection("company_payroll_employees").countDocuments({ companyId: body.companyId });
    const synced = await mongo.collection("company_payroll_employees").countDocuments({ companyId: body.companyId, status: "Synced" });
    const pending = await mongo.collection("company_payroll_employees").countDocuments({ companyId: body.companyId, status: "Pending" });
    const failed = await mongo.collection("company_payroll_employees").countDocuments({ companyId: body.companyId, status: "Failed" });

    return { status: "ok", data: { rows, stats: { total, synced, pending, failed } } };
  });

  app.post("/payroll-insurance/employees/retry", async (request) => {
    const body = request.body as { companyId?: string; employeeId?: string };
    if (!body.companyId || !body.employeeId) {
      throw new Error("companyId and employeeId are required");
    }
    const mongo = requireMongo(app);
    const now = new Date().toISOString();
    await mongo.collection("company_payroll_employees").updateOne(
      { companyId: body.companyId, employeeId: body.employeeId },
      { $set: { status: "Pending", lastSyncAt: now, updatedAt: now } },
    );
    return { status: "ok", data: { queued: true } };
  });
};

export default integrationsRoutes;
