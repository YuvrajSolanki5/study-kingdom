import type { GameContent } from '@sk/content';
import { areaFree, buildingUpgrading, occupancy, type PlayerState, type VillageBuilding } from '@sk/rules';
import Phaser from 'phaser';
import { contentOf, serverNow, useGame } from '../state/store.ts';
import { sfx } from './audio.ts';
import { attachControls, frameMap } from './camera.ts';
import { depthOf, isoX, isoY, TH, toTile, TW } from './iso.ts';
import { exposeScene } from './testHooks.ts';
import {
  buildingTexture,
  fitSprite,
  groundTexture,
  padTexture,
  preloadBuildings,
  preloadScenery,
  SPRITES_READY,
} from './textures.ts';

interface Drag {
  id: number;
  defId: string;
  offX: number;
  offY: number;
  x: number;
  y: number;
  valid: boolean;
}

export class VillageScene extends Phaser.Scene {
  private content!: GameContent;
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private pads = new Map<number, Phaser.GameObjects.Image>();
  private overlay!: Phaser.GameObjects.Graphics;
  private ghost: Phaser.GameObjects.Image | null = null;
  private ghostPos: { x: number; y: number; valid: boolean } | null = null;
  private drag: Drag | null = null;
  private unsub: (() => void) | null = null;
  private lastState: PlayerState | null = null;
  private lastSelected: number | null = null;
  private wallStroke: { x: number; y: number }[] = [];

  constructor() {
    super('village');
  }

  preload() {
    const state = this.state();
    if (state) preloadBuildings(this, state.buildings);
    preloadScenery(this);
  }

  create() {
    // The scene object is reused when returning from a battle, but stopping it
    // destroyed every image; forget them so sync() draws the village again.
    this.sprites.clear();
    this.pads.clear();
    this.ghost = null;
    this.ghostPos = null;
    this.drag = null;
    this.lastState = null;
    this.lastSelected = null;
    this.wallStroke = [];
    const view = useGame.getState().view;
    this.content = contentOf(view);
    const { size, buildMin, buildMax } = this.content.map;
    const key = groundTexture(this, size, buildMin, buildMax);
    this.add
      .image(-(size * TW) / 2, 0, key)
      .setOrigin(0, 0)
      .setDepth(-10);
    this.overlay = this.add.graphics().setDepth(100000);
    // Open on the whole build area so the village has room around it.
    frameMap(this, size * TW, size * TH, (size * TH) / 2, 0.8);
    this.sync();
    this.unsub = useGame.subscribe((s, prev) => {
      if (
        s.visit !== prev.visit ||
        s.view?.state !== prev.view?.state ||
        s.editMode !== prev.editMode ||
        s.selected !== prev.selected
      )
        this.sync();
      if (s.placing !== prev.placing) this.setGhost(s.placing);
    });
    const redraw = () => this.sync();
    const resize = () => this.cameras.main.setSize(this.scale.width, this.scale.height);
    const stop = () => {
      this.unsub?.();
      this.unsub = null;
      this.events.off(SPRITES_READY, redraw);
      // The scale manager outlives the scene; a stale listener would throw in the game loop.
      this.scale.off('resize', resize);
    };
    this.events.once('shutdown', stop);
    this.events.once('destroy', stop);
    attachControls(
      this,
      {
        down: (p) => this.onDown(p),
        move: (p) => this.onMove(p),
        up: (p, tap) => this.onUp(p, tap),
      },
      size * TW,
    );
    // Upgrades and visits can need sprites that load after create().
    this.events.on(SPRITES_READY, redraw);
    this.scale.on('resize', resize);
    exposeScene(this, 'village');
  }

  private state(): PlayerState | null {
    const { view, visit } = useGame.getState();
    if (view && visit)
      return {
        ...view.state,
        buildings: visit.snapshot.buildings as VillageBuilding[],
        builders: [],
        research: null,
      };
    return view?.state ?? null;
  }

  private placeSprite(img: Phaser.GameObjects.Image, b: { defId: string; x: number; y: number }) {
    const s = this.content.structures[b.defId]?.size ?? 1;
    img.setPosition(isoX(b.x + s, b.y + s), isoY(b.x + s, b.y + s));
    fitSprite(img);
    img.setDepth(depthOf(b.x, b.y, 2 * s));
  }

  /** Worn ground under buildings larger than one tile (not walls or traps). */
  private placePad(id: number, b: { defId: string; x: number; y: number }) {
    const s = this.content.structures[b.defId]?.size ?? 1;
    if (s < 2) return;
    let pad = this.pads.get(id);
    if (!pad) {
      pad = this.add.image(0, 0, padTexture(this, s)).setDepth(-5);
      this.pads.set(id, pad);
    }
    pad.setPosition(isoX(b.x + s, b.y + s), isoY(b.x + s, b.y + s));
    fitSprite(pad);
  }

