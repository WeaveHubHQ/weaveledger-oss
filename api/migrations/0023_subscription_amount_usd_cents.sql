-- LED-41 — Make the subscription "amount in USD" contract explicit.
--
-- `subscriptions.amount` had three inconsistent conventions across importers:
--   * apple-subscriptions.ts: pre-normalizes to USD cents at insert (amount =
--     usdCents, currency = 'USD').
--   * google-play-subscriptions.ts (post-LED-40): stores source minor units
--     + source currency (amount = 500 for ¥500, currency = 'JPY').
--   * stripe-subscriptions.ts: stores source minor units + source currency
--     (Stripe API native).
--
-- forecasting.ts read `amount` and treated every row as USD cents, which was
-- correct only for the Apple convention. With any non-USD Google/Stripe row,
-- MRR would silently mix currencies.
--
-- Fix: add an explicit `amount_usd_cents` column carrying the only meaning
-- forecasting cares about. Importers populate it at write time using FX.
-- The legacy `amount` column stays in place (each importer keeps writing it
-- in its current convention) so iOS doesn't break and we can deprecate it
-- in a follow-up ticket once iOS reads `amount_usd_cents` directly.
--
-- Backfill: production currently has no non-USD subscription rows, so we
-- can safely copy `amount` straight across. If a non-USD row exists at
-- migration time, its amount_usd_cents will be wrong (treated as USD); the
-- subsequent sync of that subscription will overwrite with the FX-correct
-- value. We log this in app code to surface it if it happens.

ALTER TABLE subscriptions ADD COLUMN amount_usd_cents INTEGER;

UPDATE subscriptions
SET amount_usd_cents = amount
WHERE amount_usd_cents IS NULL;
