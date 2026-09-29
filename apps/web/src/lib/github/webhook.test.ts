import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analysableFiles, decideWebhook, verifySignature } from './webhook';

const SECRET = 'a-webhook-secret';
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;

describe('verifySignature', () => {
  it('accepts a signature made with the same secret', () => {
    const body = '{"hello":"world"}';
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    const body = '{"hello":"world"}';
    expect(verifySignature(body, sign(body, 'other'), SECRET)).toBe(false);
  });

  /*
   * The reason the route reads `req.text()` once.
   *
   * The first version of this test used `{"b":1,"a":2}` and failed, because
   * JavaScript preserves insertion order for string keys and that body does
   * round-trip exactly. The difference is whitespace and escaping, not key
   * order — which is worth knowing, because "JSON.parse then stringify is
   * lossless" is exactly the assumption that makes re-serialising look safe.
   *
   * It is not: a signature checked against re-serialised JSON fails for honest
   * deliveries, and the tempting fix is to normalise both sides, which
   * verifies nothing at all.
   */
  it('rejects a body that was re-serialised rather than kept raw', () => {
    const raw = '{"a": 1, "b": "\u00e9"}';
    const reserialised = JSON.stringify(JSON.parse(raw));
    expect(reserialised).not.toBe(raw);
    expect(verifySignature(reserialised, sign(raw), SECRET)).toBe(false);
  });

  it('rejects a missing header rather than throwing', () => {
    expect(verifySignature('{}', null, SECRET)).toBe(false);
  });

  it('rejects when no secret is configured, never passing by default', () => {
    expect(verifySignature('{}', sign('{}'), '')).toBe(false);
  });

  /*
   * `timingSafeEqual` throws on a length mismatch instead of returning false,
   * so the length is checked first. A truncated header must be a rejection,
   * not a 500.
   */
  it('rejects a truncated signature without throwing', () => {
    expect(verifySignature('{}', 'sha256=abc', SECRET)).toBe(false);
  });
});

const event = (over: Record<string, unknown> = {}) => ({
  action: 'opened',
  installation: { id: 42 },
  repository: { name: 'shop', owner: { login: 'acme' } },
  pull_request: {
    number: 7,
    draft: false,
    head: { sha: 'abc123', ref: 'feature/checkout' },
    base: { sha: 'base999' },
    user: { type: 'User' },
  },
  ...over,
});

describe('decideWebhook', () => {
  it('acts on an opened pull request', () => {
    const decision = decideWebhook('pull_request', event());
    expect(decision).toEqual({
      act: true,
      owner: 'acme',
      repo: 'shop',
      installationId: 42,
      pullNumber: 7,
      headSha: 'abc123',
      headRef: 'feature/checkout',
      baseSha: 'base999',
    });
  });

  it.each(['synchronize', 'reopened'])('acts on %s', (action) => {
    expect(decideWebhook('pull_request', event({ action })).act).toBe(true);
  });

  it.each(['closed', 'labeled', 'assigned'])('ignores %s', (action) => {
    expect(decideWebhook('pull_request', event({ action })).act).toBe(false);
  });

  it('ignores an event that is not pull_request', () => {
    expect(decideWebhook('push', event()).act).toBe(false);
  });

  /*
   * Loop prevention. This product opens pull requests under this prefix;
   * analysing one is a machine reviewing its own output, and once a correction
   * step exists it could open a pull request in response to a pull request,
   * indefinitely.
   */
  it('refuses a branch this product opened itself', () => {
    const decision = decideWebhook(
      'pull_request',
      event({
        pull_request: {
          number: 7,
          draft: false,
          head: {
            sha: 'abc',
            ref: 'localize-infra/add-translations-1786961416681',
          },
          base: { sha: 'base999' },
          user: { type: 'User' },
        },
      }),
    );
    expect(decision.act).toBe(false);
    expect((decision as { reason: string }).reason).toContain('own branch');
  });

  /*
   * A second, independent guard. A bot opening a branch without our prefix is
   * still not a person asking for a review, and two unrelated signals are what
   * stop a rename of the prefix from silently removing the protection.
   */
  it('refuses a pull request opened by a bot, whatever the branch', () => {
    const decision = decideWebhook(
      'pull_request',
      event({
        pull_request: {
          number: 7,
          draft: false,
          head: { sha: 'abc', ref: 'dependabot/npm/lodash' },
          user: { type: 'Bot' },
        },
      }),
    );
    expect(decision.act).toBe(false);
  });

  it('refuses a draft', () => {
    const decision = decideWebhook(
      'pull_request',
      event({
        pull_request: {
          number: 7,
          draft: true,
          head: { sha: 'abc', ref: 'wip' },
          user: { type: 'User' },
        },
      }),
    );
    expect(decision.act).toBe(false);
  });

  it('refuses a payload missing the installation rather than guessing one', () => {
    expect(decideWebhook('pull_request', event({ installation: {} })).act).toBe(
      false,
    );
  });

  it('refuses a payload that is not an object', () => {
    expect(decideWebhook('pull_request', 'nope').act).toBe(false);
  });

  /*
   * The base commit is what "added keys" are measured against. Without it the
   * analysis could only see keys the code calls, which is the blindness pull
   * request #13 on the fixture exposed — one line added to a catalogue, no
   * source touched, and a check that said nothing was touched.
   */
  it('refuses a payload with no base commit rather than guessing one', () => {
    const decision = decideWebhook(
      'pull_request',
      event({
        pull_request: {
          number: 7,
          draft: false,
          head: { sha: 'abc123', ref: 'feature/x' },
          user: { type: 'User' },
        },
      }),
    );
    expect(decision.act).toBe(false);
  });
});

describe('analysableFiles', () => {
  it('keeps source files', () => {
    expect(
      analysableFiles(['src/a.tsx', 'src/b.ts', 'c.jsx', 'd.mjs']),
    ).toHaveLength(4);
  });

  /*
   * A catalogue is what the scan compares against. Reading it as source would
   * report its own keys as used and hide the ones genuinely missing.
   */
  it('drops catalogues and other non-source files', () => {
    expect(
      analysableFiles([
        'locales/en.json',
        'public/locales/fr/translation.json',
        'README.md',
        'package.json',
      ]),
    ).toEqual([]);
  });

  it('drops build output', () => {
    expect(
      analysableFiles(['dist/a.js', 'node_modules/x/b.ts', '.next/c.js']),
    ).toEqual([]);
  });
});
