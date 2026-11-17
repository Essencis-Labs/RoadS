# ControlS payment cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each ControlS subscription says which payment card it is charged to, and the screen shows how much falls on each card.

**Architecture:**
- A `payment_cards` table, protected by the same RLS as `subscriptions`, plus a nullable `subscriptions.payment_card_id`.
- The card math lives in the pure module `src/lib/controls/subscription.ts`, which is unit-tested.
- Server actions for cards live in a new file, and the client component `ControlS.tsx` gains a "by card" panel, a table column, a form select and a small card manager.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (Postgres + RLS), TypeScript, Tailwind, `node --test` with `--experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-11-17-controls-payment-cards-design.md`

## Global Constraints

- Screen copy is in English, like the rest of the app. All strings go in `src/lib/text/controls.ts`.
- The database stores only `label`, `last4` (exactly 4 digits), `holder` and `notes`. It never stores a full card number, expiry, CVV or CPF.
- The migration is `supabase/migrations/0048_controls_payment_cards.sql`. Number 0047 is taken by another session's untracked file; do not touch it.
- Work only in the worktree `C:\Software\RoadS-cards` on branch `feature/controls-payment-cards`. Never switch branches in `C:\Software\RoadS`.
- Totals by card cover active subscriptions only, like `totals()`. A null card goes to the "no card" group.
- Seeded cards:
  - "Company card": last4 1234, holder the company card holder.
  - "Sergio's virtual corporate card": last4 5678, holder Sergio.
- Merging to `main` and deploying happen only with Sergio's OK.

## Review Focus

- **Deleting a card that is still in use:** the delete must be refused with `card_in_use`, not silently clear the card from the subscriptions.
  Test: Task 3, `deletePaymentCard` guard (manual check via SQL, since server actions have no unit harness).
- **A last4 like "12345", "12a4" or " 1234":** must be rejected; trimmed "1234" is accepted.
  Test: Task 1, `isLast4`.
- **A subscription whose card id no longer exists in the list:** it must land in the "no card" group, not crash or vanish.
  Test: Task 1, `byCard` unknown id.
- **The sum of all card groups must equal `totals()`:** monthly, annual and one-off.
  Test: Task 1, `byCard` reconciliation.
- **Sorting by the card column, with rows that have no card:** empty cells sort last in both directions.
  Test: Task 1, `sortSubscriptions` card key.

---

### Task 1: Card domain and math

**Files:**
- Modify: `src/lib/controls/subscription.ts`
- Test: `src/lib/controls/subscription.test.ts`

**Interfaces:**
- Produces:
  - `type PaymentCard = { id: string; label: string; last4: string; holder: string | null; notes: string | null }`
  - `Subscription.paymentCardId: string | null` and `SubscriptionInput.paymentCardId: string | null`
  - `isLast4(value: string): boolean`: true when the trimmed value matches `^\d{4}$`
  - `cardDisplay(card: PaymentCard): string`: returns `` `${card.label} •••• ${card.last4}` ``
  - `type CardSlice = { cardId: string | null; label: string; last4: string | null; holder: string | null; monthly: number; annual: number; oneOffTotal: number; count: number }`
  - `byCard(subs: Subscription[], cards: PaymentCard[], noCardLabel: string): CardSlice[]`
    - covers active subs only;
    - returns one slice per card that has at least one active sub, plus a `cardId: null` slice when any active sub has no card or an unknown card id;
    - orders by monthly spend descending, then label;
    - `annual = monthly * 12`; `oneOffTotal` sums one-off amounts.
  - `SortKey` gains `"card"`; `SORT_KEYS` includes it. `SortOptions` gains `cardLabel: Map<string, string>` (card id → display). The sort value is the display text, or null when there is no card or the id is unknown.

