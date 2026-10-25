import type { GameContent, PlacedBuilding, StructureDef } from './types.ts';

/**
 * Structural and cross-reference checks for a content version. Returns a list
 * of human-readable problems; an empty list means the content is consistent.
 */
export function validateContent(content: GameContent): string[] {
  const problems: string[] = [];
  const fail = (msg: string) => problems.push(msg);
  const { maxHq } = content;

  if (content.hqTiers.length !== maxHq)
    fail(`hqTiers has ${content.hqTiers.length} entries, expected ${maxHq}`);
  content.hqTiers.forEach((t, i) => {
    if (t.level !== i + 1) fail(`hqTiers[${i}] has level ${t.level}`);
  });

  const hq = content.structures['headquarters'];
  if (!hq) fail('missing headquarters');
  else if (hq.levels.length !== maxHq) fail(`headquarters has ${hq.levels.length} levels, expected ${maxHq}`);

  for (const [key, def] of Object.entries(content.structures)) {
    if (key !== def.id) fail(`structure key ${key} does not match id ${def.id}`);
    checkStructure(def, maxHq, fail);
  }

  if (hq) {
    hq.levels.forEach((l) => {
      if (l.level > 1 && l.hq !== l.level - 1)
        fail(`headquarters level ${l.level} must require HQ ${l.level - 1}`);
    });
  }

  const barracksMax = content.structures['barracks']?.levels.length ?? 0;
  const libraryMax = content.structures['research_library']?.levels.length ?? 0;
  const workshopMax = content.structures['workshop']?.levels.length ?? 0;

  for (const [key, t] of Object.entries(content.troops)) {
    if (key !== t.id) fail(`troop key ${key} does not match id ${t.id}`);
    if (t.barracksLevel > barracksMax) fail(`${t.id} needs barracks ${t.barracksLevel} > ${barracksMax}`);
    if (t.housing <= 0) fail(`${t.id} housing must be positive`);
    if (!t.hitsAir && !t.hitsGround && !t.healRadius) fail(`${t.id} cannot hit anything`);
    t.levels.forEach((l, i) => {
      if (l.level !== i + 1) fail(`${t.id} level index ${i} is level ${l.level}`);
      if (l.libraryLevel > libraryMax) fail(`${t.id} L${l.level} needs library ${l.libraryLevel}`);
      if (i > 0 && l.libraryLevel < (t.levels[i - 1]?.libraryLevel ?? 0))
        fail(`${t.id} library requirement decreases at L${l.level}`);
      if (l.hp <= 0) fail(`${t.id} L${l.level} hp must be positive`);
    });
    if (t.summon && !content.troops[t.summon.unit]) fail(`${t.id} summons unknown ${t.summon.unit}`);
  }

  for (const [key, s] of Object.entries(content.spells)) {
    if (key !== s.id) fail(`spell key ${key} does not match id ${s.id}`);
    if (s.libraryLevel > libraryMax) fail(`${s.id} needs library ${s.libraryLevel}`);
    s.levels.forEach((l, i) => {
      if (l.level !== i + 1) fail(`${s.id} level index ${i} is level ${l.level}`);
      if (l.libraryLevel > libraryMax) fail(`${s.id} L${l.level} needs library ${l.libraryLevel}`);
    });
  }

  for (const [key, h] of Object.entries(content.heroes)) {
    if (key !== h.id) fail(`hero key ${key} does not match id ${h.id}`);
    h.levels.forEach((l, i) => {
      if (l.level !== i + 1) fail(`${h.id} level index ${i} is level ${l.level}`);
      if (l.hq > maxHq) fail(`${h.id} L${l.level} needs HQ ${l.hq}`);
      if (i > 0 && l.hq < (h.levels[i - 1]?.hq ?? 0)) fail(`${h.id} HQ requirement decreases at L${l.level}`);
    });
  }

  for (const [key, s] of Object.entries(content.siege)) {
    if (key !== s.id) fail(`siege key ${key} does not match id ${s.id}`);
    s.levels.forEach((l, i) => {
      if (l.level !== i + 1) fail(`${s.id} level index ${i} is level ${l.level}`);
      if (l.workshopLevel > workshopMax) fail(`${s.id} L${l.level} needs workshop ${l.workshopLevel}`);
    });
  }

  checkStorageCoversCosts(content, fail);

  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const base of content.campaign) {
    if (ids.has(base.id)) fail(`duplicate campaign id ${base.id}`);
    if (orders.has(base.order)) fail(`duplicate campaign order ${base.order}`);
    ids.add(base.id);
    orders.add(base.order);
    checkLayout(content, base.buildings, `campaign ${base.id}`, fail);
    if (!base.buildings.some((b) => b.defId === 'headquarters'))
      fail(`campaign ${base.id} has no headquarters`);
    for (const r of base.reinforcements) {
      if (!content.troops[r.unitId]) fail(`campaign ${base.id} reinforcement ${r.unitId} unknown`);
    }
  }
  return problems;
}

