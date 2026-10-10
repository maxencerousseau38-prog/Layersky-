-- A confirmed development user, for authenticated end-to-end runs.
--
-- NOT for production. It sets a known password, which is exactly what makes it
-- useful locally and unacceptable anywhere real. Nothing applies this
-- automatically; run it by hand against a development database.
--
-- Why a seed rather than a signup: Supabase requires email confirmation and
-- there is no inbox in a test run. GoTrue also rejects reserved TLDs, so
-- `.test` and `.invalid` addresses fail validation at signup — hence a
-- registrable-looking domain and a direct insert.
--
-- Every column GoTrue expects is written explicitly. Leaving the token columns
-- NULL produces a row that looks correct in psql and then fails the password
-- grant with "Invalid login credentials", which costs an hour to diagnose.

-- "NOT for production" used to be a sentence in a comment, and a sentence in a
-- comment does not stop anything. It did not stop this: while production and
-- development shared one Supabase project, this account authenticated against
-- the public deployment, and the file saying it should not still sat right
-- here. The two databases are now separate, and the rule is enforced rather
-- than written down.
--
-- The production database is stamped out of band, not by a migration —
-- migrations replay into development too, so a marker created by one could not
-- tell the two apart:
--
--   comment on database postgres is 'localize-infra-production';
--
-- A database with no stamp is assumed to be development, which is the safe
-- default: a forgotten stamp costs a refused seed on a real database only if
-- someone also forgot to stamp it, whereas the reverse default would let an
-- unstamped production database be seeded silently.
do $$
begin
  if coalesce(
       shobj_description(
         (select oid from pg_database where datname = current_database()),
         'pg_database'),
       '') = 'localize-infra-production'
  then
    raise exception
      'refusing to seed: this database is stamped as production (%). This seed writes a password that is committed to the repository.',
      current_database();
  end if;
end $$;

-- Clear a previous application of this seed, workspace first.
--
-- `delete from auth.users` alone was here, and it made the file single-use:
-- `organizations.created_by` references `auth.users` ON DELETE **RESTRICT**, so
-- the moment this seed had created a workspace, re-running it aborted at this
-- line with a foreign key violation. Nothing said so — the failure named
-- `organizations_created_by_fkey`, several statements away from the workspace
-- it was actually protecting, and the file that appeared to reset the fixture
-- reset nothing.
--
-- Deleting the organization first satisfies the restrict, and it cascades to
-- projects, runs, translations, ambiguities, members and entitlements — every
-- row this file goes on to create. By slug rather than by owner, because the
-- slug is what this seed claims and what `create_organization` would collide
-- with below.
--
-- Both deletes run as the seed's own role. They would be silent no-ops as
-- `authenticated`: these tables grant SELECT to members and no DELETE at all,
-- so RLS discards the statement without raising, and the fixture then looks
-- applied while carrying rows from every previous run.
delete from public.organizations where slug = 'acceptance';
delete from auth.users where email = 'acceptance@localize-infra.dev';
-- The member of that workspace, deleted after it: membership rows go with the
-- organization's cascade, and this account owns no organization of its own, so
-- nothing restricts it.
delete from auth.users where email = 'member@localize-infra.dev';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  invited_at, confirmation_token, confirmation_sent_at,
  recovery_token, recovery_sent_at,
  email_change_token_new, email_change, email_change_sent_at,
  last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
  email_change_token_current, email_change_confirm_status,
  banned_until, reauthentication_token, reauthentication_sent_at,
  is_sso_user, deleted_at, is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'acceptance@localize-infra.dev', crypt('acceptance-test-pw-8chars', gen_salt('bf')), now(),
  null, '', null,
  '', null,
  '', '', null,
  null, '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  false, now(), now(),
  null, null, '', '', null,
  '', 0,
  null, '', null,
  false, null, false
);

