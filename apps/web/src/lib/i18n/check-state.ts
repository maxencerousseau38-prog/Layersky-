import type { Tone } from '@localize-infra/ui';

export interface CheckStateInput {
  skipped: boolean;
  findingCount: number;
  conclusion: 'success' | 'neutral' | 'failure' | 'skipped';
}

export interface HealthFilterInput extends CheckStateInput {
  correctable: number;
}

export type HealthFilter = 'all' | 'problems' | 'fixable' | 'clean' | 'skipped';

/**
 * The tone of a check, which is not the tone of its GitHub conclusion.
 *
 * GitHub has one `neutral` for both "found problems" and "could not look", and
 * DESIGN.md §6.3 separates them. A check that found something has a real,
 * present, degraded state. A check that read nothing has no state to report and
 * takes no colour — painting it amber would assert behaviour about a repository
 * nothing was read from, which is the exact failure the product sells against.
 *
 * **Clean means the recorded conclusion is `success`, not "no finding listed".**
 * The two used to coincide. Since #157 they do not: a pull request whose only
 * problem is a catalogue that does not parse is analysed, lists no finding and
 * is `neutral` on GitHub — and reading the count alone painted it green here
 * while the commit's check named the broken file. The detail page carries the
 * check's own summary, which says which file; this label only refuses to call
 * it clean.
 */
export function checkState(row: CheckStateInput): {
  tone: Tone;
  label: string;
} {
  if (row.skipped) return { tone: 'neutral', label: 'Not analysed' };
  if (row.findingCount === 0) {
    return row.conclusion === 'success'
      ? { tone: 'confident', label: 'No problems' }
      : { tone: 'degraded', label: 'Needs attention' };
  }
  return {
    tone: 'degraded',
    label: `${row.findingCount} problem${row.findingCount === 1 ? '' : 's'}`,
  };
}

/**
 * Whether a row belongs under one of the table's filters.
 *
 * "Problems" and "Clean" are read from `checkState` rather than from the count
 * again, so the filter cannot disagree with the dot printed on the same row.
 */
export function matchesHealthFilter(
  row: HealthFilterInput,
  filter: HealthFilter,
): boolean {
  if (filter === 'problems') return checkState(row).tone === 'degraded';
  if (filter === 'fixable') return row.correctable > 0;
  if (filter === 'clean') return checkState(row).tone === 'confident';
  if (filter === 'skipped') return row.skipped;
  return true;
}
