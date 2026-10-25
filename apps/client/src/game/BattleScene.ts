import type { GameContent } from '@sk/content';
import { getContent } from '@sk/content';
import {
  battleResult,
  canDeploy,
  createRuntime,
  destructionPercent,
  MT,
  starsOf,
  stepTick,
  TPS,
  type BattleSetup,
  type Command,
  type Runtime,
  type SimEvent,
} from '@sk/sim';
import Phaser from 'phaser';
import { battleBridge, useBattleHud } from '../state/battleHud.ts';
import { sfx } from './audio.ts';
import { attachControls, frameMap } from './camera.ts';
import { depthOf, isoX, isoY, TH, toTile, TW } from './iso.ts';
import { exposeScene } from './testHooks.ts';
import {
  buildingTexture,
  effectTextures,
  facesLeft,
  fitSprite,
  groundTexture,
  padTexture,
  isFanArt,
  preloadBuildings,
  preloadScenery,
  preloadUnits,
  rubbleTexture,
  unitTexture,
} from './textures.ts';

export interface BattleSceneData {
  setup: BattleSetup;
  commands: Command[];
  replay: boolean;
  onEnd(result: ReturnType<typeof battleResult>): void;
}

const TICK_MS = 1000 / TPS;
const FLY_HEIGHT = 34;
const SPELL_COLORS: Record<string, number> = {
  thunder: 0xfff59d,
  mending: 0x86efac,
  fury: 0xf472b6,
  frost: 0x7dd3fc,
  leap: 0xfde68a,
  aegis: 0xc4b5fd,
};

export class BattleScene extends Phaser.Scene {
  private rt!: Runtime;
  private content!: GameContent;
  private cfg!: BattleSceneData;
  private commands: Command[] = [];
  private bSprites: Phaser.GameObjects.Image[] = [];
  private uSprites = new Map<number, Phaser.GameObjects.Image>();
  private shadows = new Map<number, Phaser.GameObjects.Ellipse>();
  private prev = new Map<number, [number, number]>();
  private bars!: Phaser.GameObjects.Graphics;
  private zone!: Phaser.GameObjects.Graphics;
  private acc = 0;
  private started = false;
  private finished = false;
  private lastHoldDeploy = 0;
  private hudAt = 0;
  /** Set once a surrender is issued: nothing may follow an `end` command. */
  private ending = false;

  constructor() {
    super('battle');
  }

  init(data: BattleSceneData) {
    this.cfg = data;
    this.content = getContent(data.setup.contentVersion);
    this.rt = createRuntime(data.setup);
    this.commands = data.replay ? [...data.commands] : [];
    battleBridge.commands = this.commands;
    this.bSprites = [];
    this.uSprites = new Map();
    this.shadows = new Map();
    this.prev = new Map();
    this.acc = 0;
    this.started = data.replay;
    this.finished = false;
    this.ending = false;
  }

  preload() {
    preloadBuildings(this, this.rt.infos);
    preloadUnits(this);
    preloadScenery(this);
  }