-- A workspace and a project for the authenticated end-to-end suite to read.
--
-- Fixtures rather than test-created data: a suite that creates a workspace on
-- every run accumulates rows in a shared database and starts failing on the
-- unique slug the second time. These are created by the seed and asserted
-- against — recreated from scratch on each application, which is what the
-- cascade above buys and what makes the suite's counts mean something.
--
-- create_organization() is called as the seeded user by setting the JWT claim,
-- which is also the only way to exercise the same path the application uses.
do $$
declare
  uid uuid;
  org public.organizations;
begin
  select id into uid from auth.users where email = 'acceptance@localize-infra.dev';

  -- Claims must be set before the role switch; afterwards the GUC is no longer
  -- settable and auth.uid() stays null.
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);

  org := public.create_organization('Acceptance', 'acceptance');

  /*
   * Demo carries a repository, because Demo carries runs.
   *
   * It did not, and the two facts together were a state the product cannot
   * produce: `startRun` returns 'Connect a repository before running.' before
   * it reaches `start_run`, so a run against a project with no
   * `repository_owner` has no path through the application. The seed reached
   * `public.start_run` directly — the SQL function, which has no such guard,
   * because the guard belongs to the action that calls it — and wrote three of
   * them anyway.
   *
   * It showed. `/acceptance/projects` read "Repository connected 0" beside
   * "Runs started 3" and "Pull requests opened 1", and the funnel was right
   * every time: it reports what the rows say, and the rows said something
   * impossible. A fixture that cannot happen teaches a reader to distrust the
   * screen rather than the fixture, and it is the screen that was telling the
   * truth.
   *
   * The values are not invented. `finish_run` below stamps this project's
   * succeeded run with
   * `https://github.com/maxencerousseau38-prog/localize-infra-fixture-vite/pull/1`
   * — so the pull request already named a repository the project claimed not to
   * have. This makes the pointer agree with the artefact it produced.
   *
   * Connected four hours ago, which is before the oldest run (three hours, see
   * the offsets at the end of this file). A connection stamped after the run it
   * enabled is the same class of impossibility, one field along.
   */
  insert into public.projects (
    organization_id, name, slug, source_locale, target_locales,
    repository_owner, repository_name, repository_branch,
    repository_connected_at
  )
  values (
    org.id, 'Demo', 'demo', 'en', array['fr','de'],
    'maxencerousseau38-prog', 'localize-infra-fixture-vite', 'main',
    now() - interval '4 hours'
  );

  /*
   * A second project, existing only to be written to.
   *
   * `playwright.config.ts` sets `fullyParallel: true`, so any test that
   * mutates a project shared with a reader loses a race sooner or later. The
   * first version of the target-languages tests mutated 'Demo' and restored it
   * afterwards; the suite passed once, left 'Demo' with no locales, and failed
   * on the next run inside a different test — the one asserting the page
   * reports its real configuration. No amount of restore discipline fixes
   * that, because the reader can run while the value is emptied.
   *
   * So the mutating test owns this row instead. It needs no cleanup: nothing
   * else reads it, and re-seeding puts it back.
   *
   * This added that `deleteProject` had no caller, so a test could not remove a
   * project it created. True until #81, which gave it one — the deletion test
   * now creates and removes its own project, and that is why it is re-runnable.
   * This row still exists because the languages test *mutates* rather than
   * creates, which no amount of deletion helps.
   */
  /*
   * Languages keeps no repository, deliberately.
   *
   * A project with target locales and no repository is a state the product
   * produces constantly — create a project, connect GitHub later — so the
   * fixture should contain one. What it must not contain is that project with
   * runs against it, and this one has none.
   */
  insert into public.projects (organization_id, name, slug, source_locale, target_locales)
  values (org.id, 'Languages', 'languages', 'en', array['fr','de']);

  perform set_config('role','postgres',true);
end $$;

