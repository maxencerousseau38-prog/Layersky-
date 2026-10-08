-- Closer — opt-out, suppression and lead creation, proved against the database.
--
-- Written after a pre-merge audit found that suppressing by **email** stopped
-- no lead at all: `closer_suppress` reached the contact through
-- `closer_leads.contact_id`, a column nothing in this repository has ever
-- written. The domain half worked, which is why the hole was invisible — every
-- company with a resolvable homepage was stopped by its domain row, and only a
-- company with a null domain went unprotected.
--
-- It was found by exercising the function, never by reading it. So it is
-- exercised here, permanently.
--
-- Same shape as `tenant-isolation.sql`: fixtures, assertions, then a deliberate
-- RAISE that aborts the transaction so the database is left exactly as it was
-- found. Read the results out of the error message. Not wired into
-- `npm run gates` for the same reason as that file — CI has no database.

do $$
declare
  u uuid := '33333333-3333-3333-3333-333333333333';
  org uuid;
  c_domain public.closer_companies;   -- has a domain
  c_nodomain public.closer_companies; -- has none: the case the bug hit
  ct_a public.closer_contacts;
  ct_b public.closer_contacts;
  ct_c public.closer_contacts;
  lead_a public.closer_leads;
  lead_b public.closer_leads;
  stage_now public.closer_stage;
  c_late public.closer_companies;
  ct_late public.closer_contacts;
  lead_late public.closer_leads;
  ev_late public.closer_evidence;
  msg_late public.closer_messages;
  msg_sent public.closer_messages;
  c_early public.closer_companies;
  ct_early public.closer_contacts;
  lead_early public.closer_leads;
  ev_early public.closer_evidence;
  state_now public.closer_message_state;
  c_f1 public.closer_companies;
  ct_f1 public.closer_contacts;
  lead_f1 public.closer_leads;
  r_f2 public.closer_replies;
  actor_seen uuid;
  c_c3 public.closer_companies;
  ct_c3 public.closer_contacts;
  stage_text text;
  n int; ok boolean; r text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','closer@test.invalid','',now(),now())
  on conflict (id) do nothing;

  -- Claims first, while still the owner role.
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);

  org := (public.create_organization('Closer Test','closer-test-'||floor(random()*100000)::text)).id;

  c_domain := public.closer_upsert_company(
    org,'WithDomain','with-domain.test.invalid','github_repository',
    'https://github.com/t/a','t/a');
  c_nodomain := public.closer_upsert_company(
    org,'NoDomain',null,'github_repository',
    'https://github.com/t/b','t/b');

  ct_a := public.closer_record_contact(c_domain.id,'github_repository','https://github.com/t/a','A','Eng','a@with-domain.test.invalid');
  ct_b := public.closer_record_contact(c_domain.id,'github_repository','https://github.com/t/a','B','Eng','b@with-domain.test.invalid');
  ct_c := public.closer_record_contact(c_nodomain.id,'github_repository','https://github.com/t/b','C','Eng','c@elsewhere.test.invalid');

  lead_a := public.closer_open_lead(c_domain.id);
  lead_b := public.closer_open_lead(c_nodomain.id);

  /*
   * These fixtures are sales-track leads.
   *
   * `closer_leads.track` defaults to `design_partner`, which is the motion
   * this product runs now. This file is a historical proof about the *sales*
   * funnel: it walks `researching`, a stage the design-partner track does not
   * own, so without this the first transition is refused by the track check
   * and every assertion after it collapses.
   *
   * Written explicitly rather than by changing the default. The default
   * describes the product; this describes the fixture. `postgres` because
   * `closer_leads` carries a select policy and nothing else — the only writer
   * is `closer_set_stage`, which deliberately has no way to change a track.
   */
  perform set_config('role','postgres',true);
  update public.closer_leads set track = 'sales' where id = any (array[lead_a.id, lead_b.id]);
  perform set_config('role','authenticated',true);

  /* ---- lead creation ------------------------------------------------ */

  ok := (public.closer_open_lead(c_domain.id)).id = lead_a.id;
  r := r || format('open-lead-idempotent=%s(want t); ', ok);

  select count(*) into n from public.closer_stage_history where lead_id = lead_a.id;
  r := r || format('one-history-row-on-reopen=%s(want 1); ', n);

  /* ---- transitions --------------------------------------------------- */

  ok := false;
  begin perform public.closer_set_stage(lead_a.id,'won','Skipping the funnel');
  exception when others then ok := true; end;
  r := r || format('illegal-edge-refused=%s(want t); ', ok);

  ok := false;
  begin perform public.closer_set_stage(lead_a.id,'researching','   ');
  exception when others then ok := true; end;
  r := r || format('empty-reason-refused=%s(want t); ', ok);

  -- Walk both leads deep enough that stopping them is a real move.
  perform public.closer_set_stage(lead_a.id,'researching','Research begins');
  perform public.closer_set_stage(lead_a.id,'qualified','Evidence supports a fit');
  perform public.closer_set_stage(lead_b.id,'researching','Research begins');
  perform public.closer_set_stage(lead_b.id,'qualified','Evidence supports a fit');

  select count(*) into n from public.closer_stage_transitions where from_stage = 'do_not_contact';
  r := r || format('do-not-contact-terminal=%s(want 0); ', n);

  /* ---- opt-out: the company WITHOUT a domain ------------------------- */
  -- The regression. Only an email identifier exists here, so if the email arm
  -- of the loop is unreachable this lead is never stopped.

  perform public.closer_suppress(org,null,ct_c.email,'opted_out','audit');

  select stage into stage_now from public.closer_leads where id = lead_b.id;
  r := r || format('email-optout-stops-nodomain-lead=%s(want do_not_contact); ', stage_now);

  ok := false;
  begin perform public.closer_draft_message(
    lead_b.id, ct_c.id, 'email', 'After the opt-out.',
    array[gen_random_uuid()], 'Nope');
  exception when others then ok := true; end;
  r := r || format('draft-after-optout-refused=%s(want t); ', ok);

  /* ---- opt-out reaches a colleague ----------------------------------- */
  -- One person asking to be left alone is not an invitation to write to the
  -- next desk. Suppressing A must stop the lead B is reached through.

  perform public.closer_suppress(org,null,ct_a.email,'opted_out','audit');
  select stage into stage_now from public.closer_leads where id = lead_a.id;
  r := r || format('email-optout-stops-colleagues-lead=%s(want do_not_contact); ', stage_now);

  -- And it is idempotent: a second call writes no second stop.
  perform public.closer_suppress(org,null,ct_a.email,'opted_out','audit again');
  select count(*) into n from public.closer_stage_history
   where lead_id = lead_a.id and to_stage = 'do_not_contact';
  r := r || format('one-stop-row-after-two-suppressions=%s(want 1); ', n);

  /* ---- a suppressed contact blocks a NEW lead ------------------------ */

  delete from public.closer_leads where id = lead_b.id;
  ok := false;
  begin perform public.closer_open_lead(c_nodomain.id);
  exception when others then ok := true; end;
  r := r || format('new-lead-blocked-by-suppressed-contact=%s(want t); ', ok);

  /* ---- a suppressed company must not come back through discovery ----- */
  -- The D2 regression. `closer_upsert_company` checked membership and nothing
  -- else, so the next discovery run re-upserted a company that had opted out
  -- and it reappeared in the list looking like a fresh prospect. Contact was
  -- never possible — five other guards saw to that — but a name somebody
  -- promised never to look at again was back on the screen.
  perform public.closer_suppress(org, 'with-domain.test.invalid', null, 'opted_out', 'audit');

  ok := false;
  begin perform public.closer_upsert_company(
    org,'WithDomain','with-domain.test.invalid','github_repository',
    'https://github.com/t/a','t/a');
  exception when others then ok := true; end;
  r := r || format('rediscovery-of-suppressed-company-refused=%s(want t); ', ok);

  -- A different company is untouched: the check is scoped to the identifier,
  -- not a blanket stop on discovery.
  ok := true;
  begin perform public.closer_upsert_company(
    org,'Unrelated','unrelated.test.invalid','github_repository',
    'https://github.com/t/c','t/c');
  exception when others then ok := false; end;
  r := r || format('unsuppressed-company-still-discoverable=%s(want t); ', ok);

  -- A company with no domain has no identifier to check, and must still be
  -- recordable — that is the early-stage team discovery exists to find.
  ok := true;
  begin perform public.closer_upsert_company(
    org,'NoDomainTwo',null,'github_repository','https://github.com/t/d','t/d');
  exception when others then ok := false; end;
  r := r || format('nodomain-company-still-recordable=%s(want t); ', ok);

  /* ---- an opt-out arriving AFTER approval ---------------------------- */
  --
  -- The audit finding. `closer_mark_message_sent` checked only the message's
  -- state, so a message approved before an opt-out could still be recorded as
  -- sent afterwards — and went on being offered on the approvals screen with no
  -- warning at all. Nothing here sends, so the human copying the text out is
  -- the only real send, and that screen is where they copy it from.

  c_late := public.closer_upsert_company(
    org,'LateOptOut','late.test.invalid','github_repository','https://github.com/t/e','t/e');
  ct_late := public.closer_record_contact(
    c_late.id,'github_repository','https://github.com/t/e','L','Eng','l@late.test.invalid');
  ev_late := public.closer_record_evidence(
    c_late.id,'pain','translation_commit_frequency','9 commits in 90 days',
    'github_commit','https://github.com/t/e/commits', now());
  lead_late := public.closer_open_lead(c_late.id);

  -- Sales-track fixture, for the reason given at the first one.
  perform set_config('role','postgres',true);
  update public.closer_leads set track = 'sales' where id = lead_late.id;
  perform set_config('role','authenticated',true);

  perform public.closer_set_stage(lead_late.id,'researching','Research begins');
  perform public.closer_set_stage(lead_late.id,'qualified','Evidence supports a fit');
  perform public.closer_set_stage(lead_late.id,'ready_for_outreach','A contact and an angle exist');

  msg_late := public.closer_draft_message(
    lead_late.id, ct_late.id, 'email', 'A message approved before the opt-out.',
    array[ev_late.id], 'Hello');
  msg_late := public.closer_approve_message(msg_late.id);
  r := r || format('approved-before-optout=%s(want approved); ', msg_late.state);

  -- The opt-out lands after the approval.
  perform public.closer_suppress(org, null, ct_late.email, 'opted_out', 'audit late');

  ok := false;
  begin perform public.closer_mark_message_sent(msg_late.id);
  exception when others then ok := true; end;
  r := r || format('mark-sent-refused-after-late-optout=%s(want t); ', ok);

  select state into state_now from public.closer_messages where id = msg_late.id;
  r := r || format('message-stays-approved-not-sent=%s(want approved); ', state_now);

  /* ---- an opt-out arriving BEFORE approval --------------------------- */
  -- Already guarded, asserted here so the pair is checked together and a future
  -- change cannot fix one order while breaking the other.

  ok := false;
  begin perform public.closer_approve_message(msg_late.id);
  exception when others then ok := true; end;
  r := r || format('approve-refused-after-optout=%s(want t); ', ok);

  /* ---- a send recorded BEFORE the opt-out is left alone --------------- */
  -- A contact that really happened is a fact, and the fix must not erase it. A
  -- system that did would be lying about its own history in the direction that
  -- flatters it.
  --
  -- Built on its own company so the earlier suppressions cannot reach it, taken
  -- all the way to `sent`, and only then suppressed.

  c_early := public.closer_upsert_company(
    org,'EarlySend','early.test.invalid','github_repository','https://github.com/t/f','t/f');
  ct_early := public.closer_record_contact(
    c_early.id,'github_repository','https://github.com/t/f','E','Eng','e@early.test.invalid');
  ev_early := public.closer_record_evidence(
    c_early.id,'pain','translation_commit_frequency','7 commits in 90 days',
    'github_commit','https://github.com/t/f/commits', now());
  lead_early := public.closer_open_lead(c_early.id);

  -- Sales-track fixture, for the reason given at the first one.
  perform set_config('role','postgres',true);
  update public.closer_leads set track = 'sales' where id = lead_early.id;
  perform set_config('role','authenticated',true);

  perform public.closer_set_stage(lead_early.id,'researching','Research begins');
  perform public.closer_set_stage(lead_early.id,'qualified','Evidence supports a fit');
  perform public.closer_set_stage(lead_early.id,'ready_for_outreach','A contact and an angle exist');

  msg_sent := public.closer_draft_message(
    lead_early.id, ct_early.id, 'email', 'Sent before anything was suppressed.',
    array[ev_early.id], 'Earlier');
  msg_sent := public.closer_approve_message(msg_sent.id);
  perform public.closer_set_stage(lead_early.id,'outreach_approved','A human approved the draft');
  msg_sent := public.closer_mark_message_sent(msg_sent.id);
  r := r || format('send-recorded-before-optout=%s(want sent); ', msg_sent.state);

  perform public.closer_suppress(org, null, ct_early.email, 'opted_out', 'audit early');

  select state into state_now from public.closer_messages where id = msg_sent.id;
  r := r || format('earlier-send-still-sent=%s(want sent); ', state_now);

  select count(*) into n from public.closer_messages
   where id = msg_sent.id and sent_by is not null and sent_at is not null;
  r := r || format('earlier-send-keeps-its-actor=%s(want 1); ', n);

  /* ---- F1: a suppressed domain covers addresses at that domain ------- */
  --
  -- `closer_is_suppressed` compared the domain list to the *company's* domain
  -- column and addresses by exact equality; the domain inside an address was
  -- never compared to anything. A company with a null domain — the case
  -- `closer_upsert_company` deliberately keeps — was therefore invisible to a
  -- domain-level opt-out. Reproduced all the way to an approved message before
  -- the fix.

  -- (a) the domain itself, the case that always worked
  r := r || format('f1-known-domain-suppressed=%s(want t); ',
    public.closer_is_suppressed(org, 'with-domain.test.invalid', null));

  -- (b) the finding: an address at that domain, company domain null
  r := r || format('f1-address-at-suppressed-domain=%s(want t); ',
    public.closer_is_suppressed(org, null, 'anyone@with-domain.test.invalid'));

  -- (c) an address that is on no list, at no suppressed domain
  r := r || format('f1-unrelated-address=%s(want f); ',
    public.closer_is_suppressed(org, null, 'nobody@untouched.test.invalid'));

  -- And the whole path, not just the predicate: a null-domain company whose
  -- contact is at the suppressed domain must not acquire a contact at all.
  c_f1 := public.closer_upsert_company(
    org,'F1NullDomain',null,'github_repository','https://github.com/t/h','t/h');
  ok := false;
  begin ct_f1 := public.closer_record_contact(
    c_f1.id,'github_repository','https://github.com/t/h','F','Eng','f@with-domain.test.invalid');
  exception when others then ok := true; end;
  r := r || format('f1-contact-at-suppressed-domain-refused=%s(want t); ', ok);

  /* ---- F2: a classification must not erase a confirmed judgement ----- */
  --
  -- `model_intent` and `operator_intent` exist to measure how often the
  -- classifier is right. An agent free to re-classify after confirmation turns
  -- its own mistakes into agreements, silently, in the direction that flatters
  -- it. Reproduced: question/not_a_fit became not_a_fit/not_a_fit.

  -- Built here rather than looked for: an earlier version of this block took
  -- whatever reply happened to exist and skipped itself when none did, which
  -- is a test that reports success by not running.
  r_f2 := public.closer_record_reply(
    msg_sent.id, 'Can you send pricing?', now(), null, null);
  perform public.closer_classify_reply(r_f2.id,'question',0.8,'Can you send pricing?','m');
  perform public.closer_confirm_reply_intent(r_f2.id, 'not_a_fit');

  ok := false;
  begin perform public.closer_classify_reply(r_f2.id,'not_a_fit',0.99,'Can you send pricing?','m');
  exception when others then ok := true; end;
  r := r || format('f2-reclassify-after-confirmation-refused=%s(want t); ', ok);

  select model_intent::text || '/' || operator_intent::text into stage_text
  from public.closer_replies where id = r_f2.id;
  r := r || format('f2-disagreement-preserved=%s(want question/not_a_fit); ', stage_text);

  -- Re-classifying a reply nobody has judged yet stays allowed: that is
  -- re-running a model on something still open, which is ordinary.
  r_f2 := public.closer_record_reply(
    msg_sent.id, 'Second reply, unjudged.', now(), null, null);
  perform public.closer_classify_reply(r_f2.id,'question',0.5,'Second','m');
  ok := true;
  begin perform public.closer_classify_reply(r_f2.id,'unclear',0.4,'Second','m');
  exception when others then ok := false; end;
  r := r || format('f2-reclassify-before-confirmation-allowed=%s(want t); ', ok);

  /* ---- F3: the actor is derived, never supplied ---------------------- */
  --
  -- `closer_set_stage` took `p_actor` and wrote it unchecked. Reproduced: a
  -- member attributed a stage change to an account that was not even in the
  -- workspace. The parameter is gone; the four-argument form must not exist.

  ok := not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'closer_set_stage'
      and pg_get_function_identity_arguments(p.oid) like '%uuid, public.closer_stage, text, uuid%');
  r := r || format('f3-no-caller-supplied-actor-overload=%s(want t); ', ok);

  lead_f1 := public.closer_open_lead(c_f1.id);

  -- Sales-track fixture, for the reason given at the first one.
  perform set_config('role','postgres',true);
  update public.closer_leads set track = 'sales' where id = lead_f1.id;
  perform set_config('role','authenticated',true);

  perform public.closer_set_stage(lead_f1.id,'researching','Research begins');
  select actor into actor_seen from public.closer_stage_history
   where lead_id = lead_f1.id and to_stage = 'researching';
  r := r || format('f3-actor-is-the-caller=%s(want t); ', actor_seen = u);

  /* ---- F4: the domain of an address is canonicalised before matching -- */
  --
  -- The previous fix compared `s.domain` to `split_part(email,'@',2)`, which is
  -- string equality on a token neither canonicalised nor reliably extracted. An
  -- audit reproduced five ways past it, each reaching an approved message:
  -- a trailing dot, two of them, a quoted local part containing '@' (so
  -- `split_part` returned the wrong token entirely), an uppercase variant of
  -- the same, and an address padded with spaces.
  --
  -- `with-domain.test.invalid` is suppressed by domain earlier in this suite.

  r := r || format('f4-trailing-dot=%s(want t); ',
    public.closer_is_suppressed(org, null, 'a@with-domain.test.invalid.'));
  r := r || format('f4-two-trailing-dots=%s(want t); ',
    public.closer_is_suppressed(org, null, 'a@with-domain.test.invalid..'));
  r := r || format('f4-quoted-local-part-with-at=%s(want t); ',
    public.closer_is_suppressed(org, null, '"a@b"@with-domain.test.invalid'));
  r := r || format('f4-uppercase-and-dot=%s(want t); ',
    public.closer_is_suppressed(org, null, 'A@WITH-DOMAIN.TEST.INVALID.'));
  r := r || format('f4-padded=%s(want t); ',
    public.closer_is_suppressed(org, null, '  a@with-domain.test.invalid  '));

  -- The other direction: a suppression whose STORED value is non-canonical must
  -- still catch the plain address.
  --
  -- An earlier version of this wrote through `closer_suppress`, which
  -- canonicalises on the way in — so the stored value was already clean and the
  -- match was trivial. It asserted nothing about the arm it named. The row is
  -- now inserted directly, in the shape rows written before the canonicalisation
  -- migration actually have, which is the only way to exercise it.
  perform set_config('role','postgres',true);
  insert into public.closer_suppressions (organization_id, domain, email, reason, note)
  values (org, 'legacy.test.invalid.', null, 'opted_out', 'pre-canonicalisation shape');
  insert into public.closer_suppressions (organization_id, domain, email, reason, note)
  -- Lowercase, because `closer_suppressions_email_check` has required that
  -- since the first migration. The trailing dot is the part canonicalisation
  -- added, and the only part a legacy row can differ by.
  values (org, null, 'old@legacy2.test.invalid.', 'opted_out', 'pre-canonicalisation shape');
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);

  r := r || format('f4-legacy-row-kept-its-shape=%s(want legacy.test.invalid.); ',
    (select domain from public.closer_suppressions
      where organization_id = org and domain like 'legacy.%' limit 1));
  r := r || format('f4-legacy-domain-row-matches-address=%s(want t); ',
    public.closer_is_suppressed(org, null, 'someone@legacy.test.invalid'));
  r := r || format('f4-legacy-domain-row-matches-domain=%s(want t); ',
    public.closer_is_suppressed(org, 'legacy.test.invalid', null));
  r := r || format('f4-legacy-email-row-matches-address=%s(want t); ',
    public.closer_is_suppressed(org, null, 'old@legacy2.test.invalid'));
  r := r || format('f4-legacy-rows-do-not-overmatch=%s(want f); ',
    public.closer_is_suppressed(org, null, 'x@nothing-to-do-with-it.test.invalid'));

  -- Written through the function, the stored value is canonical.
  perform public.closer_suppress(org, '  CANON.TEST.INVALID.  ', null, 'opted_out', 'f4');
  r := r || format('f4-stored-domain-is-canonical=%s(want canon.test.invalid); ',
    (select domain from public.closer_suppressions
      where organization_id = org and domain like '%canon%' limit 1));

  -- And it must stay a fix rather than a blanket block: a different domain is
  -- untouched, and a subdomain remains a distinct party by design.
  r := r || format('f4-unrelated-domain-still-reachable=%s(want f); ',
    public.closer_is_suppressed(org, null, 'ok@somewhere-else.test.invalid'));
  r := r || format('f4-subdomain-still-distinct=%s(want f); ',
    public.closer_is_suppressed(org, null, 'a@mail.with-domain.test.invalid'));

  -- An address with no '@' has no domain, and must not be read as one.
  r := r || format('f4-no-at-sign-is-not-a-domain=%s(want f); ',
    public.closer_is_suppressed(org, null, 'with-domain.test.invalid'));

  /* ---- C2: rows predating canonicalisation are backfilled -------------- */
  --
  -- The canonicalisation migration canonicalised on write and left existing
  -- rows alone. The guard compensates at comparison time — asserted above — but
  -- identity does not: `closer_upsert_company` canonicalises its input, so a
  -- company row holding `acme.example.` stopped being found by
  -- `on conflict (organization_id, domain)`. Reproduced: rediscovery produced a
  -- second company row and split the evidence between them.

  perform set_config('role','postgres',true);
  insert into public.closer_companies (organization_id,name,domain,discovered_from,discovered_url)
  values (org,'C2 Legacy','c2-legacy.test.invalid.','github_repository','https://github.com/c/2');
  update public.closer_companies cc
     set domain = public.closer_canonical_domain(cc.domain)
   where cc.domain is not null
     and cc.domain is distinct from public.closer_canonical_domain(cc.domain)
     and not exists (select 1 from public.closer_companies o
                     where o.organization_id = cc.organization_id and o.id <> cc.id
                       and o.domain = public.closer_canonical_domain(cc.domain));
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);

  r := r || format('c2-backfilled=%s(want c2-legacy.test.invalid); ',
    (select domain from public.closer_companies where organization_id=org and name='C2 Legacy'));
  perform public.closer_upsert_company(org,'C2 Legacy','c2-legacy.test.invalid','github_repository','https://github.com/c/2','c/2');
  select count(*) into n from public.closer_companies where organization_id=org and name='C2 Legacy';
  r := r || format('c2-rediscovery-merges-not-duplicates=%s(want 1); ', n);

  /* ---- C3: an address-only opt-out also stops rediscovery -------------- */
  --
  -- The discovery check looked at the domain only, so an address-level opt-out
  -- left the company free to reappear. Reproduced with the four guards measured
  -- separately: lead stopped, drafting refused, fresh lead refused — and the
  -- company row re-upserted anyway. Three out of four is the same symptom the
  -- earlier fix was written for, arriving by the other identifier.

  c_c3 := public.closer_upsert_company(org,'C3','c3.test.invalid','github_repository','https://github.com/c/3','c/3');
  ct_c3 := public.closer_record_contact(c_c3.id,'github_repository','https://github.com/c/3','C','Eng','c3@c3.test.invalid');
  perform public.closer_suppress(org, null, ct_c3.email, 'opted_out', 'c3');

  ok := false;
  begin perform public.closer_upsert_company(org,'C3','c3.test.invalid','github_repository','https://github.com/c/3','c/3');
  exception when others then ok := true; end;
  r := r || format('c3-rediscovery-refused-on-address-optout=%s(want t); ', ok);

  -- Still a fix rather than a blanket block.
  ok := true;
  begin perform public.closer_upsert_company(org,'C3ok','c3-unrelated.test.invalid','github_repository','https://github.com/c/3','c/3');
  exception when others then ok := false; end;
  r := r || format('c3-unrelated-company-still-discoverable=%s(want t); ', ok);

  /* ---- the fixtures are, and stay, sales-track ----------------------- */
  --
  -- CI found this file the day the design-partner track landed: every lead
  -- here defaulted to `design_partner` and the first `researching` was
  -- refused, because that stage belongs to the other motion. The fix is four
  -- explicit assignments above; this is what stops the ambiguity coming back.
  --
  -- Two counts, not one. Asserting only "none is design_partner" would pass
  -- on an empty table, which is exactly how a future refactor that stopped
  -- creating leads would look green. The population is pinned first.
  --
  -- Five, and the fifth is worth knowing about. The `delete from
  -- closer_leads` above runs as `authenticated` against a table carrying a
  -- select policy and nothing else, so RLS makes it a no-op: the row is still
  -- there. Measured, not assumed. The assertion that follows it still holds —
  -- `closer_open_lead` refuses because the contact is suppressed — but it
  -- holds for a different reason than the delete suggests. Left alone here
  -- because this change is about the track, and rewriting that line would
  -- change what the file exercises.

  select count(*) into n from public.closer_leads where organization_id = org;
  r := r || format('fixture-leads=%s(want 5); ', n);

  select count(*) into n from public.closer_leads
   where organization_id = org and track <> 'sales';
  r := r || format('fixture-leads-off-sales=%s(want 0); ', n);

  raise exception 'CLOSER-SUPPRESSION >> %', r;
end $$;
