import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { enqueueOutboxEvent, requireMongo, requireSupabase } from "../core/data";
import { ensureCompanyByReference, ensureDoctorPrincipal, ensureEmployeePrincipal } from "../core/identity";

const pharmacyRoutes: FastifyPluginAsync = async (app) => {
  app.post("/orders", async (request) => {
    const body = request.body as {
      companyReference?: string;
      companyName?: string;
      doctor?: { email?: string; phone?: string; fullName?: string; handle?: string };
      employee?: { email?: string; phone?: string; fullName?: string; handle?: string; employeeCode?: string };
      patientId?: string;
      orderSource: "doctor_store" | "employee_store" | "admin_panel";
      status?: "cart" | "placed" | "paid" | "packed" | "shipped" | "delivered" | "cancelled" | "refunded";
      subtotalInr: number;
      walletUsedInr?: number;
      onlinePaymentInr?: number;
      creditCost?: number;
      shippingAddress?: Record<string, unknown>;
      items: Array<{
        sku?: string;
        productId?: string;
        name: string;
        category?: string;
        description?: string;
        price: number;
        quantity: number;
        imageUrls?: string[];
      }>;
    };

    if (!Array.isArray(body.items) || !body.items.length) {
      throw new Error("At least one pharmacy order item is required");
    }

    const supabase = requireSupabase(app);
    const mongo = requireMongo(app);
    const now = new Date().toISOString();
    const companyId = await ensureCompanyByReference(app, {
      companyReference: body.companyReference,
      companyName: body.companyName,
    });

    const doctor = body.doctor ? await ensureDoctorPrincipal(app, body.doctor) : null;
    const employee = body.employee
      ? await ensureEmployeePrincipal(app, {
          companyId,
          ...body.employee,
        })
      : null;

    const orderId = crypto.randomUUID();
    const { error: orderError } = await supabase.from("pharmacy_orders").insert({
      id: orderId,
      company_id: companyId,
      doctor_id: doctor?.userId ?? null,
      employee_id: employee?.userId ?? null,
      patient_id: body.patientId ?? null,
      order_source: body.orderSource,
      status: body.status ?? "placed",
      subtotal_inr: body.subtotalInr,
      wallet_used_inr: body.walletUsedInr ?? 0,
      online_payment_inr: body.onlinePaymentInr ?? body.subtotalInr,
      credit_cost: body.creditCost ?? null,
      shipping_address_json: body.shippingAddress ?? {},
      created_at: now,
      updated_at: now,
    });
    if (orderError) {
      throw new Error(`Failed to create pharmacy order: ${orderError.message}`);
    }

    for (const item of body.items) {
      let productId = item.productId ?? "";
      if (!productId) {
        productId = crypto.randomUUID();
        await supabase.from("pharmacy_product_catalog").upsert({
          id: productId,
          sku: item.sku ?? `SKU-${slug(item.name)}`,
          name: item.name,
          category: item.category ?? null,
          description: item.description ?? null,
          base_price_inr: item.price,
          image_urls_json: item.imageUrls ?? [],
          is_active: true,
          updated_at: now,
        });
      }

      await supabase.from("pharmacy_order_items").insert({
        id: crypto.randomUUID(),
        order_id: orderId,
        product_id: productId,
        qty: item.quantity,
        unit_price_inr: item.price,
        line_total_inr: item.price * item.quantity,
        created_at: now,
      });
    }

    await mongo.collection("pharmacy_order_events").insertOne({
      orderId,
      companyId,
      employeeId: employee?.userId ?? null,
      doctorId: doctor?.userId ?? null,
      eventType: "pharmacy_order_created",
      payload: {
        orderSource: body.orderSource,
        itemCount: body.items.length,
        subtotalInr: body.subtotalInr,
      },
      source: "backend-api",
      eventAt: now,
      ingestedAt: now,
      schemaVersion: 1,
    });

    await enqueueOutboxEvent(app, {
      event_type: "pharmacy.order.created",
      aggregate_type: "pharmacy_order",
      aggregate_id: orderId,
      payload: {
        companyId,
        employeeId: employee?.userId ?? null,
        doctorId: doctor?.userId ?? null,
        orderSource: body.orderSource,
      },
      idempotency_key: `pharmacy-order-created:${orderId}`,
    });

    return { status: "ok", data: { orderId, companyId } };
  });
};

function slug(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default pharmacyRoutes;