-- A member of the acceptance workspace who is not an owner or an admin.
--
-- The role split is load-bearing and, until this account existed, untested.
-- `projects_select_member` admits every member; `projects_delete_admin` admits
-- only owners and admins. So a member can open a project and cannot delete it,
-- and `deleteProject` depends on that asymmetry: it reads the project under the
-- first policy and deletes under the second, which is why it counts the rows
-- the delete returned instead of trusting the absence of an error.
--
-- There is no product path that creates a membership — no invite flow exists —
-- so this is inserted directly rather than through a function, unlike the
-- workspaces above.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  invited_at, confirmation_token, confirmation_sent_at,
  recovery_token, recovery_sent_at,
  email_change_token_new, email_change, email_change_sent_at,
  last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
  email_change_token_current, email_change_confirm_status,
  banned_until, reauthentication_token, reauthentication_sent_at,
  is_sso_user, deleted_at, is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'member@localize-infra.dev', crypt('member-test-pw-12chars', gen_salt('bf')), now(),
  null, '', null,
  '', null,
  '', '', null,
  null, '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  false, now(), now(),
  null, null, '', '', null,
  '', 0,
  null, '', null,
  false, null, false
);

insert into public.organization_members (organization_id, user_id, role)
select o.id, u.id, 'member'
  from public.organizations o, auth.users u
 where o.slug = 'acceptance'
   and u.email = 'member@localize-infra.dev';

-- The second tenant, which three tests depend on and the seed never created.
--
-- `intruder-co` and its owner existed only in the development database,
-- inserted by hand. On a fresh database the sign-in in
-- `workspace.spec.ts:212` timed out, because there was no such account — and
-- that was the *visible* failure.
--
-- The invisible one matters more. Two of those three tests assert that a
-- workspace which is not yours answers 404, and an absent workspace answers
-- 404 as well. They passed on every empty database while proving nothing about
-- isolation, which is exactly the shape of assertion this repository treats as
-- a defect. Seeding this tenant is what turns them from vacuous to real: the
-- workspace now exists, its owner can reach it, and a 404 for anybody else is
-- RLS refusing rather than Postgres finding nothing.
--
-- Deleted first, in the same order and for the same reason as the acceptance
-- rows above: as `authenticated` these deletes are silent no-ops under RLS, so
-- they run as the seed's own role.
delete from public.organizations where slug = 'intruder-co';
delete from auth.users where email = 'intruder@localize-infra.dev';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  invited_at, confirmation_token, confirmation_sent_at,
  recovery_token, recovery_sent_at,
  email_change_token_new, email_change, email_change_sent_at,
  last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
  email_change_token_current, email_change_confirm_status,
  banned_until, reauthentication_token, reauthentication_sent_at,
  is_sso_user, deleted_at, is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'intruder@localize-infra.dev', crypt('intruder-test-pw-8chars', gen_salt('bf')), now(),
  null, '', null,
  '', null,
  '', '', null,
  null, '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  false, now(), now(),
  null, null, '', '', null,
  '', 0,
  null, '', null,
  false, null, false
);

-- Created through `create_organization` as that user, like the workspace above.
--
-- The membership row is the point: it is what makes this a workspace somebody
-- owns rather than an orphan the tests could not tell from a typo. Written the
-- same way the application writes it, so the fixture is a shape the product can
-- actually produce.
do $$
declare
  uid uuid;
  org public.organizations;
begin
  select id into uid from auth.users where email = 'intruder@localize-infra.dev';

  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);

  org := public.create_organization('Intruder Co', 'intruder-co');

  -- No repository and no target languages, deliberately: this workspace exists
  -- to be refused, not to run anything. `workspace.spec.ts:212` reads it as the
  -- case of a workspace with no GitHub installation.
  insert into public.projects (organization_id, name, slug, source_locale, target_locales)
  values (org.id, 'Theirs', 'theirs', 'en', array[]::text[]);

  perform set_config('role','postgres',true);
end $$;

