-- Self-serve private repositories: who gets the entitlement, and who keeps it.
--
-- `organization_entitlements.private_repositories` defaults to false and, until
-- `20261003000100`, had no product path to true. The product's own refusal said
-- so: "Paid plans are not priced yet, so this cannot be upgraded today." The
-- one workspace that ever got past it was granted by hand, in SQL, which is the
-- manual step self-serve cannot have.
--
-- Connecting a GitHub App installation now grants it. That changes no security
-- boundary — what Layersky can read is decided by the installation token, and
-- `listInstallationRepositories` reads `GET /installation/repositories` — so
-- what is proven here is the *commercial* resolution and, above all, its
-- edges: reinstalling, disconnecting, and the grants this flow must never
-- touch.
--
-- **The asymmetry is the whole file.** A grant made by a human — an operator's
-- own workspace, a design partner, a support case — must survive a disconnect,
-- because its grounds were never the installation. Revocation therefore matches
-- on `granted_reason`, not on the boolean, and that is only correct if the
-- grant refuses to overwrite a reason it did not write. Both halves are asserted
-- below, because either one alone would let the other rot.
--
-- Like the other proofs here this ends in a deliberate RAISE: the transaction
-- rolls back, the database is left as it was found, and the verdict is read out
-- of the error message by supabase/tests/run.sh.
do $$
declare
  owner_id uuid := '55555555-5555-5555-5555-555555555555';
  self_org public.organizations;
  human_org public.organizations;
  v boolean; reason text; n int; r text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ent@test.invalid','',now(),now())
  on conflict (id) do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub',owner_id,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  self_org  := public.create_organization('Ent self','ent-self');
  human_org := public.create_organization('Ent human','ent-human');
  perform set_config('role','postgres',true);

  -- A workspace that has done nothing is not entitled. Asserted first: every
  -- claim below is about a change, and a row that started true would make
  -- "connecting granted it" true for the wrong reason.
  select private_repositories into v
    from public.organization_entitlements where organization_id=self_org.id;
  r := r || format('fresh-entitled=%s(want f); ', v);

  -- Connecting grants it, and records why.
  perform public.link_github_installation(self_org.id, 991001, 'ent', 'Organization', owner_id);
  select private_repositories, granted_reason into v, reason
    from public.organization_entitlements where organization_id=self_org.id;
  r := r || format('after-connect=%s(want t); ', v);
  r := r || format('provenance-recorded=%s(want t); ',
                   reason = public.self_serve_grant_reason());

  -- Reinstalling is the case that produced a new installation id on 2026-09-29.
  -- One link, still entitled: an upsert, not a second row and not a regrant
  -- that could clobber the reason.
  perform public.link_github_installation(self_org.id, 991002, 'ent', 'Organization', owner_id);
  select private_repositories into v
    from public.organization_entitlements where organization_id=self_org.id;
  select count(*) into n
    from public.organization_github_installations where organization_id=self_org.id;
  r := r || format('after-reinstall=%s(want t); links=%s(want 1); ', v, n);

  -- A human grant keeps its own provenance when the workspace connects.
  update public.organization_entitlements
     set private_repositories=true, granted_reason='design partner, agreed by hand'
   where organization_id=human_org.id;
  perform public.link_github_installation(human_org.id, 991003, 'ent', 'Organization', owner_id);
  select granted_reason into reason
    from public.organization_entitlements where organization_id=human_org.id;
  r := r || format('human-provenance-kept=%s(want t); ',
                   reason = 'design partner, agreed by hand');

  -- Disconnecting takes back what this flow gave.
  perform public.unlink_github_installation(self_org.id, owner_id);
  select private_repositories into v
    from public.organization_entitlements where organization_id=self_org.id;
  select count(*) into n
    from public.organization_github_installations where organization_id=self_org.id;
  r := r || format('after-disconnect=%s(want f); links-gone=%s(want 0); ', v, n);

  -- And never what a human gave. This is the assertion the reason-matching
  -- exists for; without it, disconnecting would silently downgrade a design
  -- partner.
  perform public.unlink_github_installation(human_org.id, owner_id);
  select private_repositories into v
    from public.organization_entitlements where organization_id=human_org.id;
  r := r || format('human-grant-survives=%s(want t); ', v);

  -- Uninstalled on GitHub's side: keyed by installation id, no user, because
  -- the webhook has neither a session nor a page the owner will visit.
  perform public.link_github_installation(self_org.id, 991004, 'ent', 'Organization', owner_id);
  select public.forget_github_installation(991004) into n;
  r := r || format('forget-removed=%s(want 1); ', n);
  select private_repositories into v
    from public.organization_entitlements where organization_id=self_org.id;
  select count(*) into n
    from public.organization_github_installations where organization_id=self_org.id;
  r := r || format('forget-revoked=%s(want f); forget-links=%s(want 0); ', v, n);

  -- A delivery for an installation this deployment never knew about must not
  -- report success. It returns the rows it removed, which is none.
  select public.forget_github_installation(979797) into n;
  r := r || format('forget-unknown=%s(want 0); ', n);

  -- A non-member still cannot connect. The grant is new; the guard is not, and
  -- a capability that now comes with it must not have loosened who may trigger
  -- it.
  begin
    perform public.link_github_installation(
      self_org.id, 991005, 'ent', 'Organization',
      '66666666-6666-6666-6666-666666666666');
    r := r || 'nonmember-refused=f(want t); ';
  exception when others then
    r := r || 'nonmember-refused=t(want t); ';
  end;

  raise exception 'ENTITLEMENTS >> %', r;
end $$;
