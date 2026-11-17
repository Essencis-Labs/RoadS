import { test } from "node:test";
import assert from "node:assert/strict";
import {
  biggestSpend,
  byCard,
  byCategory,
  cardDisplay,
  byService,
  formatMoney,
  isLast4,
  monthlyEquivalent,
  nextCharge,
  sortSubscriptions,
  totals,
  upcomingRenewals,
  type PaymentCard,
  type Subscription,
} from "./subscription.ts";

function sub(partial: Partial<Subscription>): Subscription {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "Service",
    category: partial.category ?? null,
    accessUrl: partial.accessUrl ?? null,
    loginIdentifier: partial.loginIdentifier ?? null,
    loginEmail: partial.loginEmail ?? null,
    hasSecret: partial.hasSecret ?? false,
    amount: partial.amount ?? null,
    currency: partial.currency ?? "BRL",
    billingCycle: partial.billingCycle ?? "monthly",
    billingDay: partial.billingDay ?? null,
    nextChargeDate: partial.nextChargeDate ?? null,
    status: partial.status ?? "active",
    notes: partial.notes ?? null,
    paymentCardId: partial.paymentCardId ?? null,
  };
}

test("monthlyEquivalent normalizes by cycle and tolerates a missing amount", () => {
  assert.equal(monthlyEquivalent({ amount: 100, billingCycle: "monthly" }), 100);
  assert.equal(monthlyEquivalent({ amount: 120, billingCycle: "annual" }), 10);
  assert.equal(monthlyEquivalent({ amount: 500, billingCycle: "one_off" }), 0);
  assert.equal(monthlyEquivalent({ amount: null, billingCycle: "monthly" }), 0);
  assert.equal(monthlyEquivalent({ amount: -50, billingCycle: "monthly" }), 0);
});

test("totals sum only active subs; annual spreads over 12; one-offs are their own line", () => {
  const subs = [
    sub({ amount: 100, billingCycle: "monthly" }),
    sub({ amount: 1200, billingCycle: "annual" }), // 100/mo
    sub({ amount: 300, billingCycle: "one_off" }),
    sub({ amount: 999, billingCycle: "monthly", status: "inactive" }), // excluded
    sub({ amount: null, billingCycle: "monthly" }), // counts as 0 but is active
  ];
  const t = totals(subs);
  assert.equal(t.monthly, 200);
  assert.equal(t.annual, 2400);
  assert.equal(t.oneOffTotal, 300);
  assert.equal(t.activeCount, 4);
  assert.equal(t.total, 5);
});

test("byCategory groups active subs, biggest spend first, and keeps zero-price categories", () => {
  const slices = byCategory([
    sub({ category: "AI", amount: 50, billingCycle: "monthly" }),
    sub({ category: "AI", amount: 120, billingCycle: "annual" }), // +10
    sub({ category: "Infra", amount: 400, billingCycle: "monthly" }),
    sub({ category: null, amount: null, billingCycle: "monthly" }),
  ]);
  assert.deepEqual(
    slices.map((s) => [s.category, s.monthly, s.count]),
    [
      ["Infra", 400, 1],
      ["AI", 60, 2],
      ["Uncategorized", 0, 1],
    ]
  );
});

test("byService lists only priced active subs, biggest first; biggestSpend picks the top", () => {
  const subs = [
    sub({ name: "Big", amount: 500, billingCycle: "monthly" }),
    sub({ name: "Small", amount: 1200, billingCycle: "annual" }), // 100/mo
    sub({ name: "Free", amount: 0, billingCycle: "monthly" }), // dropped (no recurring cost)
    sub({ name: "Unknown", amount: null, billingCycle: "monthly" }),
  ];
  assert.deepEqual(byService(subs).map((s) => s.name), ["Big", "Small"]);
  assert.equal(biggestSpend(subs)?.name, "Big");
  assert.equal(biggestSpend([sub({ amount: null })]), null);
});

test("nextCharge prefers an explicit date, else rolls a monthly billing day forward", () => {
  const today = new Date(Date.UTC(2026, 10, 9)); // Nov 9 2026
  assert.equal(nextCharge({ billingCycle: "monthly", billingDay: 15, nextChargeDate: null, status: "active" }, today)?.toISOString().slice(0, 10), "2026-11-15");
  assert.equal(nextCharge({ billingCycle: "monthly", billingDay: 5, nextChargeDate: null, status: "active" }, today)?.toISOString().slice(0, 10), "2026-12-05");
  assert.equal(nextCharge({ billingCycle: "monthly", billingDay: null, nextChargeDate: "2026-11-20", status: "active" }, today)?.toISOString().slice(0, 10), "2026-11-20");
  assert.equal(nextCharge({ billingCycle: "annual", billingDay: 10, nextChargeDate: null, status: "active" }, today), null);
  assert.equal(nextCharge({ billingCycle: "monthly", billingDay: 15, nextChargeDate: null, status: "inactive" }, today), null);
});

