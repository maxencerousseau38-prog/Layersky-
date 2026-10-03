-- Connecting GitHub grants the private-repository entitlement, and
-- disconnecting takes it back.
--
-- ## The dead end this removes
--
-- `organization_entitlements.private_repositories` defaults to false and had
-- no product path to true. The refusal said so in its own words:
--
--   "Private repositories need a paid plan. Public repositories are free and
--    unlimited. Paid plans are not priced yet, so this cannot be upgraded
--    today."
--
-- A gate pointing at a plan nobody can buy is not a commercial boundary, it is
-- a stop. `layersky` only ever got past it because somebody ran an UPDATE by
-- hand, which is exactly the manual step self-serve cannot have.
--
-- ## Why granting it here changes no security boundary
--
-- This flag has never been a security control, and `20260817000700` says so:
-- it is denormalised from the plan "so a workspace can be granted access
-- without inventing a plan for it". What decides which repositories Layersky
-- can read is the **GitHub App installation**: every token is minted for one
-- installation, `listInstallationRepositories` reads
-- `GET /installation/repositories`, and a repository the owner did not select
-- is not in that list and not reachable by that token. Granting this flag
-- cannot widen that by one repository.
--
-- So the question is only *when* the commercial capability is resolved, and
-- the answer is: at the moment the workspace proves it controls an
-- installation. `link_github_installation` is already that moment — the OAuth
-- callback asks GitHub, with the user's own token, whether they can reach the
-- installation, and only then calls this function as `service_role`.
--
-- ## What this is not
--
-- It is not billing, and it does not make `/pricing` untrue: that page says
-- public repositories are free permanently and that "final prices are not set
-- yet". Private projects remain the axis a future plan will price. The day a
-- plan exists, **this is the one line that becomes a plan check** — which is
-- why the reason string records why the grant happened rather than leaving a
-- true boolean with no provenance.

/** Marks a grant this flow made, so revocation never touches a human's. */
create or replace function public.self_serve_grant_reason()
returns text
language sql
immutable
as $$
  select 'self-serve: connected a GitHub App installation while no plan is priced'::text;
$$;

revoke execute on function public.self_serve_grant_reason() from public, anon;
grant execute on function public.self_serve_grant_reason() to authenticated, service_role;

create or replace function public.link_github_installation(
  p_organization_id uuid,
  p_installation_id bigint,
  p_account_login text,
  p_account_type text,
  p_user_id uuid
)
returns public.organization_github_installations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_role public.organization_role;
  linked public.organization_github_installations;
begin
  select m.role into acting_role
    from public.organization_members m
   where m.organization_id = p_organization_id
     and m.user_id = p_user_id;

  -- NULL — no user given, or not a member — must refuse. It is tested first
  -- because `NULL not in (…)` is NULL, and that is the defect this replaces.
  if acting_role is null or acting_role not in ('owner', 'admin') then
    raise exception 'only an owner or admin can connect GitHub'
      using errcode = '42501';
  end if;

  insert into public.organization_github_installations as existing (
    organization_id, installation_id, account_login, account_type, connected_by
  )
  values (
    p_organization_id, p_installation_id, p_account_login, p_account_type,
    p_user_id
  )
  on conflict (organization_id) do update set
    installation_id = excluded.installation_id,
    account_login = excluded.account_login,
    account_type = excluded.account_type,
    connected_by = excluded.connected_by,
    connected_at = now()
  returning * into linked;

  /*
   * The entitlement, resolved in the same transaction as the link.
   *
   * `insert … on conflict` rather than `update`, because a row may be absent:
   * the trigger on `organizations` creates one, but an organization that
   * predates `20260817000700` only has one through that migration's backfill,
   * and "the row is always there" is the kind of assumption that is true until
   * it is not. This way a missing row is created rather than silently skipped.
   *
   * `plan` is deliberately untouched. The flag is denormalised precisely so a
   * capability can be granted without inventing a plan, and writing 'pro' here
   * would make every billing surface claim a subscription that does not exist.
   *
   * The reason is only written when there is none, so a grant made by a human
   * — a design partner, a support case — keeps its own provenance and is not
   * relabelled as self-serve. That matters for the revocation below.
   */
  insert into public.organization_entitlements as e (
    organization_id, private_repositories, granted_reason
  )
  values (
    p_organization_id, true, public.self_serve_grant_reason()
  )
  on conflict (organization_id) do update set
    private_repositories = true,
    granted_reason = coalesce(e.granted_reason, excluded.granted_reason),
    updated_at = now();

  return linked;
