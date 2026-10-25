import { getContent } from '@sk/content';
import { describe, expect, it } from 'vitest';
import {
  accrue,
  computeStudyReward,
  localDate,
  newClock,
  reviewableSeconds,
  transition,
} from '../src/index.ts';

const content = getContent();
const cfg = content.economy.study;
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const S = 1000;

describe('session accounting', () => {
  it('credits continuous heartbeats as eligible time', () => {
    let c = transition(cfg, newClock('paper', T0), 'running', T0);
    for (let i = 1; i <= 50; i++) c = accrue(cfg, c, T0 + i * 30 * S);
    expect(c.eligibleMs).toBe(25 * 60 * S);
    expect(c.unreviewedMs).toBe(0);
  });

  it('holds a long gap (sleep, crash) for review instead of crediting it', () => {
    let c = transition(cfg, newClock('computer', T0), 'running', T0);
    c = accrue(cfg, c, T0 + 30 * S);
    c = accrue(cfg, c, T0 + 30 * S + 20 * 60 * S); // 20 minutes of silence
    c = accrue(cfg, c, T0 + 60 * S + 20 * 60 * S);
    expect(c.eligibleMs).toBe(60 * S);
    expect(c.unreviewedMs).toBe(20 * 60 * S);
    expect(c.gaps).toBe(1);
    expect(reviewableSeconds(cfg, c)).toBe(20 * 60);
  });

  it('is immune to repeated or replayed heartbeats', () => {
    let c = transition(cfg, newClock('paper', T0), 'running', T0);
    c = accrue(cfg, c, T0 + 30 * S);
    const again = accrue(cfg, c, T0 + 30 * S);
    const earlier = accrue(cfg, again, T0 + 10 * S); // server clock never goes back, but guard anyway
    expect(earlier.eligibleMs).toBe(30 * S);
    expect(earlier.lastAt).toBe(T0 + 30 * S);
  });

  it('subtracts reported distraction in computer mode only', () => {
    let c = transition(cfg, newClock('computer', T0), 'running', T0);
    c = accrue(cfg, c, T0 + 30 * S, { distractedMs: 10 * S });
    expect(c.eligibleMs).toBe(20 * S);
    expect(c.distractedMs).toBe(10 * S);
    // Reports cannot exceed elapsed time.
    c = accrue(cfg, c, T0 + 60 * S, { distractedMs: 999 * S });
    expect(c.distractedMs).toBe(40 * S);
    let p = transition(cfg, newClock('paper', T0), 'running', T0);
    p = accrue(cfg, p, T0 + 30 * S, { distractedMs: 30 * S, unconfirmedMs: 30 * S });
    expect(p.eligibleMs).toBe(30 * S);
  });

  it('counts paused time separately and enforces transitions', () => {
    let c = transition(cfg, newClock('paper', T0), 'running', T0);
    c = transition(cfg, c, 'paused', T0 + 60 * S);
    c = transition(cfg, c, 'running', T0 + 360 * S);
    c = transition(cfg, c, 'completed', T0 + 420 * S);
    expect(c.eligibleMs).toBe(120 * S);
    expect(c.pausedMs).toBe(300 * S);
    expect(() => transition(cfg, c, 'running', T0 + 500 * S)).toThrow();
  });

  it('caps credit at the maximum session length', () => {
    let c = transition(cfg, newClock('paper', T0), 'running', T0);
    for (let i = 1; i <= 600; i++) c = accrue(cfg, c, T0 + i * 30 * S);
    expect(c.eligibleMs).toBe(cfg.maxSessionMinutes * 60 * S);
    expect(c.overtimeMs).toBe(300 * 60 * S - cfg.maxSessionMinutes * 60 * S);
  });
});

describe('study rewards', () => {
  const base = {
    hq: 1,
    dailySecondsBefore: 0,
    competitiveSecondsBefore: 0,
    reviewedSeconds: 0,
    plannedMinutes: 25,
    completed: true,
    recallDone: false,
  };

  it('a first 25-minute session funds a visible upgrade', () => {
    const r = computeStudyReward(content, { ...base, eligibleSeconds: 25 * 60 });
    expect(r.gold).toBe(1100);
    expect(r.essence).toBe(550);
    expect(r.bonusPercent).toBe(10);
  });

  it('keeps proportional credit for interrupted sessions without the completion bonus', () => {
    const r = computeStudyReward(content, { ...base, eligibleSeconds: 12 * 60, completed: false });
    expect(r.gold).toBe(480);
    expect(r.bonusPercent).toBe(0);
  });

  it('pays nothing below the minimum and caps competitive minutes per day', () => {
    expect(computeStudyReward(content, { ...base, eligibleSeconds: 30 }).gold).toBe(0);
    const r = computeStudyReward(content, {
      ...base,
      eligibleSeconds: 60 * 60,
      competitiveSecondsBefore: 100 * 60,
    });
    expect(r.competitiveSeconds).toBe(20 * 60);
  });

  it('reduces the rate beyond the daily full-rate allowance', () => {
    const r = computeStudyReward(content, {
      ...base,
      eligibleSeconds: 60 * 60,
      dailySecondsBefore: 150 * 60,
      completed: false,
    });
    expect(r.fullRateSeconds).toBe(30 * 60);
    expect(r.reducedRateSeconds).toBe(30 * 60);
    expect(r.gold).toBe(30 * 40 + Math.floor(30 * 40 * 0.25));
  });

  it('reviewed time earns resources but not competitive credit', () => {
    const r = computeStudyReward(content, {
      ...base,
      eligibleSeconds: 0,
      reviewedSeconds: 20 * 60,
      completed: false,
    });
    expect(r.gold).toBe(800);
    expect(r.competitiveSeconds).toBe(0);
  });

  it('computes local dates in the player time zone', () => {
    const t = Date.UTC(2026, 9, 1, 15, 0, 0); // 02:00 next day in Sydney
    expect(localDate(t, 'Australia/Sydney')).toBe('2026-10-02');
    expect(localDate(t, 'UTC')).toBe('2026-10-01');
    expect(localDate(t, 'Not/AZone')).toBe('2026-10-01');
  });
});
