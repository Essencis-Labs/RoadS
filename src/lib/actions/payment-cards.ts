"use server";

import { isControlsEmail } from "@/lib/controls/access";
import { isLast4, type PaymentCard } from "@/lib/controls/subscription";
import { createClient } from "@/lib/supabase/server";

// The payment cards a ControlS subscription is charged to. Same boundary as the subscriptions (migration 0048,
// RLS on is_controls_member): every action re-checks the caller on its own, since a "use server" export is an
// HTTP endpoint any signed-in user can call. Only a label, the last four digits, the holder and notes are ever
// stored — never a full number, an expiry or a CVV.
async function requireMember(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  if (!isControlsEmail(user.email)) throw new Error("forbidden");
}

type Row = { id: string; label: string; last4: string; holder: string | null; notes: string | null };

const COLUMNS = "id, label, last4, holder, notes";

type CardInput = { label: string; last4: string; holder: string | null; notes: string | null };

type CardError = "label_required" | "invalid_last4" | "looks_like_card_number" | "save_failed" | "forbidden" | "unauthenticated";
type CardResult = { ok: true; card: PaymentCard } | { ok: false; error: CardError };

function toCard(row: Row): PaymentCard {
  return { id: row.id, label: row.label, last4: row.last4, holder: row.holder, notes: row.notes };
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const LONG_DIGITS = /\d(?:[ -]?\d){11,}/;

function sanitize(input: CardInput): Record<string, unknown> {
  const label = clean(input.label);
  if (!label) throw new Error("label_required");
  if (typeof input.last4 !== "string" || !isLast4(input.last4)) throw new Error("invalid_last4");
  const holder = clean(input.holder);
  const notes = clean(input.notes);
  // A run of 12+ digits (spaces and dashes allowed) looks like a full card number: never stored here.
  if ([label, holder, notes].some((v) => v != null && LONG_DIGITS.test(v))) throw new Error("looks_like_card_number");
  return { label, last4: input.last4.trim(), holder, notes };
}

function errorCode(e: unknown): CardError {
  const message = e instanceof Error ? e.message : "";
  if (message === "label_required" || message === "invalid_last4" || message === "looks_like_card_number" || message === "forbidden" || message === "unauthenticated") {
    return message;
  }
  return "save_failed";
}

export async function listPaymentCards(): Promise<PaymentCard[]> {
  await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase.from("payment_cards").select(COLUMNS).order("label", { ascending: true });
  if (error) throw error;
  return (data as Row[]).map(toCard);
}

export async function createPaymentCard(input: CardInput): Promise<CardResult> {
  try {
    await requireMember();
    const supabase = await createClient();
    const { data, error } = await supabase.from("payment_cards").insert(sanitize(input)).select(COLUMNS).single();
    if (error) throw error;
    return { ok: true, card: toCard(data as Row) };
  } catch (e) {
    console.error("createPaymentCard failed", e);
    return { ok: false, error: errorCode(e) };
  }
}

export async function updatePaymentCard(id: string, input: CardInput): Promise<CardResult> {
  try {
    await requireMember();
    const supabase = await createClient();
    const patch = { ...sanitize(input), updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from("payment_cards").update(patch).eq("id", id).select(COLUMNS).single();
    if (error) throw error;
    return { ok: true, card: toCard(data as Row) };
  } catch (e) {
    console.error("updatePaymentCard failed", e);
    return { ok: false, error: errorCode(e) };
  }
}

// A card still used by a subscription is refused, never silently cleared from it. The foreign key's
// `on delete restrict` is the database's backstop for the same rule.
export async function deletePaymentCard(
  id: string
): Promise<{ ok: true } | { ok: false; error: "card_in_use" | CardError }> {
  try {
    await requireMember();
    const supabase = await createClient();
    const { count, error: countError } = await supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("payment_card_id", id);
    if (countError) throw countError;
    if ((count ?? 0) > 0) return { ok: false, error: "card_in_use" };
    const { error } = await supabase.from("payment_cards").delete().eq("id", id);
    // 23503: a subscription took the card between the count and the delete; the foreign key refused it.
    if (error?.code === "23503") return { ok: false, error: "card_in_use" };
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.error("deletePaymentCard failed", e);
    return { ok: false, error: errorCode(e) };
  }
}
