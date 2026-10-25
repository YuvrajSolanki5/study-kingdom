import Phaser from 'phaser';

export interface PointerHandlers {
  /** A press that did not turn into a pan. Return true to take over the gesture (e.g. drag a building). */
  down?(p: Phaser.Input.Pointer): boolean | void;
  move?(p: Phaser.Input.Pointer): void;
  up?(p: Phaser.Input.Pointer, wasTap: boolean): void;
  /** Called every frame while the pointer is held without panning (continuous deploy). */
  hold?(p: Phaser.Input.Pointer, heldMs: number): void;
}

const TAP_SLOP = 8;

/**
 * Pan by dragging empty space, zoom with the wheel or trackpad pinch. A press
 * becomes a pan once it moves beyond TAP_SLOP unless a handler claimed it.
 */
export function attachControls(
  scene: Phaser.Scene,
  handlers: PointerHandlers,
  limits = { min: 0.35, max: 2.2 },
) {
  const cam = scene.cameras.main;
  let start: { x: number; y: number; sx: number; sy: number; t: number } | null = null;
  let panning = false;
  let claimed = false;

  scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
    start = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY, t: performance.now() };
    panning = false;
    claimed = !!handlers.down?.(p);
  });

  scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
    if (!start || !p.isDown) {
      handlers.move?.(p);
      return;
    }
    if (claimed) {
      handlers.move?.(p);
      return;
    }
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (!panning && Math.hypot(dx, dy) > TAP_SLOP) panning = true;
    if (panning) {
      cam.scrollX = start.sx - dx / cam.zoom;
      cam.scrollY = start.sy - dy / cam.zoom;
    } else handlers.move?.(p);
  });

  const end = (p: Phaser.Input.Pointer) => {
    if (!start) return;
    handlers.up?.(p, !panning);
    start = null;
    panning = false;
    claimed = false;
  };
  scene.input.on('pointerup', end);
  scene.input.on('pointerupoutside', end);

  scene.input.on('wheel', (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
    const before = cam.getWorldPoint(p.x, p.y);
    // Trackpad pinch arrives as ctrl+wheel with small deltas.
    const factor = Math.exp(-dy * (p.event instanceof WheelEvent && p.event.ctrlKey ? 0.01 : 0.0015));
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, limits.min, limits.max));
    const after = cam.getWorldPoint(p.x, p.y);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  });

  scene.events.on('update', () => {
    if (start && !panning && handlers.hold) {
      const p = scene.input.activePointer;
      if (p.isDown) handlers.hold(p, performance.now() - start.t);
    }
  });
}

/** Frame the central part of the map, where the village is, and centre it. */
export function frameMap(
  scene: Phaser.Scene,
  worldW: number,
  worldH: number,
  centerY: number,
  fraction = 0.5,
) {
  const cam = scene.cameras.main;
  const zoom = Math.min(cam.width / (worldW * fraction), cam.height / (worldH * fraction * 1.24));
  cam.setZoom(Phaser.Math.Clamp(zoom, 0.35, 1.3));
  cam.centerOn(0, centerY);
}
