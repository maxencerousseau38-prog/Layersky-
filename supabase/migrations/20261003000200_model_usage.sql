-- What a workspace's model calls actually cost, recorded where its usage
-- already lives.
--
-- ## The gap this closes
--
-- `docs/product/09-unit-economics.md` models the cost at $1.55 per 1,000
-- string-locale pairs and checks it against a benchmark that billed $1.47. It
-- is a good model. It has never been reconciled against a real workspace,
-- because nothing in production records what a call cost: `api_usage_daily`
-- counts strings, requests and pull requests, and the one mechanism that did
-- measure tokens — the `onUsage` hook on the Anthropic provider — was wired at
-- construction and only ever passed by the two eval harnesses. It produced the
-- benchmark figure and could not produce a workspace's.
--
-- So every figure anyone could quote is a projection. Pricing cannot be set on
-- a projection that has never met a bill.
--
-- ## Columns on the existing row, not a second table
--
-- `api_usage_daily` is already keyed by `(organization_id, usage_date)` and is
-- already the row the ceiling is enforced against. A `model_usage` table beside
-- it would be a second account of the same day's activity, free to disagree —
-- and `/[org]/usage` would then have two numbers for one question. These are
-- the same facts measured in a different unit.
--
-- ## Tokens, not money
--
-- No price per token is stored. Vendor rates change, they differ per model, and
-- a dollar figure frozen into a row is wrong the day the rate moves with no way
-- to tell which rate produced it. Tokens are what was consumed; converting them
-- is arithmetic a reader does with today's published rate, and
-- `docs/product/09-unit-economics.md` is where that rate lives.
--
-- `model_requests` counts calls that reached a provider, including the ones
-- that failed and were retried — those cost money and would otherwise vanish.
-- It is deliberately not `translate_requests`, which counts calls to
-- `/v1/translate`: one of those becomes one model call per locale, and can
-- become three per locale when a chunk is retried.

alter table public.api_usage_daily
  add column model_requests integer not null default 0
    check (model_requests >= 0),
  add column input_tokens bigint not null default 0
    check (input_tokens >= 0),
  add column output_tokens bigint not null default 0
    check (output_tokens >= 0),
  -- Billed inside `output_tokens` by Anthropic, and recorded separately
  -- because it is the one line an `effort` change moves. Without it a cost
  -- regression from a settings change looks like ordinary growth.
  add column thinking_tokens bigint not null default 0
    check (thinking_tokens >= 0);

comment on column public.api_usage_daily.model_requests is
  'Calls that reached a model provider, retries included. Not the same as translate_requests: one API request becomes one model call per locale, and up to three when a chunk is retried.';
comment on column public.api_usage_daily.thinking_tokens is
  'A subset of output_tokens. Recorded separately because it is what an effort setting moves.';

/**
 * Add what a set of model calls consumed to today's row.
 *
 * Separate from `consume_api_quota` because the two happen at different
 * moments and must not be confused. The quota is charged **before** the work,
 * against a count the caller declares; this is recorded **after**, from what
 * the provider reported. Folding them together would mean either charging a
 * quota for tokens nobody has spent yet, or learning the cost too late to
 * refuse.
 *
 * It never refuses and never blocks: a workspace that has already spent the
 * money is not helped by failing to write it down. The row is created when
 * absent, because a correction can be the first thing a workspace does on a
 * given day and `consume_api_quota` may have created the row moments earlier
 * or not at all.
 *
 * `p_operation` is accepted and deliberately not stored. Attribution per
 * operation is answered by `i18n_checks`, which already records the correction
 * that caused the spend; a second breakdown here would be the parallel system
 * this migration exists to avoid. It is in the signature so a caller must say
 * what it was doing, and so the day a breakdown is genuinely needed the call
 * sites already carry it.
 */
create function public.record_model_usage(
  p_organization_id uuid,
  p_operation text,
  p_requests integer,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_thinking_tokens bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_requests <= 0 then
    return;
  end if;

  insert into public.api_usage_daily as u (
    organization_id, usage_date,
    model_requests, input_tokens, output_tokens, thinking_tokens
  )
  values (
    p_organization_id, (now() at time zone 'utc')::date,
    p_requests, greatest(p_input_tokens, 0), greatest(p_output_tokens, 0),
    greatest(p_thinking_tokens, 0)
  )
  on conflict (organization_id, usage_date) do update set
    model_requests = u.model_requests + excluded.model_requests,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    thinking_tokens = u.thinking_tokens + excluded.thinking_tokens,
    updated_at = now();
end;
$$;

revoke execute on function
  public.record_model_usage(uuid, text, integer, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function
  public.record_model_usage(uuid, text, integer, bigint, bigint, bigint)
  to service_role;
