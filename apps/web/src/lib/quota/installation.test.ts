import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOT_CONFIGURED,
  NOT_CONNECTED,
  UNAVAILABLE,
  resolveInstallationWorkspace,
} from './installation';

/**
 * The lookup that decides who pays for a GitHub delivery.
 *
 * Every test here is about a refusal, because the resolved case is one line
 * and the refusals are the ones that keep the operator's card out of a
 * stranger's pull request. All three failures must look identical to the
 * caller — no organization — and must each say something different to a
 * reader.
 */

const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // biome-ignore lint/performance/noDelete: the code reads absence, not ''
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  vi.restoreAllMocks();
});

describe('resolveInstallationWorkspace', () => {
  it('resolves the installation to the workspace that owns it', async () => {
    const read = vi.fn(async () => ({
      data: { organization_id: '83d5e513-b356-49d7-9071-c7995e128d1e' },
      error: null,
    }));

    const result = await resolveInstallationWorkspace(166148995, read);

    expect(result).toEqual({
      organizationId: '83d5e513-b356-49d7-9071-c7995e128d1e',
      reason: null,
    });
    // The delivery's own installation id, not a fallback or a default. There
    // is no `GITHUB_APP_INSTALLATION_ID` left to fall back to.
    expect(read).toHaveBeenCalledWith(166148995);
  });

  it('refuses an installation no workspace has connected', async () => {
    const result = await resolveInstallationWorkspace(999, async () => ({
      data: null,
      error: null,
    }));

    expect(result.organizationId).toBeNull();
    expect(result.reason).toBe(NOT_CONNECTED);
  });

  /*
   * A row with no organization is the same answer as no row. It cannot happen
   * — the column is the primary key — but "cannot happen" is how a null
   * reaches `chargeWorkspace` and charges a workspace called `undefined`.
   */
  it('refuses a row that carries no organization', async () => {
    const result = await resolveInstallationWorkspace(1, async () => ({
      data: { organization_id: null },
      error: null,
    }));
    expect(result.organizationId).toBeNull();
    expect(result.reason).toBe(NOT_CONNECTED);
  });

  it('refuses when the read fails rather than assuming there is budget', async () => {
    const result = await resolveInstallationWorkspace(1, async () => ({
      data: null,
      error: { message: 'relation does not exist' },
    }));

    expect(result.organizationId).toBeNull();
    expect(result.reason).toBe(UNAVAILABLE);
  });

  it('refuses when the reader throws', async () => {
    const result = await resolveInstallationWorkspace(1, async () => {
      throw new Error('socket hang up');
    });
    expect(result.organizationId).toBeNull();
    expect(result.reason).toBe(UNAVAILABLE);
  });

  /*
   * The deployment-misconfiguration branch, and the only one that cannot take
   * an injected reader — it refuses before building one. This repository has
   * already lost an afternoon to `vercel env add` recording empty values that
   * `vercel env ls` lists as present, so the sentence names the variable.
   */
  it('refuses, by name, when the service-role key is missing', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    const result = await resolveInstallationWorkspace(166148995);
    expect(result.organizationId).toBeNull();
    expect(result.reason).toBe(NOT_CONFIGURED);
    expect(NOT_CONFIGURED).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('gives the three refusals three different sentences', () => {
    expect(new Set([NOT_CONNECTED, NOT_CONFIGURED, UNAVAILABLE]).size).toBe(3);
  });
});
