import { describe, expect, it } from 'vitest';
import {
  type HealthFilterInput,
  checkState,
  matchesHealthFilter,
} from './check-state';

/**
 * The state `/[org]/health` paints a check with.
 *
 * It read only `skipped` and `findingCount`, and since #157 that is not enough:
 * a check whose only problem is a catalogue that does not parse is not
 * skipped, lists no finding, and is `neutral` on GitHub. The dashboard painted
 * it green — "No problems", filed under Clean — while the commit's check said
 * "1 catalogue is not valid JSON". A surface that reads as approval where
 * GitHub says otherwise is the failure this product sells against.
 */

const row = (over: Partial<HealthFilterInput> = {}): HealthFilterInput => ({
  skipped: false,
  findingCount: 0,
  conclusion: 'success',
  correctable: 0,
  ...over,
});

/** The row `recordCheck` writes for a pull request that broke a catalogue. */
const brokenCatalogue = row({ conclusion: 'neutral' });

describe('checkState', () => {
  it('calls a clean, analysed check clean', () => {
    expect(checkState(row())).toEqual({
      tone: 'confident',
      label: 'No problems',
    });
  });

  it('never calls a neutral check clean, even with no finding listed', () => {
    const state = checkState(brokenCatalogue);
    expect(state.tone).not.toBe('confident');
    expect(state.label).not.toBe('No problems');
  });

  it('paints it as a present, degraded state rather than an absent one', () => {
    expect(checkState(brokenCatalogue).tone).toBe('degraded');
  });

  it('still counts findings when there are some', () => {
    expect(checkState(row({ conclusion: 'neutral', findingCount: 3 }))).toEqual(
      {
        tone: 'degraded',
        label: '3 problems',
      },
    );
  });

  it('still says a skipped check was not analysed, and takes no colour', () => {
    expect(checkState(row({ skipped: true, conclusion: 'neutral' }))).toEqual({
      tone: 'neutral',
      label: 'Not analysed',
    });
  });
});

describe('matchesHealthFilter', () => {
  it('does not file a neutral check under Clean', () => {
    expect(matchesHealthFilter(brokenCatalogue, 'clean')).toBe(false);
    expect(matchesHealthFilter(row(), 'clean')).toBe(true);
  });

  it('files it under Problems, where somebody will look', () => {
    expect(matchesHealthFilter(brokenCatalogue, 'problems')).toBe(true);
    expect(matchesHealthFilter(row(), 'problems')).toBe(false);
  });

  it('keeps the other filters as they were', () => {
    const skipped = row({ skipped: true, conclusion: 'neutral' });
    expect(matchesHealthFilter(skipped, 'skipped')).toBe(true);
    expect(matchesHealthFilter(skipped, 'clean')).toBe(false);
    expect(matchesHealthFilter(skipped, 'problems')).toBe(false);
    expect(matchesHealthFilter(row({ correctable: 2 }), 'fixable')).toBe(true);
    expect(matchesHealthFilter(row(), 'fixable')).toBe(false);
    expect(matchesHealthFilter(brokenCatalogue, 'all')).toBe(true);
  });
});
