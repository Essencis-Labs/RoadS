-- ControlS — which payment card each subscription is charged to, so the screen can show how much falls on
-- each card.
--
-- The database never holds a full card number, an expiry, a CVV or a document number: only a label, the last
-- four digits, the holder's name and free notes. The full card data lives outside RoadS.
--
-- Access is the same as the subscriptions (migration 0046): only the ControlS members read or write, enforced
-- here by RLS and re-checked in the server actions (src/lib/actions/payment-cards.ts).
--
-- No card is seeded here (this repository is public); the members register the cards from the screen, and the
-- live project's current cards were entered directly. The change is additive: code that doesn't know the new
-- column keeps working.

create table public.payment_cards (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  holder text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_cards enable row level security;

create policy "payment_cards: members read" on public.payment_cards
  for select using (public.is_controls_member());

create policy "payment_cards: members insert" on public.payment_cards
  for insert with check (public.is_controls_member());

create policy "payment_cards: members update" on public.payment_cards
  for update using (public.is_controls_member()) with check (public.is_controls_member());

create policy "payment_cards: members delete" on public.payment_cards
  for delete using (public.is_controls_member());

-- Restrict, not set null: a card still used by a subscription can't be deleted. The delete action refuses it
-- first with a clear message; this is the database's backstop.
alter table public.subscriptions
  add column payment_card_id uuid references public.payment_cards (id) on delete restrict;

create index subscriptions_payment_card_id_idx on public.subscriptions (payment_card_id);