function checkStructure(def: StructureDef, maxHq: number, fail: (m: string) => void) {
  if (def.size < 1) fail(`${def.id} size must be >= 1`);
  if (def.maxCount.length !== maxHq)
    fail(`${def.id} maxCount has ${def.maxCount.length} entries, expected ${maxHq}`);
  for (let i = 1; i < def.maxCount.length; i++) {
    if ((def.maxCount[i] ?? 0) < (def.maxCount[i - 1] ?? 0))
      fail(`${def.id} maxCount decreases at HQ${i + 1}`);
  }
  def.levels.forEach((l, i) => {
    if (l.level !== i + 1) fail(`${def.id} level index ${i} is level ${l.level}`);
    if (l.hq < 1 || l.hq > maxHq) fail(`${def.id} L${l.level} requires HQ ${l.hq}`);
    if (i > 0 && l.hq < (def.levels[i - 1]?.hq ?? 0))
      fail(`${def.id} HQ requirement decreases at L${l.level}`);
    if (l.hp <= 0) fail(`${def.id} L${l.level} hp must be positive`);
    if (def.category === 'defense' && !l.defense) fail(`${def.id} L${l.level} missing defense stats`);
    if (def.category === 'trap' && !l.trap) fail(`${def.id} L${l.level} missing trap stats`);
    if (def.id === 'army_camp' && !l.housing) fail(`army_camp L${l.level} missing housing`);
    if (def.id === 'clan_hall' && !l.reinforcement) fail(`clan_hall L${l.level} missing reinforcement`);
    if (l.defense) {
      if (l.defense.attackSeconds < 0.1) fail(`${def.id} L${l.level} attacks faster than one tick`);
      if (l.defense.ramp && l.defense.ramp.stageSeconds.length !== l.defense.ramp.multipliers.length)
        fail(`${def.id} L${l.level} ramp stage mismatch`);
    }
  });
  const firstLevel = def.levels[0];
  if (firstLevel) {
    const firstHq = firstLevel.hq;
    if ((def.maxCount[firstHq - 1] ?? 0) === 0)
      fail(`${def.id} level 1 needs HQ ${firstHq} but maxCount is 0 there`);
  }
  const [s0, s1, s2] = def.visualStages;
  if (!(s0 === 1 && s0 <= s1 && s1 <= s2 && s2 <= Math.max(def.levels.length, 1)))
    fail(`${def.id} visual stages ${def.visualStages.join(',')} invalid`);
}

/** Every upgrade available at a tier must fit within that tier's maximum storage. */
function checkStorageCoversCosts(content: GameContent, fail: (m: string) => void) {
  for (let hq = 1; hq <= content.maxHq; hq++) {
    let gold = 0;
    let essence = 0;
    for (const def of Object.values(content.structures)) {
      const count = def.maxCount[hq - 1] ?? 0;
      let best: { gold: number; essence: number } | undefined;
      for (const l of def.levels) if (l.hq <= hq && l.storage) best = l.storage;
      if (best) {
        const n = def.id === 'headquarters' ? 1 : count;
        gold += best.gold * n;
        essence += best.essence * n;
      }
    }
    const costs: { what: string; gold: number; essence: number }[] = [];
    for (const def of Object.values(content.structures)) {
      for (const l of def.levels) {
        if (l.hq === hq)
          costs.push({ what: `${def.id} L${l.level}`, gold: l.cost.gold ?? 0, essence: l.cost.essence ?? 0 });
      }
    }
    const libraryLevels = (content.structures['research_library']?.levels ?? []).filter(
      (l) => l.hq <= hq,
    ).length;
    for (const t of Object.values(content.troops)) {
      for (const l of t.levels)
        if (l.libraryLevel > 0 && l.libraryLevel <= libraryLevels)
          costs.push({
            what: `${t.id} L${l.level}`,
            gold: l.researchCost.gold ?? 0,
            essence: l.researchCost.essence ?? 0,
          });
    }
    for (const s of Object.values(content.spells)) {
      for (const l of s.levels)
        if (l.libraryLevel <= libraryLevels)
          costs.push({
            what: `${s.id} L${l.level}`,
            gold: l.researchCost.gold ?? 0,
            essence: l.researchCost.essence ?? 0,
          });
    }
    for (const h of Object.values(content.heroes)) {
      for (const l of h.levels)
        if (l.hq === hq)
          costs.push({ what: `${h.id} L${l.level}`, gold: l.cost.gold ?? 0, essence: l.cost.essence ?? 0 });
    }
    for (const c of costs) {
      if (c.gold > gold) fail(`HQ${hq}: ${c.what} costs ${c.gold} gold but storage is ${gold}`);
      if (c.essence > essence)
        fail(`HQ${hq}: ${c.what} costs ${c.essence} essence but storage is ${essence}`);
    }
  }
}

export function checkLayout(
  content: GameContent,
  buildings: PlacedBuilding[],
  label: string,
  fail: (m: string) => void,
) {
  const { buildMin, buildMax } = content.map;
  const occupied = new Map<number, number>();
  buildings.forEach((b, idx) => {
    const def = content.structures[b.defId];
    if (!def) {
      fail(`${label}: unknown building ${b.defId}`);
      return;
    }
    if (!def.levels[b.level - 1]) fail(`${label}: ${b.defId} has no level ${b.level}`);
    if (b.x < buildMin || b.y < buildMin || b.x + def.size > buildMax || b.y + def.size > buildMax)
      fail(`${label}: ${b.defId} at ${b.x},${b.y} is outside the build area`);
    for (let dx = 0; dx < def.size; dx++) {
      for (let dy = 0; dy < def.size; dy++) {
        const key = (b.y + dy) * content.map.size + (b.x + dx);
        const other = occupied.get(key);
        if (other !== undefined)
          fail(`${label}: ${b.defId}#${idx} overlaps #${other} at ${b.x + dx},${b.y + dy}`);
        occupied.set(key, idx);
      }
    }
  });
}