- [ ] **Step 1: Write the failing tests.** Add `paymentCardId: partial.paymentCardId ?? null` to the `sub()` helper. Then write these tests:
  - `isLast4 accepts exactly four digits`: assert `"1234"` and `" 5678 "` are true; `"12345"`, `"12a4"`, `""` and `"123"` are false.
  - `byCard groups active spend per card and reconciles with totals`:
    - cards A (1234) and B (5678);
    - subs: monthly 100 on A, annual 120 on A, one-off 50 on B, monthly 30 with no card, monthly 999 on A with status `inactive`, monthly 7 with card id `"gone"`;
    - assert A has `monthly` 110, `annual` 1320, `count` 2;
    - assert B has `monthly` 0, `oneOffTotal` 50, `count` 1;
    - assert the null slice has `monthly` 37, `count` 2 and `label` equal to the passed `noCardLabel`;
    - assert the slices' summed `monthly` and `oneOffTotal` equal `totals(subs).monthly` and `.oneOffTotal`;
    - assert the order is A, null, B.
  - `sortSubscriptions by card puts rows without a card last both ways`: three subs (card A, card B, none). `asc` gives A-display, B-display, none; `desc` gives B, A, none.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npm test` from `C:\Software\RoadS-cards`. Expected: FAIL on the missing exports `isLast4` and `byCard`.
- [ ] **Step 3: Implement the interfaces above in `subscription.ts`.** Existing callers of `sortSubscriptions` must now pass `cardLabel`. Task 4 updates `ControlS.tsx`; until then, `npm test` is what matters.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npm test`. Expected: all pass, the old ones included.
- [ ] **Step 5: Commit.** Run `git add src/lib/controls && git commit -m "ControlS: card domain, by-card totals and card sort"`, ending the message with the Co-Authored-By line.

### Task 2: Migration and live data

**Files:**
- Create: `supabase/migrations/0048_controls_payment_cards.sql`

**Interfaces:**
- Produces:
  - table `public.payment_cards`: `id uuid pk default gen_random_uuid()`, `label text not null`, `last4 text not null check (last4 ~ '^[0-9]{4}$')`, `holder text`, `notes text`, `created_at timestamptz default now()`, `updated_at timestamptz default now()`;
  - RLS enabled, with four policies (select, insert, update, delete) using `public.is_controls_member()`;
  - column `public.subscriptions.payment_card_id uuid references public.payment_cards(id) on delete restrict`. Restrict is the database backstop for the in-use guard.

- [ ] **Step 1: Write the migration.**
  - Start with a header comment in the style of 0046: why the table exists, and that the database never holds a full card number.
  - Seed the two cards from Global Constraints with `insert ... where not exists` on `last4`.
  - Then run `update subscriptions set payment_card_id = <1234 id>` for the names ChatGPT, Claude Team (adm@), Claude Max (geocloudai@), Claude usage credits (geocloudai@) and Claude Pro (opened by Luiz).
  - Run the same update with the 5678 id for "Backblaze B2 (Essencis)" and "Scale Quality".
  - Match by exact `name`, using subselects on `last4`.
- [ ] **Step 2: Apply it to the live project.** Use Supabase MCP `apply_migration` on `ctovfklkdmqrvpukrliv`, name `0048_controls_payment_cards`. The change is additive.
- [ ] **Step 3: Verify.**
  - Run `select s.name, c.last4 from subscriptions s left join payment_cards c on c.id = s.payment_card_id where c.id is not null order by c.last4, s.name;`. Expected: 5 rows on 1234 and 2 on 5678.
  - Run `select relrowsecurity from pg_class where relname = 'payment_cards'`. Expected: true.
  - Run `npm run audit:rls` if it runs without credentials; otherwise note that it was skipped.
- [ ] **Step 4: Commit the migration file.**

### Task 3: Server actions

**Files:**
- Modify: `src/lib/actions/subscriptions.ts`:
  - add `payment_card_id` to `Row` and `COLUMNS`;
  - map it in `toSubscription`;
  - in `sanitize`, write `payment_card_id` as the trimmed id when it matches a UUID shape, otherwise null.
- Create: `src/lib/actions/payment-cards.ts`, with `"use server"` and the same `requireMember` gate. Copy the helper; do not import a non-action from an action file unless the project already does so.

**Interfaces:**
- Consumes: `PaymentCard` and `isLast4` from Task 1.
- Produces:
  - `listPaymentCards(): Promise<PaymentCard[]>`, ordered by label;
  - `createPaymentCard(input: { label: string; last4: string; holder: string | null; notes: string | null }): Promise<{ ok: true; card: PaymentCard } | { ok: false; error: "label_required" | "invalid_last4" | "save_failed" | "forbidden" | "unauthenticated" }>`;
  - `updatePaymentCard(id: string, input: <same>): <same result>`;
  - `deletePaymentCard(id: string): Promise<{ ok: true } | { ok: false; error: "card_in_use" | "save_failed" | ... }>`. It first counts subscriptions with that `payment_card_id` and refuses when the count is > 0.

- [ ] **Step 1: Implement the actions.** Validation: the label is required after trimming; `isLast4` must pass; `last4` is stored trimmed.
- [ ] **Step 2: Type-check.** Run `npx tsc --noEmit`. Expected: errors only in `ControlS.tsx` (the missing `cardLabel` and `paymentCardId`), which Task 4 fixes.
- [ ] **Step 3: Commit.**

### Task 4: Screen

