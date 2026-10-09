'use client';

import {
  type CloserLossReason,
  type CloserStage,
  type CloserTrack,
  LOSS_REASON_LABELS,
  isTerminal,
  lossReasonRequired,
  stageLabel,
} from '@localize-infra/closer-core';
import {
  Button,
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@localize-infra/ui';
import { ArrowRight } from 'lucide-react';
import * as React from 'react';
import { type StageState, moveLeadStage } from './actions';

export interface StageOption {
  toStage: CloserStage;
  note: string;
}

/**
 * Moving the lead, with the field that only appears when it means something.
 *
 * ## Every option came from the database
 *
 * `moves` is `closer_stage_transitions` intersected with the lead's track, and
 * `lossReasons` is the rows of `closer_loss_reason_stages` for the stage this
 * lead is standing on. Neither list is assembled here. What is read from
 * `closer-core` is wording and the one presentational question a form has to
 * answer before it submits — whether to mark the loss reason required — and
 * the raise in `closer_set_stage` remains the guard.
 *
 * ## Approval is not offered
 *
 * `outreach_approved` is removed from the options. The edge exists and the
 * database would accept it; what records an approval is a person approving a
 * message on Approvals, and a stage selector that could set it directly would
 * route around the only gate this system has. The action refuses it too, so
 * the omission is not the protection — it is the explanation.
 */
export function StageForm({
  leadId,
  track,
  moves,
  lossReasons,
}: {
  leadId: string;
  track: CloserTrack;
  moves: StageOption[];
  lossReasons: CloserLossReason[];
}) {
  const [state, action, pending] = React.useActionState<StageState, FormData>(
    moveLeadStage,
    {},
  );

  const offered = moves.filter((m) => m.toStage !== 'outreach_approved');
  const approvalWasHidden = offered.length !== moves.length;

  const [toStage, setToStage] = React.useState<string>('');
  const [lossReason, setLossReason] = React.useState<string>('');

  const chosen = toStage as CloserStage | '';
  const terminal = chosen !== '' && isTerminal(chosen);
  const required = chosen !== '' && lossReasonRequired(chosen);

  /*
   * Clear the loss reason when the destination stops being one that takes it.
   * Left behind, a reason chosen for `lost` would travel with a later choice of
   * `replied`, and the database would refuse the move with a message about a
   * stage a lead is not lost at — a confusing refusal caused by a stale field
   * the operator could not see.
   */
  React.useEffect(() => {
    if (!terminal) setLossReason('');
  }, [terminal]);

  if (offered.length === 0) {
    return (
      <p className="text-small text-secondary">
        There is nowhere to move this lead from here.{' '}
        {approvalWasHidden
          ? 'The one transition out of this stage is an approval, which is recorded on Approvals.'
          : 'This stage is absorbing — the funnel has no edge out of it.'}
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="toStage" value={toStage} />
      <input type="hidden" name="lossReason" value={lossReason} />

      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-1">
          <SelectRoot value={toStage} onValueChange={setToStage}>
            <SelectTrigger
              className="w-full max-w-sm"
              aria-label="Move this lead to"
            >
              <SelectValue placeholder="Move to…" />
            </SelectTrigger>
            <SelectContent>
              {offered.map((move) => (
                <SelectItem key={move.toStage} value={move.toStage}>
                  {stageLabel(track, move.toStage).label}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        </div>

        {/*
         * The loss reason, present only for a stage that takes one. Required
         * for the three that mean a loss; offered but optional for `not_now`,
         * which can re-enter the funnel, and for `do_not_contact`, which
         * `closer_suppress` reaches with no reason to give.
         */}
        {terminal ? (
          <div className="min-w-0 flex-1">
            <SelectRoot value={lossReason} onValueChange={setLossReason}>
              <SelectTrigger
                className="w-full max-w-sm"
                aria-label={
                  required ? 'Loss reason (required)' : 'Loss reason (optional)'
                }
              >
                <SelectValue
                  placeholder={
                    required ? 'Why it was lost…' : 'Why (optional)…'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {lossReasons.map((reason) => (
                  <SelectItem key={reason} value={reason}>
                    {LOSS_REASON_LABELS[reason].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
            {required && lossReason === '' ? (
              <p className="mt-1 text-caption text-tertiary">
                A reason is required here, so the loss can be counted rather
                than only described.
              </p>
            ) : null}
            {lossReason ? (
              <p className="mt-1 text-caption text-tertiary">
                {LOSS_REASON_LABELS[lossReason as CloserLossReason].meaning}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <Textarea
        name="reason"
        rows={3}
        aria-label="Why this lead is moving"
        placeholder="Why. This is the only record of what happened, in your own words."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || toStage === ''}>
          <ArrowRight aria-hidden="true" />
          {pending ? 'Moving…' : 'Move lead'}
        </Button>

        {state.error ? (
          <span role="alert" className="text-caption text-failed-text">
            {state.error}
          </span>
        ) : null}
        {state.ok ? (
          <span aria-live="polite" className="text-caption text-secondary">
            {state.ok}
          </span>
        ) : null}
      </div>

      {approvalWasHidden ? (
        <p className="text-caption text-tertiary">
          Approval is not in this list. It is recorded by approving the message
          on Approvals, which is the only gate before anything is sent.
        </p>
      ) : null}
    </form>
  );
}