-- Two runs, so the authenticated suite has rows to assert over.
--
-- Everything above this point gave the suite a workspace and a project; there
-- was still nothing a run produced, so the data-surface contract (DESIGN.md §8:
-- a result count, a filter, sortable columns, a designed empty state) and every
-- run-detail assertion were skipped for want of a fixture rather than because
-- they were wrong.
--
-- Two rather than one, because the interesting assertions are about telling
-- states apart:
--
--   * a succeeded run, with a pull request, timing and per-locale proposals —
--     the history a customer reads after the fact;
--   * a run stopped at `awaiting_review` with an unanswered question — the
--     state the whole escalation gate exists to produce, and the one /review
--     and /ambiguity read.
--
-- Written through the same RPCs the application calls, as the seeded user, so
-- the fixture exercises the real path including its membership checks. Rows
-- inserted directly would be a shape the product cannot actually produce, which
-- is the failure mode the sample data had.
do $$
declare
  uid uuid;
  proj public.projects;
  finished public.runs;
  waiting public.runs;
  unchanged public.runs;
begin
  select id into uid from auth.users where email = 'acceptance@localize-infra.dev';
  select p.* into proj
    from public.projects p
    join public.organizations o on o.id = p.organization_id
   where o.slug = 'acceptance' and p.slug = 'demo';

  -- No delete here. The project is created fresh above, by a `create_organization`
  -- that the file's opening cascade guarantees is the only one — so the suite's
  -- "2 runs" is true because these are the only two runs the project has ever
  -- had, not because something cleaned up after a previous pass.
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);

  -- 1. The run that finished and opened a pull request.
  finished := public.start_run(proj.id);
  perform public.record_run_translations(
    finished.id,
    jsonb_build_array(
      jsonb_build_object('locale','fr','translation_key','app.save','source_text','Save','proposed_text','Enregistrer','origin','model'),
      jsonb_build_object('locale','fr','translation_key','app.cancel','source_text','Cancel','proposed_text','Annuler','origin','model'),
      jsonb_build_object('locale','de','translation_key','app.save','source_text','Save','proposed_text','Speichern','origin','model'),
      jsonb_build_object('locale','de','translation_key','app.cancel','source_text','Cancel','proposed_text','Abbrechen','origin','model')
    ),
    'src/locales'
  );
  perform public.finish_run(
    finished.id, 'succeeded', 'pull_request', 'Vite + React',
    2, 4, 2, 0, null,
    'https://github.com/maxencerousseau38-prog/localize-infra-fixture-vite/pull/1',
    1, 'localize-infra/add-translations-seed'
  );

  -- 2. The run that stopped to ask. `finish_run` with 'awaiting_review' is the
  --    same call the pipeline makes when it raises an escalation.
  waiting := public.start_run(proj.id);
  perform public.record_run_translations(
    waiting.id,
    jsonb_build_array(
      jsonb_build_object('locale','fr','translation_key','app.close','source_text','Close','proposed_text','Fermer','origin','model'),
      jsonb_build_object('locale','de','translation_key','app.close','source_text','Close','proposed_text','Nah','origin','model')
    ),
    'src/locales'
  );
  perform public.record_ambiguity(
    waiting.id, 'app.close', 'de', 'Close', 'Nah',
    'Verb or adjective? German uses different words, and the surrounding code does not disambiguate.',
    jsonb_build_array(
      jsonb_build_object('text','Schließen','rationale','Verb — "to close". Correct if this is a button.'),
      jsonb_build_object('text','Nah','rationale','Adjective — "nearby".')
    )
  );
  perform public.finish_run(
    waiting.id, 'awaiting_review', 'escalate', 'Vite + React',
    1, 2, 2, 0, null, null, null, null
  );

  -- 3. The run that found nothing to do.
  --
  --    `finish_run` with 'no_changes' at stage 'translate' is exactly the call
  --    run-actions.ts makes when every key already has a translation. No
  --    `record_run_translations` before it, deliberately: that path returns
  --    before recording proposals, and a fixture that recorded some would be a
  --    shape the product cannot produce — the failure the old sample data had.
  --
  --    `keys_translated` is 0 while `locales_succeeded` is 2, and that is what
  --    makes this fixture worth having. /runs/[id] derives a shortfall from
  --    `keys_extracted * locales_succeeded - keys_translated`, so without the
  --    guard this status now carries, it announces four missing translations
  --    for a run that was never short of anything.
  unchanged := public.start_run(proj.id);
  perform public.finish_run(
    unchanged.id, 'no_changes', 'translate', 'Vite + React',
    2, 0, 2, 0, null, null, null, null
  );

  perform set_config('role','postgres',true);

  -- Give the two runs distinct times, on the owner's side of the switch.
  --
  -- Both were created inside one transaction, and `now()` in Postgres is the
  -- *transaction* start time, not the wall clock — so every column the RPCs
  -- stamped came out byte-identical: both `created_at`, both `started_at`, both
  -- `finished_at`. Two consequences, and neither announced itself:
  --
  --   * /locales reads "the newest run that produced anything" with
  --     `order by created_at desc limit 1`. With a tie Postgres returns
  --     whichever row it likes, so coverage described the succeeded run on one
  --     pass of the suite and the escalated one on the next. A fixture that
  --     changes its mind is worse than no fixture.
  --   * `finished_at - started_at` was zero, so both runs displayed a duration
  --     of `0ms` — a measurement nobody took, presented as one.
  --
  -- Fixed offsets rather than `clock_timestamp()`: relative to the seed, so the
  -- rows never look stale, but the interval between them is a constant, which
  -- is what makes "the newest run" and a stable duration reproducible.
  --
  -- `runs` has no UPDATE policy, so this only works as the owner — the same
  -- reason the delete above sits before the role switch.
  update public.runs
     set created_at  = now() - interval '2 hours',
         started_at  = now() - interval '2 hours',
         finished_at = now() - interval '2 hours' + interval '22.4 seconds'
   where project_id = proj.id and status = 'succeeded';

  update public.runs
     set created_at  = now() - interval '30 minutes',
         started_at  = now() - interval '30 minutes',
         finished_at = now() - interval '30 minutes' + interval '9.7 seconds'
   where project_id = proj.id and status = 'awaiting_review';

  -- The oldest of the three, and that is load-bearing.
  --
  -- `listLocaleCoverageForViewer` takes the newest run with `keys_extracted > 0`
  -- across every run the viewer can see, and this one qualifies: it extracted
  -- two keys and translated none. Seeded newer, it would become the source of
  -- /locales coverage while carrying no proposals at all, and those assertions
  -- would read an empty run instead of the succeeded one.
  --
  -- 3.1 seconds because a run that opens no pull request skips the whole GitHub
  -- write. The first real one measured 3.12s, against 14.4s for the empty pull
  -- requests it replaced.
  update public.runs
     set created_at  = now() - interval '3 hours',
         started_at  = now() - interval '3 hours',
         finished_at = now() - interval '3 hours' + interval '3.1 seconds'
   where project_id = proj.id and status = 'no_changes';

  /*
   * Closer, on for the seeded workspace.
   *
   * Without this the sidebar has no Closer group and /closer answers 404, which
   * is the correct behaviour and would make the acceptance suite unable to see
   * the screen at all.
   *
   * **This statement had never once run.** It said `org.id`, and `org` is
   * declared in the block above, not this one — so the whole seed aborted here
   * with "missing FROM-clause entry for table org". Nobody saw it because
   * nobody had ever replayed the seed from an empty database; the development
   * database got its Closer row by hand, which is exactly what the comment
   * here used to deny.
   *
   * `proj.organization_id` rather than a fresh lookup: `proj` is already the
   * demo project of the acceptance workspace, selected twenty lines above.
   */
  insert into public.closer_workspaces (organization_id, note)
  values (proj.organization_id, 'Seeded development workspace')
  on conflict (organization_id) do nothing;

  /*
   * And who may operate it. Enabling Closer for an organization no longer
   * grants anybody access — `20261010000100_closer_operators.sql` made that an
   * explicit per-user row, because every *member* of the workspace could
   * otherwise read the pipeline.
   *
   * **The seed has to do this itself, and that is not a duplicate of the
   * migration's bootstrap.** `supabase db reset` applies migrations to an empty
   * database and only then runs this file, so at migration time there is no
   * `closer_workspaces` row for the bootstrap to find and it grants nothing.
   * The bootstrap exists for the *existing* production database, where the row
   * is already there; this exists for a database built from scratch. Without
   * it, Closer answers 404 for everybody here and
   * `supabase/tests/closer-operators.sql` fails on `owner-has-grant`.
   *
   * The owner only. `member@localize-infra.dev` is deliberately left without a
   * grant — that account is the subject of the refusal proofs, and giving it
   * one would quietly turn them into tests of nothing.
   */
  insert into public.closer_operators (organization_id, user_id, granted_reason)
  select proj.organization_id, m.user_id, 'seed: the acceptance workspace owner'
  from public.organization_members m
  where m.organization_id = proj.organization_id
    and m.role = 'owner'
  on conflict (organization_id, user_id) do nothing;