**Files:**
- Modify: `src/lib/text/controls.ts`. Add these strings:
  - `byCard: "Spend by card"`, `noCard: "No card set"`, `card: "Card"`;
  - `cards: "Payment cards"`, `addCard: "Add card"`, `cardLabel: "Label"`, `cardLast4: "Last 4 digits"`, `cardHolder: "Holder"`;
  - `cardInUse: "This card is still used by a subscription."`, `invalidLast4: "Use exactly 4 digits."`, `labelRequired: "A label is required."`;
  - `filterByCard: (name: string) => \`Showing ${name}\``, `clearFilter: "Show all"`, `perMonth: "/ month"`, `perYear: "/ year"`, `oneOff: "one-off"`;
  - `servicesCount: (n: number) => \`${n} service${n === 1 ? "" : "s"}\``.
- Modify: `src/components/ControlS.tsx`.

**Interfaces:**
- Consumes:
  - `byCard`, `cardDisplay` and `PaymentCard` from Task 1;
  - `listPaymentCards`, `createPaymentCard`, `updatePaymentCard` and `deletePaymentCard` from Task 3.

- [ ] **Step 1: Load the cards.** Load them with the subscriptions in `reload()` (both in parallel), keep them in state, and build `cardLabel = new Map(cards.map(c => [c.id, cardDisplay(c)]))` for sorting.
- [ ] **Step 2: Add the "Spend by card" panel** between the charts and the renewals, using the existing `panel` class.
  - Each slice is a full-width button row showing:
    - the label and `•••• last4` (none for the no-card slice);
    - the holder, small and faint;
    - the monthly amount with "/ month", the annual amount with "/ year", the one-off total with "one-off" when > 0;
    - `servicesCount`.
  - Clicking a row sets `cardFilter` (`string` id, `"none"`, or `null`).
  - The table header shows `filterByCard(label)` with a `clearFilter` button while a filter is on.
- [ ] **Step 3: Filter and show the card in the table.**
  - The table filters `rows` by `cardFilter`: `"none"` means a null id or an id not in `cards`.
  - Add a sortable "Card" column after Status, using `SortHeader column="card"`.
  - The cell shows `•••• last4` with the label as `title`, or `CONTROLS.none`.
  - Raise the table's `min-w` to keep the layout.
- [ ] **Step 4: Add the card select to the form.** Add a `paymentCardId` field to the form state, `emptyForm` and `formFrom`, and a `<select>` (`noCard` option plus each `cardDisplay`) next to Status.
- [ ] **Step 5: Add the "Payment cards" manager.** It is a small section below the subscriptions table:
  - a list of cards with Edit and Delete buttons;
  - an "Add card" button that opens an inline form (label, last 4, holder);
  - errors mapped to `labelRequired`, `invalidLast4` and `cardInUse`;
  - a `reload()` after each change.
- [ ] **Step 6: Verify.** Run `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run build`. Expected: all pass. If `npm run build` needs environment variables, use `C:\Software\RoadS\.env.local`, copied (not moved) into the worktree, and confirm the copy is git-ignored.
- [ ] **Step 7: Commit.**

### Task 5: Spreadsheet and weekly check

**Files:**
- Not in the repo:
  - `C:\Users\essen\OneDrive - Essencis Labs\Essencis Labs - Documentação\ControlS.xlsx`, sheet Assinaturas;
  - `C:\Users\essen\.claude\scheduled-tasks\controls-conferencia-semanal\SKILL.md` (edit it through `update_scheduled_task`).

- [ ] **Step 1: Add column O to the spreadsheet** with the header "Cartão" in row 2, formatted like N2. In each service row, write "final 1234" or "final 5678" with the same mapping as Task 2, and leave the rest blank.
  - Use Excel COM, then re-read the cells to confirm.
  - Write accents with `[char]`.
- [ ] **Step 2: Update the scheduled task prompt.** It must:
  - check the card on every receipt or panel ("card ending" / "final");
  - keep `payment_card_id` in RoadS and column O of the sheet in step;
  - register a new card in `payment_cards` (label, last4, holder only) and in the Financeiro sheet only with Sergio's confirmation.
- [ ] **Step 3: Verify.** Read back column O, and read the task with `list_scheduled_tasks`.

### Task 6: Final check

- [ ] **Step 1:** Run the whole-branch review: a reviewer reads the diff against the spec.
- [ ] **Step 2:** Report to Sergio: what is on the branch, what the live database already has (Task 2 applies directly), and ask for the OK to merge to `main` and deploy.

  Until the deploy, the production screen keeps working: the old code ignores the new column and table.
