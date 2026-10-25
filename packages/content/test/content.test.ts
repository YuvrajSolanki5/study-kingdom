import { describe, expect, it } from 'vitest';
import { ALL_BUILDING_IDS, CURRENT_CONTENT_VERSION, getContent, validateContent } from '../src/index.ts';

describe('content', () => {
  it('current version is internally consistent', () => {
    expect(validateContent(getContent(CURRENT_CONTENT_VERSION))).toEqual([]);
  });

  it('only uses registered stable building ids', () => {
    const content = getContent();
    for (const id of Object.keys(content.structures)) expect(ALL_BUILDING_IDS).toContain(id);
  });

  it('rejects unknown versions', () => {
    expect(() => getContent('does-not-exist')).toThrow();
  });
});

it('ships twenty ordered campaign bases and ten tactical tiers', () => {
  const c = getContent();
  expect(c.campaign).toHaveLength(20);
  expect(c.campaign.map((b) => b.order)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  expect(c.hqTiers).toHaveLength(10);
  for (const t of c.hqTiers) expect(t.highlights.length).toBeGreaterThanOrEqual(2);
});