test("upcomingRenewals flags only those within the window, soonest first", () => {
  const today = new Date(Date.UTC(2026, 10, 9));
  const subs = [
    sub({ name: "Soon", billingCycle: "monthly", billingDay: 12 }), // +3 days
    sub({ name: "Today", nextChargeDate: "2026-11-09" }), // 0 days
    sub({ name: "Later", billingCycle: "monthly", billingDay: 28 }), // +19 days, out
  ];
  const renewals = upcomingRenewals(subs, today, 10);
  assert.deepEqual(renewals.map((r) => [r.name, r.daysUntil]), [["Today", 0], ["Soon", 3]]);
});

test("formatMoney uses the currency symbol and two decimals", () => {
  assert.equal(formatMoney(596.2, "BRL"), "R$ 596.20");
  assert.equal(formatMoney(1376, "BRL"), "R$ 1,376.00");
  assert.equal(formatMoney(10, "USD"), "$ 10.00");
});

// ---- Sorting the list by a column ---------------------------------------------------------------------

const LABELS = {
  cycleLabel: { monthly: "Monthly", annual: "Annual", one_off: "One-off" },
  statusLabel: { active: "Active", inactive: "Inactive", to_register: "To register" },
};
const names = (subs: Subscription[]) => subs.map((s) => s.name);

test("sortSubscriptions by name is alphabetical, ignoring case and accents, and descending reverses it", () => {
  const subs = [sub({ name: "zoom" }), sub({ name: "Ápice" }), sub({ name: "Github" })];
  const today = new Date(Date.UTC(2026, 10, 16));
  assert.deepEqual(names(sortSubscriptions(subs, "name", "asc", { today, ...LABELS })), ["Ápice", "Github", "zoom"]);
  assert.deepEqual(names(sortSubscriptions(subs, "name", "desc", { today, ...LABELS })), ["zoom", "Github", "Ápice"]);
});

test("sortSubscriptions by amount is numeric, and a missing amount stays last in both directions", () => {
  const subs = [sub({ name: "Ten", amount: 10 }), sub({ name: "None", amount: null }), sub({ name: "Hundred", amount: 100 }), sub({ name: "Nine", amount: 9 })];
  const today = new Date(Date.UTC(2026, 10, 16));
  assert.deepEqual(names(sortSubscriptions(subs, "amount", "asc", { today, ...LABELS })), ["Nine", "Ten", "Hundred", "None"]);
  assert.deepEqual(names(sortSubscriptions(subs, "amount", "desc", { today, ...LABELS })), ["Hundred", "Ten", "Nine", "None"]);
});

test("sortSubscriptions by category, cycle, status and login uses the text the screen shows, empties last", () => {
  const today = new Date(Date.UTC(2026, 10, 16));
  const o = { today, ...LABELS };
  const byCat = [sub({ name: "A", category: "Tools" }), sub({ name: "B", category: null }), sub({ name: "C", category: "ai" })];
  assert.deepEqual(names(sortSubscriptions(byCat, "category", "asc", o)), ["C", "A", "B"]);
  assert.deepEqual(names(sortSubscriptions(byCat, "category", "desc", o)), ["A", "C", "B"]);
  const byCycle = [sub({ name: "M", billingCycle: "monthly" }), sub({ name: "O", billingCycle: "one_off" }), sub({ name: "A", billingCycle: "annual" })];
  assert.deepEqual(names(sortSubscriptions(byCycle, "billingCycle", "asc", o)), ["A", "M", "O"]);
  const byStatus = [sub({ name: "T", status: "to_register" }), sub({ name: "A", status: "active" }), sub({ name: "I", status: "inactive" })];
  assert.deepEqual(names(sortSubscriptions(byStatus, "status", "desc", o)), ["T", "I", "A"]);
  const byLogin = [sub({ name: "E", loginIdentifier: null, loginEmail: "b@x.test" }), sub({ name: "N" }), sub({ name: "I", loginIdentifier: "alpha" })];
  assert.deepEqual(names(sortSubscriptions(byLogin, "login", "asc", o)), ["I", "E", "N"]);
});