end;
$$;

create or replace function public.unlink_github_installation(
  p_organization_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_role public.organization_role;
begin
  select m.role into acting_role
    from public.organization_members m
   where m.organization_id = p_organization_id
     and m.user_id = p_user_id;

  if acting_role is null or acting_role not in ('owner', 'admin') then
    raise exception 'only an owner or admin can disconnect GitHub'
      using errcode = '42501';
  end if;

  delete from public.organization_github_installations
   where organization_id = p_organization_id;

  perform public.revoke_self_serve_private_repositories(p_organization_id);
end;
$$;

/**
 * Take back only what this flow granted.
 *
 * The `granted_reason` test is the whole function. A workspace granted private
 * repositories by a human — an operator's own, a design partner, a support
 * case — must keep that grant when it disconnects GitHub, because the grounds
 * for it were never the installation. Revoking on reason rather than on the
 * boolean is what separates the two, and it is why the grant above refuses to
 * overwrite a reason it did not write.
 *
 * Not `security definer` by accident: it is called from two definer functions
 * and from the webhook's service-role path, and never by a client.
 */
create or replace function public.revoke_self_serve_private_repositories(
  p_organization_id uuid
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.organization_entitlements
     set private_repositories = false,
         granted_reason = null,
         updated_at = now()
   where organization_id = p_organization_id
     and granted_reason = public.self_serve_grant_reason();
$$;

revoke execute on function
  public.revoke_self_serve_private_repositories(uuid)
  from public, anon, authenticated;
grant execute on function
  public.revoke_self_serve_private_repositories(uuid)
  to service_role;

/**
 * The App was uninstalled on GitHub's side, so forget the installation.
 *
 * Keyed by `installation_id` and taking no user, because there is no user on
 * this path: it is called from the webhook, which GitHub signed, for an
 * `installation.deleted` delivery. The owner who uninstalled did so on
 * github.com and will never visit a page here to confirm it.
 *
 * Until now nothing told this product an installation was gone. The row
 * survived, `/[org]/start` kept saying GitHub was connected, and the discovery
 * came from a run that failed after paying for every locale — which is the
 * trap `CLAUDE.md` records and the Verify button was added to work around.
 *
 * Returns the number of links removed so the caller can say whether the
 * delivery matched anything, rather than reporting success for an installation
 * this deployment never knew about.
 */
create or replace function public.forget_github_installation(
  p_installation_id bigint
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid;
  removed integer;
begin
  select organization_id into org
    from public.organization_github_installations
   where installation_id = p_installation_id;

  if org is null then
    return 0;
  end if;

  delete from public.organization_github_installations
   where organization_id = org;
  get diagnostics removed = row_count;

  perform public.revoke_self_serve_private_repositories(org);

  return removed;
end;
$$;

revoke execute on function public.forget_github_installation(bigint)
  from public, anon, authenticated;
grant execute on function public.forget_github_installation(bigint)
  to service_role;

/*
 * Backfill, so the workspaces that already connected are not left behind the
 * flow that now grants on connection.
 *
 * Only those with a link and no existing reason: a grant a human made keeps
 * its provenance, and a workspace that never connected gets nothing.
 */
update public.organization_entitlements e
   set private_repositories = true,
       granted_reason = public.self_serve_grant_reason(),
       updated_at = now()
 where e.granted_reason is null
   and e.private_repositories = false
   and exists (
     select 1 from public.organization_github_installations gi
      where gi.organization_id = e.organization_id
   );

comment on function public.self_serve_grant_reason() is
  'The provenance string for a private-repository grant made by connecting GitHub. Revocation matches on it so a human grant is never taken back.';
