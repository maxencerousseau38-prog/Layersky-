import 'server-only';
import { modelConfigured, requireModelKey } from '@/lib/closer/model';
import { createClient } from '@/lib/supabase/server';
import {
  type DraftEvidence,
  DraftRejected,
  type DraftRequest,
  buildDraftPrompt,
  parseDraftResponse,
} from '@localize-infra/closer-core';

/**
 * Asking a model for a first message, and writing the result somewhere a human
 * has to look at it.
 *
 * The prompt and the validation live in `closer-core` where they can be tested
 * without a network. What is here is the part that cannot: reading the
 * evidence, calling Anthropic, and recording both the execution and the draft.
 *
 * The draft lands in `pending_approval` and there is no path from this function
 * to anything a recipient sees. That is not caution about the model's quality —
 * it is that `closer_approve_message` reads `auth.uid()`, so a code path with no
 * signed-in person cannot approve, whatever it passes.
 */

const MODEL = 'claude-opus-5';

/**
 * How the sender describes what they do — trusted input, unlike the evidence.
 *
 * A constant rather than a column because there is one sender: Closer is the
 * operator's own tooling. When there are two, this becomes a row in
 * `closer_workspaces`, and the change is a migration rather than a rewrite.
 */
const SENDER_PITCH = [
  'Layersky turns a repository into translated locale files and opens a',
  'pull request with them. Developer-first: no dashboard to adopt, no',
  'per-word billing, and the agent raises ambiguous strings as questions',
  'rather than guessing at them.',
].join(' ');

/**
 * The deployed origin, which stays `localize-infra-site` because that is what
 * it is.
 *
 * The product is Layersky; the Vercel project is not renamed, and this string
 * is doing two jobs that both need the real host. It is handed to the model as
 * a link it may use, and `allowedHosts` in `@localize-infra/closer-core`
 * derives the URL allow-list from it — so a prettier value here would not make
 * a prettier link, it would make every link in the draft fail validation.
 *
 * It changes when a custom domain is attached, along with `SITE_URL` in
 * `apps/site/src/lib/routes.ts`, and not before.
 */
const SENDER_LINKS = ['https://localize-infra-site.vercel.app'];

export interface DraftOutcome {
  messageId: string;
  subject: string | null;
  body: string;
  citations: string[];
}

/** Re-exported so callers of this module do not need to know where it lives. */
export const draftingModelConfigured = modelConfigured;