test("sortSubscriptions by next charge date puts the soonest first, a billing day counting as its next occurrence", () => {
  const today = new Date(Date.UTC(2026, 10, 16));
  const subs = [
    sub({ name: "Dec", nextChargeDate: "2026-12-01" }),
    sub({ name: "Day20", billingCycle: "monthly", billingDay: 20 }), // 2026-11-20
    sub({ name: "Unknown" }),
    sub({ name: "Day5", billingCycle: "monthly", billingDay: 5, status: "inactive" }), // 2026-12-05, inactive still sorts
  ];
  assert.deepEqual(names(sortSubscriptions(subs, "nextChargeDate", "asc", { today, ...LABELS })), ["Day20", "Dec", "Day5", "Unknown"]);
  assert.deepEqual(names(sortSubscriptions(subs, "nextChargeDate", "desc", { today, ...LABELS })), ["Day5", "Dec", "Day20", "Unknown"]);
});

test("sortSubscriptions keeps ties by name and never changes the list it was given", () => {
  const today = new Date(Date.UTC(2026, 10, 16));
  const subs = [sub({ name: "b", amount: 5 }), sub({ name: "a", amount: 5 })];
  const sorted = sortSubscriptions(subs, "amount", "desc", { today, ...LABELS });
  assert.deepEqual(names(sorted), ["a", "b"]);
  assert.deepEqual(names(subs), ["b", "a"]);
});

// ---- Payment cards ------------------------------------------------------------------------------------

const CARD_A: PaymentCard = { id: "card-a", label: "Card A", last4: "1111", holder: "Holder A", notes: null };
const CARD_B: PaymentCard = { id: "card-b", label: "Card B", last4: "2222", holder: null, notes: null };

test("isLast4 accepts exactly four digits", () => {
  assert.equal(isLast4("1234"), true);
  assert.equal(isLast4(" 5678 "), true);
  for (const bad of ["12345", "12a4", "", "123"]) assert.equal(isLast4(bad), false, bad);
});

test("cardDisplay shows the label and the last four digits", () => {
  assert.equal(cardDisplay(CARD_A), "Card A •••• 1111");
});

test("byCard groups active spend per card and reconciles with totals", () => {
  const subs = [
    sub({ name: "m100", amount: 100, billingCycle: "monthly", paymentCardId: "card-a" }),
    sub({ name: "a120", amount: 120, billingCycle: "annual", paymentCardId: "card-a" }),
    sub({ name: "o50", amount: 50, billingCycle: "one_off", paymentCardId: "card-b" }),
    sub({ name: "m30", amount: 30, billingCycle: "monthly", paymentCardId: null }),
    sub({ name: "off", amount: 999, billingCycle: "monthly", paymentCardId: "card-a", status: "inactive" }),
    sub({ name: "gone", amount: 7, billingCycle: "monthly", paymentCardId: "gone" }),
  ];
  const slices = byCard(subs, [CARD_A, CARD_B], "No card set");
  assert.deepEqual(slices.map((s) => s.cardId), ["card-a", null, "card-b"]);
  const [a, none, b] = slices;
  assert.equal(a.monthly, 110);
  assert.equal(a.annual, 1320);
  assert.equal(a.count, 2);
  assert.equal(a.last4, "1111");
  assert.equal(a.holder, "Holder A");
  assert.equal(b.monthly, 0);
  assert.equal(b.oneOffTotal, 50);
  assert.equal(b.count, 1);
  assert.equal(none.monthly, 37);
  assert.equal(none.count, 2);
  assert.equal(none.label, "No card set");
  assert.equal(none.last4, null);
  const t = totals(subs);
  assert.equal(slices.reduce((n, s) => n + s.monthly, 0), t.monthly);
  assert.equal(slices.reduce((n, s) => n + s.annual, 0), t.annual);
  assert.equal(slices.reduce((n, s) => n + s.oneOffTotal, 0), t.oneOffTotal);
});

test("byCard leaves out a card with no active subscription and adds no empty no-card group", () => {
  const subs = [sub({ name: "x", amount: 10, paymentCardId: "card-a" })];
  assert.deepEqual(byCard(subs, [CARD_A, CARD_B], "No card set").map((s) => s.cardId), ["card-a"]);
});

test("sortSubscriptions by card puts rows without a card last both ways", () => {
  const today = new Date(Date.UTC(2026, 10, 16));
  const cardLabel = new Map([CARD_A, CARD_B].map((c) => [c.id, cardDisplay(c)]));
  const o = { today, ...LABELS, cardLabel };
  const subs = [
    sub({ name: "None", paymentCardId: null }),
    sub({ name: "B", paymentCardId: "card-b" }),
    sub({ name: "Gone", paymentCardId: "gone" }),
    sub({ name: "A", paymentCardId: "card-a" }),
  ];
  assert.deepEqual(names(sortSubscriptions(subs, "card", "asc", o)), ["A", "B", "Gone", "None"]);
  assert.deepEqual(names(sortSubscriptions(subs, "card", "desc", o)), ["B", "A", "Gone", "None"]);
});