  create() {
    effectTextures(this);
    const { size, buildMin, buildMax } = this.content.map;
    this.add
      .image(-(size * TW) / 2, 0, groundTexture(this, size, buildMin, buildMax))
      .setOrigin(0, 0)
      .setDepth(-10);
    this.zone = this.add.graphics().setDepth(-5).setAlpha(0);
    this.drawNoDeployZone();
    for (const info of this.rt.infos) {
      if (info.size > 1)
        fitSprite(
          this.add.image(
            isoX(info.x + info.size, info.y + info.size),
            isoY(info.x + info.size, info.y + info.size),
            padTexture(this, info.size),
          ),
        ).setDepth(-6);
      const key = buildingTexture(this, this.content, info.defId, info.level);
      const img = this.add.image(
        isoX(info.x + info.size, info.y + info.size),
        isoY(info.x + info.size, info.y + info.size),
        key,
      );
      fitSprite(img).setDepth(depthOf(info.x, info.y, 2 * info.size));
      const st = this.rt.state.buildings[info.index]!;
      if (info.isTrap || !st.revealed) img.setVisible(false);
      if (info.off) img.setTint(0xb0b0b0);
      this.bSprites.push(img);
    }
    this.bars = this.add.graphics().setDepth(100000);
    frameMap(this, size * TW, size * TH, (size * TH) / 2, 0.72);
    this.publishHud(true);
    battleBridge.activateAbility = (id) => {
      const hero = this.rt.state.units.find((u) => !u.dead && u.key.startsWith(`${id}:`));
      const pending = this.commands
        .slice(this.rt.state.cmdIndex)
        .some((c) => c.k === 'ability' && c.id === id);
      if (hero && hero.ability === 0 && !pending) this.issue({ t: 0, k: 'ability', id });
    };
    battleBridge.surrender = () => {
      if (!this.started) {
        this.started = true;
      }
      this.issue({ t: 0, k: 'end' });
      this.ending = true;
    };
    battleBridge.restartReplay = () => this.scene.restart(this.cfg);
    if (!this.cfg.replay) {
      attachControls(
        this,
        {
          down: () => {
            const sel = useBattleHud.getState().selection;
            if (sel) this.zone.setAlpha(0.35);
            return false;
          },
          up: (p, tap) => {
            this.zone.setAlpha(0);
            if (tap) this.deployAt(p);
          },
          hold: (p, held) => {
            if (held < 350 || performance.now() - this.lastHoldDeploy < 140) return;
            const sel = useBattleHud.getState().selection;
            if (sel?.k !== 'troop') return;
            this.lastHoldDeploy = performance.now();
            this.deployAt(p);
          },
        },
        size * TW,
      );
    } else attachControls(this, {}, size * TW);
    exposeScene(this, 'battle');
  }

