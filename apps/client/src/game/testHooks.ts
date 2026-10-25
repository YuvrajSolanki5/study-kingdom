import type Phaser from 'phaser';
import { local } from '../platform/storage.ts';
import { isoX, isoY } from './iso.ts';

interface Hook {
  scene: string;
  owner: Phaser.Scene;
  tileToPage(x: number, y: number): { x: number; y: number };
}

/**
 * Opt-in hooks for end-to-end tests (localStorage `sk.e2e` = "1"): map tile
 * coordinates to page coordinates so tests can tap the canvas. They give no
 * extra powers — every action still goes through normal input and the server.
 */
export function exposeScene(scene: Phaser.Scene, name: 'village' | 'battle') {
  if (local.get('sk.e2e') !== '1') return;
  const w = window as unknown as { __sk?: Hook };
  const hook: Hook = {
    scene: name,
    owner: scene,
    tileToPage(x: number, y: number) {
      const cam = scene.cameras.main;
      const canvas = scene.game.canvas.getBoundingClientRect();
      return {
        x: canvas.left + (isoX(x, y) - cam.worldView.x) * cam.zoom,
        y: canvas.top + (isoY(x, y) - cam.worldView.y) * cam.zoom,
      };
    },
  };
  w.__sk = hook;
  const clear = () => {
    if (w.__sk === hook) delete w.__sk;
  };
  scene.events.once('shutdown', clear);
  scene.events.once('destroy', clear);
}
