'use server';

import { hasCloser } from '@/lib/closer/access';
import { requireSession } from '@/lib/data/workspace';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';

/**
 * Move a lead, through the one writer that exists.
 *
 * `closer_set_stage` applies every rule: the edge has to be in
 * `closer_stage_transitions`, the destination has to belong to the lead's
 * track, a reason is always required, a loss reason is required on the three
 * terminals that mean a loss and has to fit the stage being left, and a
 * suppressed company is refused outright. None of that is repeated here, and
 * the refusals are shown to the operator verbatim — they are written as
 * sentences precisely so that a screen can.
 *
 * **Only exported functions, and all of them async.** A `'use server'` module
 * that exports a constant is accepted by `tsc` and by `next build`, and refused
 * at runtime with "A \"use server\" file can only export async functions" — the
 * trap that cost `/[org]/start` a button that silently did nothing. The state
 * shape is a `type`, which is erased.
 */

/*
 * Optional fields on one object, not a union of three shapes.
 *
 * Written as a union first, which `tsc` refused: narrowing to `{ error:
 * string }` makes `state.ok` a property that does not exist on that member, so
 * the form could not read both. `RecordReplyState` has the same shape for the
 * same reason.
 */
export type StageState = { ok?: string; error?: string };

/*
 * Approval is not a stage an operator can type.
 *
 * `ready_for_outreach → outreach_approved` is the transition that records a
 * human opening the gate, and the gate is a message being approved on
 * `/closer/approvals` — `closer_approve_message` is what moves it. Offering it
 * here would let the stage be set without a message ever being reviewed, which
 * is the one thing the approval gate exists to prevent. The graph still
 * contains the edge; this surface refuses to be the one that walks it.
 */
const GATED_STAGE = 'outreach_approved';

export async function moveLeadStage(
  _previous: StageState,
  form: FormData,
): Promise<StageState> {
  /*
   * The guard is repeated here and not inherited from the layout. A server
   * action is an endpoint: it is reachable by anybody who can post to it,
   * whatever the page around it did.
   */
  if (!(await hasCloser())) notFound();
  await requireSession();

  const leadId = String(form.get('leadId') ?? '').trim();
  const toStage = String(form.get('toStage') ?? '').trim();
  const reason = String(form.get('reason') ?? '').trim();
  const lossReasonRaw = String(form.get('lossReason') ?? '').trim();

  if (!leadId) return { error: 'No lead was named' };
  if (!toStage) return { error: 'Choose a stage to move to' };

  /*
   * Required here as well as in the database, for the reason `rejectMessage`
   * gives: the database refusing an empty reason hands the operator a Postgres
   * error where a sentence belongs.
   */
  if (!reason) return { error: 'Say why this lead is moving' };

  if (toStage === GATED_STAGE) {
    return {
      error:
        'Approval is recorded by approving the message on Approvals, not by setting the stage here.',
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc('closer_set_stage', {
    p_lead_id: leadId,
    p_to_stage: toStage,
    p_reason: reason,
    /*
     * Absent rather than null when nothing was chosen, so the argument takes
     * its default. The parameter is optional on a four-argument function whose
     * fourth argument defaults to null — passing an explicit null would work
     * too, but omitting it keeps this call identical in shape to the two older
     * ones in `funnel.ts` and `replies/actions.ts`.
     */
    ...(lossReasonRaw ? { p_loss_reason: lossReasonRaw } : {}),
  });

  if (error) return { error: error.message };

  revalidatePath(`/closer/leads/${leadId}`);
  revalidatePath('/closer/companies');
  revalidatePath('/closer');

  return { ok: `Moved to ${toStage.replace(/_/g, ' ')}.` };
}