end $$;

/* ------------------------------------------------------------------ *
 * Closer — a pipeline with something in it
 * ------------------------------------------------------------------ */

/*
 * Four leads, on both tracks, written through the real functions.
 *
 * Every stage here is set by `closer_set_stage`, never by an UPDATE. That is
 * not fastidiousness: the function is the only writer, it refuses an edge the
 * transition table does not contain, and it is what writes
 * `closer_stage_history` — so a fixture that set `stage` directly would
 * produce a lead with a stage and no history, a state the product cannot
 * reach, and the lead sheet would render "no stage change recorded" beside a
 * stage that plainly changed.
 *
 * It also means the loss fixture exercises the lot-5 guards for real: the
 * `installed → lost` move below is refused outright without a loss reason, and
 * `installed_never_used` has to be a pair the taxonomy allows at `installed`.
 *
 * **One lead exists only to be moved by a test.** `Movable Co` is never
 * asserted on by the display tests, because `fullyParallel` means a suite that
 * mutates a row another test reads cannot be made to win the race — the lesson
 * `workspace.spec.ts` paid for by giving itself its own project.
 */
do $$
declare
  uid uuid;
  closer_org uuid;
  partner_org uuid;
  company_id uuid;
  dp public.closer_leads;
  lost public.closer_leads;
  sales public.closer_leads;
  gated public.closer_leads;