  sync() {
    const state = this.state();
    // isActive() is false during create(), so the first draw would be skipped.
    const status = this.sys?.settings.status;
    if (!state || (status !== Phaser.Scenes.CREATING && status !== Phaser.Scenes.RUNNING)) return;
    const { selected, editMode } = useGame.getState();
    const seen = new Set<number>();
    for (const b of state.buildings) {
      seen.add(b.id);
      const key = buildingTexture(this, this.content, b.defId, b.level);
      let img = this.sprites.get(b.id);
      if (!img) {
        img = this.add.image(0, 0, key);
        this.sprites.set(b.id, img);
      } else if (img.texture.key !== key) img.setTexture(key);
      if (this.drag?.id !== b.id) {
        this.placeSprite(img, b);
        this.placePad(b.id, b);
      }
      img.setTint(b.id === selected ? 0xfff2b3 : 0xffffff);
      img.setAlpha(editMode && this.drag && this.drag.id !== b.id ? 0.85 : 1);
    }
    for (const [id, img] of this.sprites) {
      if (!seen.has(id)) {
        img.destroy();
        this.sprites.delete(id);
      }
    }
    for (const [id, pad] of this.pads) {
      if (!seen.has(id)) {
        pad.destroy();
        this.pads.delete(id);
      }
    }
    if (selected !== this.lastSelected && selected !== null) sfx('select');
    this.lastSelected = selected;
    this.lastState = state;
  }

  private tileAt(p: Phaser.Input.Pointer) {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return toTile(w.x, w.y);
  }

  private buildingAt(p: Phaser.Input.Pointer): VillageBuilding | null {
    const state = this.state();
    if (!state) return null;
    const t = this.tileAt(p);
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    let best: VillageBuilding | null = null;
    for (const b of state.buildings) {
      const s = this.content.structures[b.defId]?.size ?? 1;
      if (tx >= b.x && ty >= b.y && tx < b.x + s && ty < b.y + s) best = b;
    }
    if (best) return best;
    // Tall sprites: test the picture itself, front to back.
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const sorted = [...state.buildings].sort(
      (a, b) => (this.sprites.get(b.id)?.depth ?? 0) - (this.sprites.get(a.id)?.depth ?? 0),
    );
    for (const b of sorted) {
      const img = this.sprites.get(b.id);
      if (img && b.defId !== 'wall' && img.getBounds().contains(w.x, w.y)) {
        const bounds = img.getBounds();
        if (w.y < bounds.bottom - (this.content.structures[b.defId]?.size ?? 1) * TH) return b;
      }
    }
    return null;
  }

  private setGhost(defId: string | null) {
    this.ghost?.destroy();
    this.ghost = null;
    this.ghostPos = null;
    this.wallStroke = [];
    if (!defId) return;
    this.ghost = this.add.image(0, 0, buildingTexture(this, this.content, defId, 1)).setAlpha(0.75);
    this.ghost.setDepth(99999);
  }

  private validAt(defId: string, x: number, y: number, skip?: number): boolean {
    const state = this.state();
    if (!state) return false;
    const occ = occupancy(this.content, state.buildings, skip !== undefined ? new Set([skip]) : undefined);
    for (const w of this.wallStroke) occ[w.y * this.content.map.size + w.x] = -3;
    return areaFree(this.content, occ, defId, x, y);
  }

  private onDown(p: Phaser.Input.Pointer): boolean {
    if (useGame.getState().visit) return false;
    const { placing, editMode } = useGame.getState();
    if (placing === 'wall') {
      const t = this.tileAt(p);
      this.tryWall(Math.floor(t.x), Math.floor(t.y));
      return true;
    }
    if (placing) return false;
    if (!editMode) return false;
    const b = this.buildingAt(p);
    if (!b) return false;
    const t = this.tileAt(p);
    this.drag = { id: b.id, defId: b.defId, offX: t.x - b.x, offY: t.y - b.y, x: b.x, y: b.y, valid: true };
    useGame.getState().select(b.id);
    return true;
  }

  private tryWall(x: number, y: number) {
    if (this.wallStroke.some((w) => w.x === x && w.y === y)) return;
    if (!this.validAt('wall', x, y)) return;
    this.wallStroke.push({ x, y });
    sfx('place');
  }