  private drawNoDeployZone() {
    const g = this.zone;
    const n = this.rt.n;
    g.fillStyle(0xdc2626, 1);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!this.rt.noDeploy[y * n + x]) continue;
        const cx = isoX(x + 0.5, y + 0.5);
        const cy = isoY(x + 0.5, y + 0.5);
        g.fillTriangle(cx - TW / 2, cy, cx, cy - TH / 2, cx + TW / 2, cy);
        g.fillTriangle(cx - TW / 2, cy, cx, cy + TH / 2, cx + TW / 2, cy);
      }
  }

  private issue(c: Command) {
    if (this.finished || this.ending || this.cfg.replay) return;
    if (!this.started) {
      this.started = true;
      sfx('start');
    }
    // A command applies at the next tick to be simulated.
    c.t = this.rt.state.tick;
    this.commands.push(c);
  }

  private deployAt(p: Phaser.Input.Pointer) {
    const sel = useBattleHud.getState().selection;
    if (!sel || this.finished) return;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const t = toTile(w.x, w.y);
    const x = Math.round(t.x * MT);
    const y = Math.round(t.y * MT);
    const rem = this.rt.state.remaining;
    const lim = this.rt.n * MT;
    if (x < 0 || y < 0 || x >= lim || y >= lim) return;
    // Count commands not yet simulated so rapid taps cannot exceed the army.
    const pending = (k: string, id?: string) =>
      this.commands
        .slice(this.rt.state.cmdIndex)
        .filter((c) => c.k === k && (!id || ('id' in c && c.id === id))).length;
    if (sel.k === 'spell') {
      if ((rem.spells[sel.id] ?? 0) - pending('spell', sel.id) <= 0) return;
      this.issue({ t: 0, k: 'spell', id: sel.id, x, y });
      return;
    }
    if (!canDeploy(this.rt, x, y)) {
      useBattleHud.getState().set({ invalidAt: performance.now() });
      this.zone.setAlpha(0.5);
      this.time.delayedCall(450, () => this.zone.setAlpha(0));
      sfx('error');
      return;
    }
    if (sel.k === 'troop') {
      if ((rem.troops[sel.id] ?? 0) - pending('troop', sel.id) <= 0) return;
      this.issue({ t: 0, k: 'troop', id: sel.id, x, y });
    } else if (sel.k === 'hero') {
      if ((rem.heroes[sel.id] ?? 0) - pending('hero', sel.id) <= 0) return;
      this.issue({ t: 0, k: 'hero', id: sel.id, x, y });
    } else if (sel.k === 'siege') {
      if ((rem.siege[sel.id] ?? 0) - pending('siege', sel.id) <= 0) return;
      this.issue({ t: 0, k: 'siege', id: sel.id, x, y });
    } else if (sel.k === 'reinforce') {
      if (!rem.reinforcements || pending('reinforce') > 0) return;
      this.issue({ t: 0, k: 'reinforce', x, y });
    }
    sfx('deploy');
  }

  override update(_time: number, delta: number) {
    const hud = useBattleHud.getState();
    if (this.started && !this.finished && !hud.paused) {
      this.acc += Math.min(delta, 250) * hud.speed;
      while (this.acc >= TICK_MS && !this.rt.state.ended) {
        for (const u of this.rt.state.units) if (!u.dead) this.prev.set(u.id, [u.x, u.y]);
        stepTick(this.rt, this.commands);
        this.handleEvents(this.rt.events);
        this.acc -= TICK_MS;
      }
      if (this.rt.state.ended) this.finish();
    }
    this.render(this.finished ? 1 : this.acc / TICK_MS);
    if (performance.now() - this.hudAt > 100) this.publishHud(false);
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    const result = battleResult(this.rt);
    sfx(result.stars > 0 ? 'victory' : 'defeat');
    this.publishHud(true);
    useBattleHud.getState().set({ ended: true, result });
    this.cfg.onEnd(result);
  }

  private publishHud(force: boolean) {
    this.hudAt = performance.now();
    const st = this.rt.state;
    const hud = useBattleHud.getState();
    const percent = destructionPercent(this.rt);
    const stars = starsOf(this.rt);
    if (!force && hud.tick === st.tick && hud.percent === percent) return;
    const heroAbility: Record<string, 'ready' | 'used' | 'none'> = {};
    for (const h of this.rt.setup.attacker.heroes) {
      const u = st.units.find((x) => x.key.startsWith(`${h.id}:`));
      heroAbility[h.id] = !u || u.dead ? 'none' : u.ability === 0 ? 'ready' : 'used';
    }
    const pendingCounts: Record<string, number> = {};
    for (const c of this.commands.slice(st.cmdIndex))
      if ('id' in c) pendingCounts[`${c.k}:${c.id}`] = (pendingCounts[`${c.k}:${c.id}`] ?? 0) + 1;
    const minus = (rec: Record<string, number>, k: string) =>
      Object.fromEntries(
        Object.entries(rec).map(([id, n]) => [id, Math.max(0, n - (pendingCounts[`${k}:${id}`] ?? 0))]),
      );
    hud.set({
      started: this.started,
      tick: st.tick,
      durationTicks: this.rt.durationTicks,
      percent,
      stars,
      remaining: {
        troops: minus(st.remaining.troops, 'troop'),
        spells: minus(st.remaining.spells, 'spell'),
        heroes: minus(st.remaining.heroes, 'hero'),
        siege: minus(st.remaining.siege, 'siege'),
        reinforcements: st.remaining.reinforcements,
      },
      heroAbility,
    });
  }

  private screenOf(x: number, y: number) {
    const tx = x / MT;
    const ty = y / MT;
    return { sx: isoX(tx, ty), sy: isoY(tx, ty), d: (tx + ty) * 10 + 5 };
  }

  private handleEvents(events: SimEvent[]) {
    const st = this.rt.state;
    for (const ev of events) {
      switch (ev.e) {
        case 'spawn': {
          const u = st.units[ev.u]!;
          const stats = this.rt.stats.get(u.key)!;
          const img = fitSprite(
            this.add.image(0, 0, unitTexture(this, stats.defId, u.team)),
            stats.kind === 'hero' ? 1.35 : 1,
            0.86,
          );
          // Defending clan troops: procedural art wears red; fan art is tinted.
          if (u.team === 1 && isFanArt(img)) img.setTint(0xff9b9b);
          this.uSprites.set(u.id, img);
          if (stats.flying) this.shadows.set(u.id, this.add.ellipse(0, 0, 18, 8, 0x000000, 0.25));
          this.prev.set(u.id, [u.x, u.y]);
          break;
        }
        case 'shot': {
          const info = this.rt.infos[ev.b]!;
          const u = st.units[ev.u]!;
          const from = this.bSprites[ev.b]!;
          const to = this.screenOf(u.x, u.y);
          const fromY = from.y - from.displayHeight * from.originY * 0.7;
          const tex =
            info.defense && info.defense.splash > 0
              ? 'fx:dot'
              : info.defId === 'watchtower'
                ? 'fx:arrow'
                : 'fx:bolt';
          const proj = this.add.image(from.x, fromY, tex).setDepth(99990);
          proj.setRotation(Math.atan2(to.sy - fromY, to.sx - from.x));
          if (tex === 'fx:dot') proj.setTint(0x333333).setScale(0.6);
          const speed = useBattleHud.getState().speed;
          this.tweens.add({
            targets: proj,
            x: to.sx,
            y: to.sy - (this.rt.stats.get(u.key)?.flying ? FLY_HEIGHT : 10),
            duration: Math.max(60, (ev.travel * TICK_MS) / speed),
            onComplete: () => proj.destroy(),
          });
          sfx('shot');
          break;
        }
        case 'swing': {
          const u = st.units[ev.u]!;
          const stats = this.rt.stats.get(u.key)!;
          const from = this.screenOf(u.x, u.y);
          const to = this.screenOf(ev.x, ev.y);
          if (stats.range > MT) {
            const arrow = this.add.image(from.sx, from.sy - 14, 'fx:arrow').setDepth(99990);
            arrow.setRotation(Math.atan2(to.sy - from.sy, to.sx - from.sx));
            this.tweens.add({
              targets: arrow,
              x: to.sx,
              y: to.sy - 8,
              duration: 120,
              onComplete: () => arrow.destroy(),
            });
          } else {
            const spark = this.add
              .image(to.sx, to.sy - 8, 'fx:dot')
              .setScale(0.35)
              .setTint(0xfff1a8)
              .setDepth(99990);
            this.tweens.add({
              targets: spark,
              alpha: 0,
              scale: 0.6,
              duration: 160,
              onComplete: () => spark.destroy(),
            });
          }
          sfx('hit');
          break;
        }
        case 'impact': {
          if (ev.splash <= 0) break;
          const p = this.screenOf(ev.x, ev.y);
          const r = (ev.splash / MT) * TW;
          const ring = this.add
            .image(p.sx, p.sy, 'fx:ring')
            .setDepth(99991)
            .setTint(ev.src === 's' ? 0xfff59d : 0xff8a3d);
          ring.setDisplaySize(r * 0.4, r * 0.2);
          this.tweens.add({
            targets: ring,
            displayWidth: r * 2,
            displayHeight: r,
            alpha: 0,
            duration: 380,
            onComplete: () => ring.destroy(),
          });
          break;
        }
        case 'strike': {
          const p = this.screenOf(ev.x, ev.y);
          const bolt = this.add
            .image(p.sx, p.sy - 40, 'fx:lightning')
            .setDepth(99995)
            .setScale(1.6);
          this.cameras.main.shake(120, 0.004);
          this.tweens.add({ targets: bolt, alpha: 0, duration: 300, onComplete: () => bolt.destroy() });
          sfx('thunder');
          break;
        }
        case 'spell': {
          const p = this.screenOf(ev.x, ev.y);
          const def = this.content.spells[ev.id];
          const r = ((def?.radius ?? 2) * TW) | 0;
          const zone = this.add
            .ellipse(p.sx, p.sy, r * 2, r, SPELL_COLORS[ev.id] ?? 0xffffff, 0.22)
            .setDepth(-4);
          zone.setStrokeStyle(2, SPELL_COLORS[ev.id] ?? 0xffffff, 0.8);
          const dur = (def?.levels[0]?.durationSeconds ?? 1) * 1000;
          this.tweens.add({
            targets: zone,
            alpha: 0,
            delay: Math.max(0, dur - 300),
            duration: 300,
            onComplete: () => zone.destroy(),
          });
          break;
        }
        case 'bdie': {
          const info = this.rt.infos[ev.b]!;
          const img = this.bSprites[ev.b]!;
          if (info.isWall) img.setTexture(rubbleTexture(this, 1)).setAlpha(0.7);
          else {
            img.setTexture(rubbleTexture(this, info.size)).clearTint();
            const puff = this.add
              .image(img.x, img.y - 20, 'fx:ring')
              .setTint(0x9ca3af)
              .setDepth(99992);
            this.tweens.add({
              targets: puff,
              scale: 3,
              alpha: 0,
              duration: 500,
              onComplete: () => puff.destroy(),
            });
            sfx('boom');
          }
          fitSprite(img).setDepth(depthOf(info.x, info.y, 0));
          break;
        }
        case 'udie': {
          const img = this.uSprites.get(ev.u);
          if (img) {
            this.tweens.add({
              targets: img,
              alpha: 0,
              y: img.y - 10,
              duration: 300,
              onComplete: () => img.destroy(),
            });
            this.uSprites.delete(ev.u);
          }
          this.shadows.get(ev.u)?.destroy();
          this.shadows.delete(ev.u);
          break;
        }
        case 'trap': {
          const img = this.bSprites[ev.b]!;
          img.setVisible(true).setAlpha(0.8);
          this.tweens.add({ targets: img, alpha: 0, delay: 600, duration: 400 });
          break;
        }
        case 'reveal': {
          const img = this.bSprites[ev.b]!;
          const full = img.scaleX;
          img.setVisible(true).setScale(full * 0.2);
          this.tweens.add({ targets: img, scale: full, duration: 300, ease: 'Back.Out' });
          break;
        }
        case 'ability':
        case 'heal':
        case 'release': {
          const p =
            'u' in ev ? this.screenOf(st.units[ev.u]!.x, st.units[ev.u]!.y) : this.screenOf(ev.x, ev.y);
          const ring = this.add
            .image(p.sx, p.sy, 'fx:ring')
            .setTint(ev.e === 'heal' ? 0x86efac : 0xfde047)
            .setDepth(99991);
          this.tweens.add({
            targets: ring,
            scale: 2.4,
            alpha: 0,
            duration: 450,
            onComplete: () => ring.destroy(),
          });
          break;
        }
        case 'end':
          break;
      }
    }
  }

  private render(alpha: number) {
    const st = this.rt.state;
    const g = this.bars;
    g.clear();
    for (const u of st.units) {
      if (u.dead) continue;
      const img = this.uSprites.get(u.id);
      if (!img) continue;
      const [px, py] = this.prev.get(u.id) ?? [u.x, u.y];
      const x = px + (u.x - px) * alpha;
      const y = py + (u.y - py) * alpha;
      const s = this.screenOf(x, y);
      const flying = this.rt.stats.get(u.key)?.flying;
      img.setPosition(s.sx, s.sy - (flying ? FLY_HEIGHT : 0));
      img.setDepth(flying ? 90000 + s.d : s.d);
      if (u.x !== px) img.setFlipX(u.x < px !== facesLeft(img));
      const shadow = this.shadows.get(u.id);
      shadow?.setPosition(s.sx, s.sy).setDepth(s.d - 1);
      if (u.hp < u.maxHp) {
        const w = 18;
        const by = img.y - img.displayHeight * img.originY - 4;
        g.fillStyle(0x111827, 0.8);
        g.fillRect(s.sx - w / 2 - 1, by - 1, w + 2, 4);
        g.fillStyle(u.team === 0 ? 0x4ade80 : 0xf87171, 1);
        g.fillRect(s.sx - w / 2, by, (w * u.hp) / u.maxHp, 2);
      }
    }
    st.buildings.forEach((b, i) => {
      const info = this.rt.infos[i]!;
      if (b.dead || b.hp >= info.maxHp || info.isTrap) return;
      const img = this.bSprites[i]!;
      const w = Math.min(60, info.size * 16);
      const by = img.y - img.displayHeight * img.originY + 6;
      g.fillStyle(0x111827, 0.8);
      g.fillRect(img.x - w / 2 - 1, by - 1, w + 2, 5);
      g.fillStyle(info.isWall ? 0xd1d5db : 0xfbbf24, 1);
      g.fillRect(img.x - w / 2, by, (w * b.hp) / info.maxHp, 3);
    });
  }
}