interface AnthropicReply {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

async function askModel(
  system: string,
  user: string,
  apiKey: string,
): Promise<AnthropicReply> {
  const startedAt = Date.now();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Anthropic API error ${response.status}: ${await response.text()}`,
    );
  }

  const body = (await response.json()) as {
    content: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const block = body.content.find((part) => part.type === 'text');
  return {
    text: block?.text ?? '',
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * Draft a first message for a lead.
 *
 * Throws rather than returning a partial result, because every failure here is
 * something a person needs to read: no evidence to write from, no contact to
 * write to, a suppressed address, or a response that broke one of the rules in
 * `parseDraftResponse`. Silently producing a weaker draft would hide exactly
 * the cases where the system should stay quiet.
 */
export async function draftMessageForLead(
  organizationId: string,
  leadId: string,
  channel: 'email' | 'linkedin',
): Promise<DraftOutcome> {
  const apiKey = requireModelKey('Drafting');

  const supabase = await createClient();

  const { data: lead, error: leadError } = await supabase
    .from('closer_leads')
    .select('id, company_id, contact_id, stage')
    .eq('id', leadId)
    .maybeSingle();
  if (leadError || !lead) throw new Error('No such lead in this workspace');

  const { data: company } = await supabase
    .from('closer_companies')
    .select('name, repository')
    .eq('id', lead.company_id)
    .maybeSingle();
  if (!company) throw new Error('This lead has no company');

  /*
   * The contact: the one already chosen for the lead, else the first known one.
   *
   * Falling back rather than refusing because discovery records contacts before
   * anybody picks one, and refusing would make drafting impossible until
   * somebody performed a step no screen offers yet.
   */
  const { data: contacts } = await supabase
    .from('closer_contacts')
    .select('id, full_name, role_title, email')
    .eq('company_id', lead.company_id)
    .order('created_at', { ascending: true });

  const contact = lead.contact_id
    ? contacts?.find((row) => row.id === lead.contact_id)
    : contacts?.[0];
  if (!contact) {
    throw new Error(
      'No contact is known for this company, and outreach addressed to nobody is a template',
    );
  }

  /*
   * Pain first, then signals.
   *
   * Both are given to the model, but the order matters: a message that opens
   * with "you have next-intl" says nothing the reader does not know, while one
   * that opens with what their history shows at least earns the next sentence.
   * Capped at eight so a company with two hundred observations does not produce
   * a prompt in which the useful ones are buried.
   */
  const { data: evidenceRows } = await supabase
    .from('closer_evidence')
    .select('id, kind, label, summary, source_url, observed_at')
    .eq('company_id', lead.company_id)
    .order('observed_at', { ascending: false });

  const ordered = [
    ...(evidenceRows ?? []).filter((row) => row.kind === 'pain'),
    ...(evidenceRows ?? []).filter((row) => row.kind !== 'pain'),
  ].slice(0, 8);

  if (ordered.length === 0) {
    throw new Error(
      'No evidence has been recorded for this company; research it before writing to it',
    );
  }

  const evidence: DraftEvidence[] = ordered.map((row) => ({
    id: row.id,
    label: row.label,
    summary: row.summary,
    sourceUrl: row.source_url,
    observedAt: row.observed_at,
  }));

  const request: DraftRequest = {
    companyName: company.name,
    repository: company.repository ?? null,
    contactName: contact.full_name ?? null,
    contactRole: contact.role_title ?? null,
    channel,
    evidence,
    senderPitch: SENDER_PITCH,
    /*
     * The name a recipient reads, so it is the product's.
     *
     * `buildDraftPrompt` renders this as `FROM: …`, which means every draft
     * the model wrote signed off as "Localize Infra" — the old name, to
     * strangers, in the one place the company introduces itself. It survived
     * the rename because the shell audit looked at screens and this string
     * never reaches one: it goes into a prompt, and out through an email.
     */
    senderName: 'Layersky',
    senderLinks: SENDER_LINKS,
  };

  const { system, user } = buildDraftPrompt(request);
  const reply = await askModel(system, user, apiKey);

  /*
   * The execution is recorded before the draft is validated, and on the failure
   * path too.
   *
   * A rejected response is the row worth having: it is what a prompt change
   * would be measured against, and a log that only keeps successes cannot say
   * whether the rules are catching real problems or throwing away good work.
   */
  let parsed: ReturnType<typeof parseDraftResponse>;
  let failure: string | null = null;
  try {
    parsed = parseDraftResponse(reply.text, request);
  } catch (error) {
    failure =
      error instanceof DraftRejected
        ? `${error.rule}: ${error.message}`
        : String(error);
    await supabase.rpc('closer_record_ai_execution', {
      p_organization_id: organizationId,
      p_agent: 'outreach_drafting',
      p_model_id: MODEL,
      p_input: { leadId, channel, evidenceIds: evidence.map((e) => e.id) },
      p_output: { raw: reply.text.slice(0, 2000) },
      p_company_id: lead.company_id,
      p_input_tokens: reply.inputTokens,
      p_output_tokens: reply.outputTokens,
      p_latency_ms: reply.latencyMs,
      p_error: failure,
    });
    throw new Error(`The model's reply was rejected — ${failure}`);
  }

  const { data: execution } = await supabase.rpc('closer_record_ai_execution', {
    p_organization_id: organizationId,
    p_agent: 'outreach_drafting',
    p_model_id: MODEL,
    p_input: { leadId, channel, evidenceIds: evidence.map((e) => e.id) },
    p_output: {
      subject: parsed.subject,
      body: parsed.body,
      citations: parsed.citations,
    },
    p_company_id: lead.company_id,
    p_input_tokens: reply.inputTokens,
    p_output_tokens: reply.outputTokens,
    p_latency_ms: reply.latencyMs,
  });

  const { data: message, error: draftError } = await supabase.rpc(
    'closer_draft_message',
    {
      p_lead_id: leadId,
      p_contact_id: contact.id,
      p_channel: channel,
      p_body: parsed.body,
      p_grounded_in: parsed.citations,
      p_subject: parsed.subject,
      p_model: MODEL,
      p_ai_execution_id: execution?.id ?? null,
    },
  );

  if (draftError || !message) {
    throw new Error(draftError?.message ?? 'The draft could not be stored');
  }

  return {
    messageId: message.id,
    subject: parsed.subject,
    body: parsed.body,
    citations: parsed.citations,
  };
}