  private onMove(p: Phaser.Input.Pointer) {
    if (useGame.getState().visit) return;
    const { placing } = useGame.getState();
    const t = this.tileAt(p);
    if (placing && this.ghost) {
      const s = this.content.structures[placing]?.size ?? 1;
      const x = Math.floor(t.x - s / 2 + 0.5);
      const y = Math.floor(t.y - s / 2 + 0.5);
      const valid = this.validAt(placing, x, y);
      this.ghostPos = { x, y, valid };
      this.placeSprite(this.ghost, { defId: placing, x, y });
      this.ghost.setDepth(99999).setTint(valid ? 0xffffff : 0xff6666);
      if (placing === 'wall' && p.isDown) this.tryWall(Math.floor(t.x), Math.floor(t.y));
      return;
    }
    if (!this.drag) return;
    const x = Math.round(t.x - this.drag.offX);
    const y = Math.round(t.y - this.drag.offY);
    if (x === this.drag.x && y === this.drag.y) return;
    this.drag.x = x;
    this.drag.y = y;
    this.drag.valid = this.validAt(this.drag.defId, x, y, this.drag.id);
    const img = this.sprites.get(this.drag.id);
    if (img) {
      this.placeSprite(img, { defId: this.drag.defId, x, y });
      this.placePad(this.drag.id, { defId: this.drag.defId, x, y });
      img.setDepth(99998).setTint(this.drag.valid ? 0xfff2b3 : 0xff6666);
    }
  }

  private onUp(p: Phaser.Input.Pointer, tap: boolean) {
    if (useGame.getState().visit) return;
    const store = useGame.getState();
    if (store.placing === 'wall') {
      const walls = this.wallStroke;
      this.wallStroke = [];
      if (walls.length)
        void store.act({ type: 'build_walls', positions: walls }).then((ok) => ok && sfx('build'));
      return;
    }
    if (store.placing) {
      if (!tap) return;
      this.onMove(p);
      const pos = this.ghostPos;
      if (pos?.valid) {
        const defId = store.placing;
        store.setPlacing(null);
        void store
          .act({ type: 'build', defId: defId as never, x: pos.x, y: pos.y })
          .then((ok) => ok && sfx('build'));
      } else sfx('error');
      return;
    }
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      const original = this.state()?.buildings.find((b) => b.id === d.id);
      if (original && d.valid && (original.x !== d.x || original.y !== d.y)) {
        void store.act({ type: 'move', buildingId: d.id, x: d.x, y: d.y }).then(() => this.sync());
        sfx('place');
      } else this.sync();
      return;
    }
    if (!tap) return;
    const b = this.buildingAt(p);
    store.select(b ? b.id : null);
  }

  override update() {
    const g = this.overlay;
    g.clear();
    const state = this.state();
    if (!state) return;
    const now = serverNow();
    for (const job of state.builders) {
      if (!job || job.target !== 'building') continue;
      const b = state.buildings.find((x) => x.id === job.ref);
      const img = b && this.sprites.get(b.id);
      if (!b || !img) continue;
      const frac = Phaser.Math.Clamp((now - job.startedAt) / Math.max(1, job.endsAt - job.startedAt), 0, 1);
      const x = img.x - 24;
      const y = img.y - img.height * img.originY - 6;
      g.fillStyle(0x1f2937, 0.85);
      g.fillRoundedRect(x - 1, y - 1, 50, 8, 3);
      g.fillStyle(0x34d399, 1);
      g.fillRoundedRect(x, y, 48 * frac, 6, 2);
    }
    for (const w of this.wallStroke) {
      g.fillStyle(0xfff2b3, 0.6);
      const cx = isoX(w.x + 0.5, w.y + 0.5);
      const cy = isoY(w.x + 0.5, w.y + 0.5);
      g.fillTriangle(cx - TW / 2, cy, cx, cy - TH / 2, cx + TW / 2, cy);
      g.fillTriangle(cx - TW / 2, cy, cx, cy + TH / 2, cx + TW / 2, cy);
    }
    const sel = useGame.getState().selected;
    const b = sel !== null ? state.buildings.find((x) => x.id === sel) : undefined;
    if (b) {
      const s = this.content.structures[b.defId]?.size ?? 1;
      const pts = [
        [b.x, b.y],
        [b.x + s, b.y],
        [b.x + s, b.y + s],
        [b.x, b.y + s],
      ].map(([x, y]) => new Phaser.Math.Vector2(isoX(x!, y!), isoY(x!, y!)));
      g.lineStyle(2, buildingUpgrading(state, b.id) ? 0x34d399 : 0xfff2b3, 0.9);
      g.strokePoints(pts, true);
    }
  }
}