begin
  select id into uid from auth.users where email = 'acceptance@localize-infra.dev';
  select organization_id into closer_org from public.closer_workspaces limit 1;
  if uid is null or closer_org is null then
    raise notice 'Closer fixtures skipped: no seeded user or workspace';
    return;
  end if;

  /*
   * Re-runnable, which the rest of this block is not.
   *
   * `closer_open_lead` refuses a second lead for one company and
   * `closer_set_stage` refuses a move to the stage a lead is already at, so
   * replaying this would abort the seed partway — and a seed that aborts
   * partway is how `closer_workspaces` went years without ever being inserted.
   */
  if exists (
    select 1 from public.closer_companies
     where organization_id = closer_org and domain = 'partnerco.test'
  ) then
    raise notice 'Closer fixtures already present';
    return;
  end if;

  /*
   * The prospect's own workspace, which is a *different tenant*.
   *
   * This is what makes the activation fixture honest. The milestones are
   * derived from another organization's `organization_github_installations`
   * and `i18n_checks` rows, read through a `service_role` function that checks
   * the operator against the lead's workspace — so a fixture inside the
   * operator's own organization would prove nothing about the boundary being
   * crossed.
   *
   * `closer_activation_candidates` matches `account_login` against the first
   * path segment of the company's `repository` and excludes the lead's own
   * organization. Hence `partnerco` here and `partnerco/app` below.
   */
  insert into public.organizations (name, slug, created_by)
  values ('Partner Co', 'partner-co', uid)
  on conflict (slug) do nothing;
  select id into partner_org from public.organizations where slug = 'partner-co';

  /*
   * 770001, and the number is not arbitrary.
   *
   * `organization_github_installations.installation_id` is unique **globally**
   * — one installation belongs to one account, and letting two workspaces
   * claim it would let either act as the other. The seed persists; the proofs
   * roll back. So a number the seed holds is a number no proof can ever use,
   * and `entitlements.sql` already uses 991001–991004. Seeded with 991001 this
   * made that proof fail with "did not reach its raise", which reads as a
   * broken script rather than as an occupied identifier.
   *
   * Third time in this subsystem that a new fixture invalidated an older
   * proof — after `closer-suppression.sql` in #145 and `closer-track.sql` in
   * #146. The pattern is the same each time and so is the check that finds it
   * in one command: grep the new fixture's identifiers against
   * `supabase/tests/` before adding them.
   *
   * 77xxxx is this block's range, chosen because nothing in the repository
   * used it.
   */
  insert into public.organization_github_installations
    (organization_id, installation_id, account_login, account_type,
     connected_by, connected_at)
  values (partner_org, 770001, 'partnerco', 'Organization', uid,
          now() - interval '12 days')
  on conflict (organization_id) do nothing;

  /*
   * Three checks, on three pull requests, on three different days.
   *
   * `repeated_usage` needs two of each (`ACTIVATION_THRESHOLDS`), so three
   * clears it with a margin — a fixture sitting exactly on a threshold starts
   * failing silently the day the threshold moves.
   */
  insert into public.i18n_checks
    (organization_id, repository_owner, repository_name, pull_number, head_sha,
     conclusion, title, summary, correction_applied, created_at)
  values
    (partner_org, 'partnerco', 'app', 41, 'aaa1111', 'neutral',
     '2 i18n problems', 'Checked 1 key against 6 languages', 0,
     now() - interval '9 days'),
    (partner_org, 'partnerco', 'app', 42, 'bbb2222', 'neutral',
     '1 i18n problem', 'Checked 2 keys against 6 languages', 5,
     now() - interval '5 days'),
    (partner_org, 'partnerco', 'app', 43, 'ccc3333', 'success',
     'No i18n problems', 'Checked 3 keys against 6 languages', 0,
     now() - interval '2 days');

  -- Claims before the role switch: afterwards the GUC is no longer settable
  -- and auth.uid() stays null, which every function below reads.
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);

  company_id := (public.closer_upsert_company(
    closer_org, 'Partner Co', 'partnerco.test', 'github_repository',
    'https://github.com/partnerco/app', 'partnerco/app',
    array['typescript'], array['en','fr','de'], 18)).id;
  dp := public.closer_open_lead(company_id);

  company_id := (public.closer_upsert_company(
    closer_org, 'Noisy Co', 'noisyco.test', 'github_repository',
    'https://github.com/noisyco/web', 'noisyco/web',
    array['typescript'], array['en','es'], 11)).id;
  lost := public.closer_open_lead(company_id);

  company_id := (public.closer_upsert_company(
    closer_org, 'Sales Co', 'salesco.test', 'github_repository',
    'https://github.com/salesco/site', 'salesco/site',
    array['typescript'], array['en','it'], 30)).id;
  sales := public.closer_open_lead(company_id);

  company_id := (public.closer_upsert_company(
    closer_org, 'Movable Co', 'movableco.test', 'github_repository',
    'https://github.com/movableco/app', 'movableco/app',
    array['typescript'], array['en','ja'], 7)).id;
  perform public.closer_open_lead(company_id);

  /*
   * One lead stopped at `ready_for_outreach`, and it is the only place the
   * approval gate can be observed.
   *
   * `ready_for_outreach → outreach_approved` is a real edge, so this is the one
   * stage where the lead sheet has something to withhold. Asserted anywhere
   * else, "Approved is not offered" would pass because the graph has no such
   * edge from there — a refusal credited to the gate that actually came from
   * the transition table, which is how the first draft of `closer-track.sql`
   * fooled itself.
   */
  company_id := (public.closer_upsert_company(
    closer_org, 'Gated Co', 'gatedco.test', 'github_repository',
    'https://github.com/gatedco/app', 'gatedco/app',
    array['typescript'], array['en','nl'], 14)).id;
  gated := public.closer_open_lead(company_id);

  /*
   * `closer_leads.track` defaults to `design_partner` — the motion this
   * product is running now — so only the sales lead is switched, and that
   * needs the owner because the table has no UPDATE policy.
   */
  perform set_config('role','postgres',true);
  update public.closer_leads set track = 'sales' where id = sales.id;
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);

  -- A design partner that installed and came back.
  dp := public.closer_set_stage(dp.id,'qualified','public signals support a fit');
  dp := public.closer_set_stage(dp.id,'researched','brief written from the repository');
  dp := public.closer_set_stage(dp.id,'ready_for_outreach','a contact and an angle exist');
  dp := public.closer_set_stage(dp.id,'outreach_approved','a person approved the message');
  dp := public.closer_set_stage(dp.id,'contacted','sent by hand');
  dp := public.closer_set_stage(dp.id,'replied','they answered');
  dp := public.closer_set_stage(dp.id,'interested','the answer was positive');
  dp := public.closer_set_stage(dp.id,'installed','they connected the GitHub App');

  -- One that installed and never used it: the most informative failure.
  lost := public.closer_set_stage(lost.id,'qualified','public signals support a fit');
  lost := public.closer_set_stage(lost.id,'researched','brief written');
  lost := public.closer_set_stage(lost.id,'ready_for_outreach','angle holds');
  lost := public.closer_set_stage(lost.id,'outreach_approved','a person approved');
  lost := public.closer_set_stage(lost.id,'contacted','sent by hand');
  lost := public.closer_set_stage(lost.id,'replied','they answered');
  lost := public.closer_set_stage(lost.id,'interested','the answer was positive');
  lost := public.closer_set_stage(lost.id,'installed','they connected the GitHub App');
  lost := public.closer_set_stage(
    lost.id,'lost','connected it and no check ever ran on a pull request',
    'installed_never_used');

  -- Up to the gate and no further.
  gated := public.closer_set_stage(gated.id,'qualified','public signals support a fit');
  gated := public.closer_set_stage(gated.id,'researched','brief written');
  gated := public.closer_set_stage(gated.id,'ready_for_outreach','a contact and an angle exist');

  -- And one on the original motion, to show the two coexist.
  sales := public.closer_set_stage(sales.id,'researching','gathering evidence');
  sales := public.closer_set_stage(sales.id,'qualified','the evidence supports a fit');
  sales := public.closer_set_stage(sales.id,'ready_for_outreach','a contact and an angle exist');
  sales := public.closer_set_stage(sales.id,'outreach_approved','a person approved the message');
  sales := public.closer_set_stage(sales.id,'contacted','sent by hand');

  /*
   * The link, written by the function rather than by an UPDATE.
   *
   * `closer_link_activation` refuses an organization that is not already a
   * candidate — so it checks the installation, the repository owner, that it is
   * not the operator's own workspace, and that no other lead claims it. Setting
   * the column directly would skip the only security boundary this subsystem
   * has, and the fixture would stop proving that boundary holds.
   *
   * `service_role` only, so this runs as the owner.
   */
  perform set_config('role','postgres',true);
  perform public.closer_link_activation(dp.id, partner_org, uid);
end $$;
