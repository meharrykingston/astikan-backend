import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { enqueueOutboxEvent, requireSupabase } from "../core/data";

const creditsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/purchase", async (request) => {
    const body = request.body as {
      companyId: string;
      credits?: number;
      inrAmount?: number;
      currency?: string;
      reference?: string;
    };

    const creditAmount =
      Number.isFinite(body.credits) && Number(body.credits) > 0
        ? Number(body.credits)
        : Number.isFinite(body.inrAmount) && Number(body.inrAmount) > 0
          ? Math.round(Number(body.inrAmount) * 10)
          : NaN;
    const inrAmount =
      Number.isFinite(body.inrAmount) && Number(body.inrAmount) > 0
        ? Number(body.inrAmount)
        : Number.isFinite(body.credits) && Number(body.credits) > 0
          ? Number(body.credits) / 10
          : NaN;

    if (!body.companyId || !Number.isFinite(creditAmount) || creditAmount <= 0) {
      throw new Error("Invalid companyId or credits");
    }

    const supabase = requireSupabase(app);
    const now = new Date().toISOString();

    const { data: wallet, error: walletReadError } = await supabase
      .from("company_credit_wallets")
      .select("*")
      .eq("company_id", body.companyId)
      .maybeSingle();

    if (walletReadError || !wallet) {
      throw new Error("Company wallet not found");
    }

    const nextBalance = Number(wallet.balance ?? 0) + creditAmount;

    const { error: walletUpdateError } = await supabase
      .from("company_credit_wallets")
      .update({ balance: nextBalance, last_recharged_at: now, updated_at: now })
      .eq("id", wallet.id);

    if (walletUpdateError) {
      throw new Error(`Failed to update wallet: ${walletUpdateError.message}`);
    }

    const { error: ledgerError } = await supabase.from("company_credit_ledger").insert({
      id: crypto.randomUUID(),
      company_id: body.companyId,
      wallet_id: wallet.id,
      amount: creditAmount,
      currency: body.currency ?? "INR",
      entry_type: "credit",
      reason: "purchase",
      credits: creditAmount,
      inr_amount: inrAmount,
      reference: body.reference ?? null,
      created_at: now,
      updated_at: now,
    });

    if (ledgerError) {
      throw new Error(`Failed to insert credit ledger entry: ${ledgerError.message}`);
    }

    await enqueueOutboxEvent(app, {
      event_type: "credits.purchased",
      aggregate_type: "company_wallet",
        aggregate_id: wallet.id,
        payload: {
          companyId: body.companyId,
          credits: creditAmount,
          inrAmount,
          balance: nextBalance,
        },
      });

    return {
      status: "ok",
      data: {
        companyId: body.companyId,
        newBalance: nextBalance,
        creditsPurchased: creditAmount,
        inrAmount,
      },
    };
  });

  app.post("/ledger", async (request) => {
    const body = request.body as {
      companyId: string;
      walletId?: string;
      entryType: "debit" | "hold" | "release" | "refund" | "adjustment";
      reason: string;
      serviceType?: "teleconsult" | "opd" | "lab" | "pharmacy" | "program" | "assessment" | "manual";
      serviceRefId?: string;
      credits: number;
      inrAmount?: number;
      reference?: string;
    };

    if (!body.companyId || !Number.isFinite(body.credits) || body.credits <= 0) {
      throw new Error("Invalid companyId or credits");
    }

    const supabase = requireSupabase(app);
    const now = new Date().toISOString();

    const { data: wallet, error: walletReadError } = await supabase
      .from("company_credit_wallets")
      .select("*")
      .eq("company_id", body.companyId)
      .maybeSingle();
    if (walletReadError || !wallet) {
      throw new Error("Company wallet not found");
    }

    const balance = Number(wallet.balance ?? 0);
    const lockedBalance = Number(wallet.locked_balance ?? 0);
    let nextBalance = balance;
    let nextLocked = lockedBalance;

    if (body.entryType === "debit") nextBalance -= body.credits;
    if (body.entryType === "refund" || body.entryType === "release") nextBalance += body.credits;
    if (body.entryType === "hold") {
      nextBalance -= body.credits;
      nextLocked += body.credits;
    }
    if (body.entryType === "release") {
      nextLocked = Math.max(0, nextLocked - body.credits);
    }
    if (body.entryType === "adjustment") nextBalance += body.credits;

    if (nextBalance < 0 || nextLocked < 0) {
      throw new Error("Insufficient credits for requested ledger operation");
    }

    const { error: walletUpdateError } = await supabase
      .from("company_credit_wallets")
      .update({
        balance: nextBalance,
        locked_balance: nextLocked,
        updated_at: now,
      })
      .eq("id", wallet.id);
    if (walletUpdateError) {
      throw new Error(`Failed to update wallet: ${walletUpdateError.message}`);
    }

    const ledgerId = crypto.randomUUID();
    const { error: ledgerError } = await supabase.from("company_credit_ledger").insert({
      id: ledgerId,
      company_id: body.companyId,
      wallet_id: wallet.id,
      amount: body.credits,
      currency: "INR",
      entry_type: body.entryType,
      reason: body.reason,
      service_type: body.serviceType ?? null,
      service_ref_id: body.serviceRefId ?? null,
      credits: body.credits,
      inr_amount: body.inrAmount ?? body.credits / 10,
      reference: body.reference ?? null,
      created_at: now,
      updated_at: now,
    });
    if (ledgerError) {
      throw new Error(`Failed to insert ledger entry: ${ledgerError.message}`);
    }

    return {
      status: "ok",
      data: {
        ledgerId,
        companyId: body.companyId,
        balance: nextBalance,
        lockedBalance: nextLocked,
      },
    };
  });
};

export default creditsRoutes;
