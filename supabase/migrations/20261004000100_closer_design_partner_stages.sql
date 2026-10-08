-- Closer — the six stages a design-partner motion needs, added to the enum.
--
-- ## Why this migration contains nothing but ALTER TYPE
--
-- Postgres will add an enum value inside a transaction, and will not let the
-- same transaction *use* it: `unsafe use of new value of enum type`. Supabase
-- runs each migration in one transaction, so the rows that reference these
-- six have to land in a second file. Splitting them is not tidiness, it is
-- the only order that applies.
--
-- The companion is `20261004000200_closer_design_partner_track`.
--
-- ## Why nothing is removed or renamed
--
-- Postgres has no `DROP VALUE`. The fourteen sales stages
-- (`qualified_opportunity` through `negotiation`, `won`) stay in the type
-- whatever happens, and trying to replace them would mean a new type, a
-- column rewrite and a rebuild of `closer_stage_transitions`,
-- `closer_stage_history` and every policy that names them — to delete states
-- that cost nothing by existing.
--
-- So the design-partner funnel is a **track**: a named subset of the stages
-- with its own edges. A lead on one track cannot wander onto the other,
-- because the edges that would take it there are rows nobody inserted.
--
-- ## The six, and the two that are deliberately absent
--
-- `researched` — the operator's funnel puts cheap qualification *before* the
--   expensive research, which is the opposite of the existing
--   `researching → qualified`. Both orders now exist; see the companion.
--
-- `installed`, `first_check`, `repeated_usage` — the activation beats. A
--   design partner who signed up and never ran a check is a different
--   outcome from one who never signed up, and a funnel that cannot say which
--   cannot tell you what to fix.
--
-- `pricing`, `paid` — the two that come after activation rather than after a
--   meeting. Nothing here bills anybody; `paid` is a fact an operator
--   records, exactly as `contacted` is.
--
-- **Not added: `ready_for_review`.** It is `ready_for_outreach` under another
-- name — "a contact and an angle exist; a draft is waiting" is the same
-- state. A second identifier for one state is how two columns start
-- disagreeing, so the display label changes in `packages/closer-core` and the
-- database keeps the name every existing row, policy and transition already
-- uses.
--
-- **Not removed from the path: `outreach_approved`.** The design-partner list
-- reads `ready_for_review → contacted`, but `outreach_approved` is the stage
-- that records that a human opened the gate. Routing around it would make
-- the approval invisible in `closer_stage_history` — so it stays between
-- them, and the track is thirteen stages rather than twelve.

-- ## Appended, not inserted, and that is load-bearing
--
-- The obvious spelling is `add value 'researched' after 'qualified'`, which
-- reads better and breaks the sales funnel. `CLOSER_STAGES` in
-- `packages/closer-core` mirrors this enum, and `funnelPosition` is an
-- `indexOf` into it: inserting six values in the middle shifts every stage
-- after them, so `qualified_opportunity` would sort after `paid` and
-- `funnelProgress` would divide by a different denominator than the one that
-- produced every figure before today.
--
-- Enum order in Postgres only affects ORDER BY and comparisons, and nothing
-- here orders by stage. Order in the TypeScript mirror affects arithmetic
-- somebody reads. So the enum is appended to and the funnel order lives where
-- it is used — in the track lists.

alter type public.closer_stage add value if not exists 'researched';
alter type public.closer_stage add value if not exists 'installed';
alter type public.closer_stage add value if not exists 'first_check';
alter type public.closer_stage add value if not exists 'repeated_usage';
alter type public.closer_stage add value if not exists 'pricing';
alter type public.closer_stage add value if not exists 'paid';
