import { css, type Ctx, INK, softShadow, tone } from './canvas.ts';

// Original troop, hero and siege designs: chunky proportions (big heads,
// stubby limbs), bold silhouettes, and one signature prop per unit.

const SKIN = 0xf1c27d;

export interface UnitArt {
  w: number;
  h: number;
  flying?: boolean;
  draw(ctx: Ctx, x: number, base: number, team: number): void;
}

function ell(
  ctx: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: number | string | CanvasGradient,
  stroke = true,
) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = typeof fill === 'number' ? css(fill) : fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}
function shaded(ctx: Ctx, x: number, y: number, r: number, color: number) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, css(tone(color, 1.25)));
  g.addColorStop(1, css(tone(color, 0.78)));
  return g;
}

interface Body {
  s: number;
  tunic: number;
  pants?: number;
  boots?: number;
  skin?: number;
  belt?: number;
  robe?: boolean;
}

/** Legs, torso and arms; returns head centre and right-hand position. */
function body(ctx: Ctx, x: number, base: number, b: Body) {
  const s = b.s;
  const skin = b.skin ?? SKIN;
  if (!b.robe) {
    for (const dx of [-3.2, 3.2]) {
      ctx.fillStyle = css(b.pants ?? 0x5a3b1e);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.roundRect(x + dx * s - 2.2 * s, base - 9 * s, 4.4 * s, 7 * s, 1.5 * s);
      ctx.fill();
      ctx.stroke();
      ell(ctx, x + dx * s + 0.6 * s, base - 1.6 * s, 3 * s, 2 * s, b.boots ?? 0x3a2414);
    }
  }
  // Torso (tunic or robe flaring to the ground).
  ctx.beginPath();
  if (b.robe) {
    ctx.moveTo(x - 6 * s, base - 21 * s);
    ctx.quadraticCurveTo(x - 8 * s, base - 8 * s, x - 9 * s, base - 1 * s);
    ctx.quadraticCurveTo(x, base + 1.5 * s, x + 9 * s, base - 1 * s);
    ctx.quadraticCurveTo(x + 8 * s, base - 8 * s, x + 6 * s, base - 21 * s);
  } else {
    ctx.moveTo(x - 6.5 * s, base - 21 * s);
    ctx.quadraticCurveTo(x - 8 * s, base - 12 * s, x - 6.5 * s, base - 7.5 * s);
    ctx.lineTo(x + 6.5 * s, base - 7.5 * s);
    ctx.quadraticCurveTo(x + 8 * s, base - 12 * s, x + 6.5 * s, base - 21 * s);
  }
  ctx.closePath();
  ctx.fillStyle = shaded(ctx, x, base - 14 * s, 11 * s, b.tunic);
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (b.belt !== undefined) {
    ctx.fillStyle = css(b.belt);
    ctx.fillRect(x - 7 * s, base - 11.5 * s, 14 * s, 2.4 * s);
    ctx.strokeRect(x - 7 * s, base - 11.5 * s, 14 * s, 2.4 * s);
    ctx.fillStyle = '#e8c34a';
    ctx.fillRect(x - 1.5 * s, base - 11.8 * s, 3 * s, 3 * s);
  }
  // Arms: left hangs, right is raised to hold a prop.
  ell(ctx, x - 7.5 * s, base - 15 * s, 2.6 * s, 4 * s, b.tunic);
  ell(ctx, x - 8 * s, base - 11.5 * s, 2.3 * s, 2.3 * s, skin);
  ell(ctx, x + 7.5 * s, base - 17 * s, 2.6 * s, 3.6 * s, b.tunic);
  const hand = { x: x + 9 * s, y: base - 20 * s };
  return { head: { x, y: base - 27 * s }, hand, s, skin };
}

function head(ctx: Ctx, x: number, y: number, s: number, skin = SKIN, fierce = true) {
  ctx.beginPath();
  ctx.arc(x, y, 7.5 * s, 0, Math.PI * 2);
  ctx.fillStyle = shaded(ctx, x, y, 7.5 * s, skin);
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // Eyes look toward the viewer's right, where attackers usually head.
  for (const dx of [0.4, 4]) {
    ell(ctx, x + dx * s, y + 0.5 * s, 1.7 * s, 2 * s, '#ffffff', false);
    ell(ctx, x + (dx + 0.6) * s, y + 0.8 * s, 1 * s, 1.3 * s, '#20140a', false);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3 * s;
  ctx.beginPath();
  if (fierce) {
    ctx.moveTo(x - 1.4 * s, y - 2.6 * s);
    ctx.lineTo(x + 2 * s, y - 1.6 * s);
    ctx.moveTo(x + 2.6 * s, y - 1.6 * s);
    ctx.lineTo(x + 5.8 * s, y - 2.8 * s);
  }
  ctx.stroke();
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.arc(x + 2.4 * s, y + 4.4 * s, 1.6 * s, 0.2, Math.PI - 0.2);
  ctx.stroke();
}

function teamCape(ctx: Ctx, x: number, base: number, s: number, team: number) {
  if (team !== 1) return;
  // Defending clan troops wear red sashes so they read as the other side.
  ctx.fillStyle = '#c0392b';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 6 * s, base - 21 * s);
  ctx.lineTo(x - 2 * s, base - 21 * s);
  ctx.lineTo(x + 6 * s, base - 9 * s);
  ctx.lineTo(x + 2 * s, base - 9 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function sword(ctx: Ctx, x: number, y: number, len: number, angle = -0.6, blade = '#e4e8ec') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = blade;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-1.8, 0);
  ctx.lineTo(-1.8, -len);
  ctx.lineTo(0, -len - 3.5);
  ctx.lineTo(1.8, -len);
  ctx.lineTo(1.8, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(-0.6, -len + 1, 0.9, len - 2);
  ctx.fillStyle = '#c99a2e';
  ctx.fillRect(-4.5, -1, 9, 2.6);
  ctx.strokeRect(-4.5, -1, 9, 2.6);
  ctx.fillStyle = '#5a3b1e';
  ctx.fillRect(-1.3, 1.6, 2.6, 4.5);
  ctx.restore();
}

function staff(ctx: Ctx, x: number, y: number, len: number, orb: number, orbR = 3.6) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + len * 0.5);
  ctx.lineTo(x + 1, y - len * 0.5);
  ctx.stroke();
  ctx.strokeStyle = '#7a4b25';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.lineCap = 'butt';
  const oy = y - len * 0.5 - orbR;
  const g = ctx.createRadialGradient(x + 1, oy, 0.5, x + 1, oy, orbR * 3);
  g.addColorStop(0, css(tone(orb, 1.5), 0.9));
  g.addColorStop(1, css(orb, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x + 1, oy, orbR * 3, 0, Math.PI * 2);
  ctx.fill();
  ell(ctx, x + 1, oy, orbR, orbR, shaded(ctx, x + 1, oy, orbR, orb));
}

function wing(ctx: Ctx, x: number, y: number, span: number, dir: number, color: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + dir * span * 0.5, y - span * 0.9, x + dir * span, y - span * 0.55);
  ctx.quadraticCurveTo(x + dir * span * 0.8, y - span * 0.25, x + dir * span * 0.85, y);
  ctx.quadraticCurveTo(x + dir * span * 0.55, y - span * 0.1, x + dir * span * 0.5, y + span * 0.18);
  ctx.quadraticCurveTo(x + dir * span * 0.25, y, x, y + span * 0.1);
  ctx.closePath();
  ctx.fillStyle = css(color);
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.strokeStyle = css(tone(color, 0.65));
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dir * span * 0.85, y - span * 0.4);
  ctx.moveTo(x, y);
  ctx.lineTo(x + dir * span * 0.6, y + span * 0.05);
  ctx.stroke();
}

function dragon(ctx: Ctx, x: number, y: number, s: number, color: number, belly: number, horn = '#efe6cf') {
  wing(ctx, x - 4 * s, y - 6 * s, 20 * s, -1, tone(color, 0.85));
  // Tail.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 4 * s, y + 2 * s);
  ctx.quadraticCurveTo(x - 16 * s, y + 6 * s, x - 18 * s, y - 4 * s);
  ctx.stroke();
  ctx.strokeStyle = css(color);
  ctx.lineWidth = 4 * s;
  ctx.stroke();
  ctx.lineCap = 'butt';
  ell(ctx, x, y, 10 * s, 8 * s, shaded(ctx, x, y, 10 * s, color));
  ell(ctx, x + 2 * s, y + 2.5 * s, 6 * s, 4.5 * s, belly, false);
  // Head and snout.
  ell(ctx, x + 9 * s, y - 9 * s, 6.5 * s, 5.5 * s, shaded(ctx, x + 9 * s, y - 9 * s, 6 * s, color));
  ell(ctx, x + 14 * s, y - 7 * s, 4 * s, 3 * s, color);
  ell(ctx, x + 10.5 * s, y - 10.5 * s, 1.6 * s, 1.8 * s, '#fff6c8', false);
  ell(ctx, x + 11 * s, y - 10.3 * s, 0.8 * s, 1.1 * s, '#20140a', false);
  for (const dx of [5, 9]) {
    ctx.fillStyle = horn;
    ctx.beginPath();
    ctx.moveTo(x + dx * s, y - 13 * s);
    ctx.lineTo(x + (dx - 2) * s, y - 19 * s);
    ctx.lineTo(x + (dx + 2) * s, y - 13.5 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  wing(ctx, x + 3 * s, y - 6 * s, 20 * s, 1, color);
}

export const UNITS: Record<string, UnitArt> = {
  swordsman: {
    w: 48,
    h: 60,
    draw(ctx, x, base, team) {
      const b = body(ctx, x, base, { s: 1, tunic: 0x3b6fd0, belt: 0x5a3b1e });
      teamCape(ctx, x, base, 1, team);
      sword(ctx, b.hand.x, b.hand.y, 15);
      ell(ctx, b.hand.x, b.hand.y, 2.3, 2.3, SKIN);
      head(ctx, b.head.x, b.head.y, 1);
      // Steel helmet with nose guard and plume.
      ctx.beginPath();
      ctx.arc(b.head.x, b.head.y - 1, 8, Math.PI, 0);
      ctx.lineTo(b.head.x + 8, b.head.y);
      ctx.lineTo(b.head.x - 8, b.head.y);
      ctx.closePath();
      ctx.fillStyle = shaded(ctx, b.head.x, b.head.y - 4, 8, 0xb9c0c8);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#9aa1a9';
      ctx.fillRect(b.head.x + 1.5, b.head.y - 1, 2, 5);
      ctx.strokeRect(b.head.x + 1.5, b.head.y - 1, 2, 5);
      ctx.fillStyle = '#d23b2c';
      ctx.beginPath();
      ctx.ellipse(b.head.x - 2, b.head.y - 10, 4, 2.4, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    },
  },
  archer: {
    w: 48,
    h: 60,
    draw(ctx, x, base, team) {
      // Quiver behind the shoulder.
      ctx.fillStyle = '#7a4b25';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.1;
      ctx.save();
      ctx.translate(x - 5, base - 22);
      ctx.rotate(-0.4);
      ctx.fillRect(-2.5, -6, 5, 13);
      ctx.strokeRect(-2.5, -6, 5, 13);
      ctx.fillStyle = '#e9e3d0';
      ctx.fillRect(-2, -9, 1.4, 4);
      ctx.fillRect(0.6, -10, 1.4, 5);
      ctx.restore();
      const b = body(ctx, x, base, { s: 0.95, tunic: 0x2f8f4e, belt: 0x6b4423, pants: 0x4a3420 });
      teamCape(ctx, x, base, 0.95, team);
      // Recurve bow.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.arc(b.hand.x - 2, b.hand.y + 2, 11, -1.15, 1.15);
      ctx.stroke();
      ctx.strokeStyle = '#8a5a2e';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = '#efe7d3';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(b.hand.x - 2 + Math.cos(-1.15) * 11, b.hand.y + 2 + Math.sin(-1.15) * 11);
      ctx.lineTo(b.hand.x - 2 + Math.cos(1.15) * 11, b.hand.y + 2 + Math.sin(1.15) * 11);
      ctx.stroke();
      ell(ctx, b.hand.x, b.hand.y + 2, 2.2, 2.2, SKIN);
      head(ctx, b.head.x, b.head.y, 0.95);
      // Hood.
      ctx.beginPath();
      ctx.arc(b.head.x, b.head.y, 8.6, Math.PI * 0.95, Math.PI * 0.05);
      ctx.quadraticCurveTo(b.head.x + 4, b.head.y - 4, b.head.x - 4, b.head.y - 3);
      ctx.quadraticCurveTo(b.head.x - 7, b.head.y + 3, b.head.x - 8.5, b.head.y + 4);
      ctx.closePath();
      ctx.fillStyle = shaded(ctx, b.head.x, b.head.y - 4, 9, 0x2a7a42);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    },
  },
  bulwark: {
    w: 64,
    h: 72,
    draw(ctx, x, base, team) {
      const s = 1.4;
      const b = body(ctx, x - 2, base, {
        s,
        tunic: 0x8f969e,
        belt: 0x5a3b1e,
        pants: 0x5a5f66,
        boots: 0x3a3d42,
      });
      teamCape(ctx, x - 2, base, s, team);
      head(ctx, b.head.x, b.head.y + 2, 1.15);
      // Full helm with a visor slit.
      ctx.beginPath();
      ctx.arc(b.head.x, b.head.y + 1, 9.6, Math.PI * 1.02, Math.PI * -0.02);
      ctx.lineTo(b.head.x + 9.4, b.head.y + 7);
      ctx.lineTo(b.head.x - 9.4, b.head.y + 7);
      ctx.closePath();
      ctx.fillStyle = shaded(ctx, b.head.x, b.head.y - 3, 10, 0xa7aeb6);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.fillStyle = '#20140a';
      ctx.fillRect(b.head.x - 1, b.head.y + 1, 9, 2.4);
      // Tower shield held forward.
      ctx.beginPath();
      ctx.roundRect(x + 2, base - 32, 16, 28, 4);
      ctx.fillStyle = shaded(ctx, x + 10, base - 18, 16, 0x8a5a2e);
      ctx.fill();
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = '#a1a8b1';
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ell(ctx, x + 10, base - 18, 3.2, 3.2, 0xc9d0d8);
    },
  },
  sapper: {
    w: 48,
    h: 60,
    draw(ctx, x, base, team) {
      const b = body(ctx, x, base, { s: 0.85, tunic: 0x8a6a4a, belt: 0x3a2414 });
      teamCape(ctx, x, base, 0.85, team);
      head(ctx, b.head.x, b.head.y + 1, 0.85, 0xe9b57a);
      // Miner's cap.
      ctx.beginPath();
      ctx.arc(b.head.x, b.head.y - 1, 6.8, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#e7802a';
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      // Barrel bomb hoisted overhead.
      const bx = b.head.x + 1,
        by = b.head.y - 15;
      ctx.beginPath();
      ctx.arc(bx, by, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = shaded(ctx, bx, by, 8.5, 0x2e2e33);
      ctx.fill();
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(bx - 3, by - 3, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c9a26b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx + 4, by - 7);
      ctx.quadraticCurveTo(bx + 9, by - 11, bx + 8, by - 14);
      ctx.stroke();
      ell(ctx, bx + 8, by - 15, 2.2, 2.2, '#ffcf4a', false);
      ell(ctx, x - 6, by + 5, 2, 2, 0xe9b57a);
      ell(ctx, x + 7, by + 5, 2, 2, 0xe9b57a);
    },
  },
  looter: {
    w: 48,
    h: 60,
    draw(ctx, x, base, team) {
      // Loot sack slung over the back.
      ctx.beginPath();
      ctx.ellipse(x - 7, base - 20, 7, 8, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = shaded(ctx, x - 7, base - 20, 8, 0xb08a58);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ell(ctx, x - 8, base - 24, 2.6, 1.6, '#f2c23a');
      const b = body(ctx, x + 1, base, { s: 0.92, tunic: 0x5b5470, belt: 0x2a1a0e, pants: 0x3a3448 });
      teamCape(ctx, x + 1, base, 0.92, team);
      head(ctx, b.head.x, b.head.y, 0.92, 0x9ccb6a);
      // Bandana mask and pointed ears.
      ctx.fillStyle = '#2a2433';
      ctx.fillRect(b.head.x - 7, b.head.y + 2.2, 14, 4);
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(b.head.x + d * 6, b.head.y - 2);
        ctx.lineTo(b.head.x + d * 12, b.head.y - 5);
        ctx.lineTo(b.head.x + d * 6.5, b.head.y + 2);
        ctx.closePath();
        ctx.fillStyle = '#9ccb6a';
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ell(ctx, b.hand.x, b.hand.y + 4, 2.2, 2.2, 0x9ccb6a);
      ell(ctx, b.hand.x + 1, b.hand.y + 1, 2.8, 1.5, '#f2c23a');
    },
  },
  wyvern: {
    w: 56,
    h: 56,
    flying: true,
    draw(ctx, x, base) {
      dragon(ctx, x - 2, base - 18, 0.8, 0x4fa34a, 0xd8e6a0);
    },
  },
  mage: {
    w: 48,
    h: 64,
    draw(ctx, x, base, team) {
      const b = body(ctx, x, base, { s: 1, tunic: 0x6a3fb3, robe: true });
      teamCape(ctx, x, base, 1, team);
      ctx.fillStyle = '#f2c23a';
      for (const [dx, dy] of [
        [-3, -6],
        [3, -12],
        [-1, -16],
      ] as [number, number][]) {
        ctx.beginPath();
        ctx.arc(x + dx, base + dy, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      staff(ctx, b.hand.x + 1, b.hand.y - 2, 26, 0x5cc8ff, 3.4);
      ell(ctx, b.hand.x, b.hand.y, 2.3, 2.3, SKIN);
      head(ctx, b.head.x, b.head.y, 1);
      // Pointed hat with a drooping tip.
      ctx.beginPath();
      ctx.moveTo(b.head.x - 10, b.head.y - 3);
      ctx.quadraticCurveTo(b.head.x, b.head.y - 7, b.head.x + 10, b.head.y - 3);
      ctx.lineTo(b.head.x + 3, b.head.y - 12);
      ctx.quadraticCurveTo(b.head.x + 1, b.head.y - 22, b.head.x - 6, b.head.y - 21);
      ctx.quadraticCurveTo(b.head.x - 2, b.head.y - 14, b.head.x - 4, b.head.y - 10);
      ctx.closePath();
      ctx.fillStyle = shaded(ctx, b.head.x, b.head.y - 10, 12, 0x5a32a0);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#f2c23a';
      ctx.fillRect(b.head.x - 6, b.head.y - 6.5, 12, 2);
    },
  },
  skyship: {
    w: 60,
    h: 76,
    flying: true,
    draw(ctx, x, base) {
      const by = base - 44;
      // Patched balloon.
      ctx.beginPath();
      ctx.ellipse(x, by, 18, 20, 0, 0, Math.PI * 2);
      ctx.fillStyle = shaded(ctx, x, by, 20, 0xc63b2c);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(255,230,170,0.85)';
      for (const dx of [-9, 9]) {
        ctx.beginPath();
        ctx.ellipse(x + dx, by, 4, 22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(x, by, 18, 20, 0, 0, Math.PI * 2);
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.strokeStyle = '#5a3b1e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 12, by + 14);
      ctx.lineTo(x - 7, base - 14);
      ctx.moveTo(x + 12, by + 14);
      ctx.lineTo(x + 7, base - 14);
      ctx.stroke();
      // Basket with a dangling bomb.
      ctx.beginPath();
      ctx.roundRect(x - 9, base - 16, 18, 9, 2);
      ctx.fillStyle = '#9a6a3c';
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.strokeStyle = '#6b4423';
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 9 + i * 4.5, base - 16);
        ctx.lineTo(x - 9 + i * 4.5, base - 7);
        ctx.stroke();
      }
      ell(ctx, x, base - 3, 4.5, 4.5, shaded(ctx, x, base - 3, 4.5, 0x2e2e33));
    },
  },
  vaulter: {
    w: 52,
    h: 64,
    draw(ctx, x, base, team) {
      // Vaulting pole carried at a slant.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 16, base - 4);
      ctx.lineTo(x + 18, base - 44);
      ctx.stroke();
      ctx.strokeStyle = '#c9a26b';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineCap = 'butt';
      const b = body(ctx, x, base, { s: 1, tunic: 0xd9a35a, belt: 0x6b4423, pants: 0x6b4423 });
      teamCape(ctx, x, base, 1, team);
      ell(ctx, b.hand.x - 1, b.hand.y - 1, 2.4, 2.4, 0xd8a06a);
      head(ctx, b.head.x, b.head.y, 1, 0xd8a06a);
      ctx.fillStyle = '#c63b2c';
      ctx.fillRect(b.head.x - 7.8, b.head.y - 4.5, 15.6, 3);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.strokeRect(b.head.x - 7.8, b.head.y - 4.5, 15.6, 3);
      ctx.beginPath();
      ctx.moveTo(b.head.x - 7, b.head.y - 3);
      ctx.lineTo(b.head.x - 13, b.head.y + 1);
      ctx.lineTo(b.head.x - 11, b.head.y - 4);
      ctx.fillStyle = '#c63b2c';
      ctx.fill();
      ctx.stroke();
    },
  },
  drake: {
    w: 84,
    h: 80,
    flying: true,
    draw(ctx, x, base) {
      dragon(ctx, x, base - 24, 1.35, 0xc8402c, 0xf2cf8a, '#f3ecdb');
    },
  },
  mender: {
    w: 56,
    h: 64,
    flying: true,
    draw(ctx, x, base, team) {
      const g = ctx.createRadialGradient(x, base - 20, 2, x, base - 20, 26);
      g.addColorStop(0, 'rgba(255,250,200,0.55)');
      g.addColorStop(1, 'rgba(255,250,200,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, base - 20, 26, 0, Math.PI * 2);
      ctx.fill();
      wing(ctx, x - 3, base - 26, 16, -1, 0xf6f0dc);
      const b = body(ctx, x, base - 4, { s: 0.95, tunic: 0xf3ecdb, robe: true });
      teamCape(ctx, x, base - 4, 0.95, team);
      wing(ctx, x + 3, base - 26, 16, 1, 0xfffaea);
      staff(ctx, b.hand.x + 1, b.hand.y - 1, 20, 0x7ee08a, 3);
      ell(ctx, b.hand.x, b.hand.y, 2.2, 2.2, SKIN);
      head(ctx, b.head.x, b.head.y, 0.95, SKIN, false);
      // Golden hair.
      ctx.beginPath();
      ctx.arc(b.head.x - 0.5, b.head.y - 1.5, 7.6, Math.PI * 0.9, Math.PI * 0.1);
      ctx.quadraticCurveTo(b.head.x + 2, b.head.y - 5, b.head.x - 7, b.head.y + 4);
      ctx.closePath();
      ctx.fillStyle = '#f2c23a';
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    },
  },
  necromancer: {
    w: 52,
    h: 66,
    draw(ctx, x, base, team) {
      const b = body(ctx, x, base, { s: 1.05, tunic: 0x2f2a3a, robe: true });
      teamCape(ctx, x, base, 1.05, team);
      // Skull-topped staff with green fire.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(b.hand.x, b.hand.y + 14);
      ctx.lineTo(b.hand.x + 1, b.hand.y - 16);
      ctx.stroke();
      ctx.strokeStyle = '#4a3a2a';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      const sy = b.hand.y - 20;
      const glow = ctx.createRadialGradient(b.hand.x + 1, sy, 1, b.hand.x + 1, sy, 12);
      glow.addColorStop(0, 'rgba(140,255,140,0.7)');
      glow.addColorStop(1, 'rgba(140,255,140,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(b.hand.x + 1, sy, 12, 0, Math.PI * 2);
      ctx.fill();
      ell(ctx, b.hand.x + 1, sy, 4.4, 4, 0xece6d4);
      ell(ctx, b.hand.x - 0.6, sy, 1, 1.2, '#20140a', false);
      ell(ctx, b.hand.x + 2.6, sy, 1, 1.2, '#20140a', false);
      ell(ctx, b.hand.x, b.hand.y, 2.3, 2.3, 0xb8c2a8);
      // Deep hood with glowing eyes.
      ctx.beginPath();
      ctx.arc(b.head.x, b.head.y, 9, Math.PI * 0.85, Math.PI * 0.15, false);
      ctx.quadraticCurveTo(b.head.x + 4, b.head.y - 18, b.head.x - 3, b.head.y - 16);
      ctx.closePath();
      ctx.fillStyle = shaded(ctx, b.head.x, b.head.y - 5, 10, 0x3a3348);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ell(ctx, b.head.x, b.head.y + 1, 6, 6, '#120e18', false);
      ell(ctx, b.head.x + 1, b.head.y + 1, 1.3, 1, '#9dff8a', false);
      ell(ctx, b.head.x + 4.5, b.head.y + 1, 1.3, 1, '#9dff8a', false);
    },
  },
  skeleton: {
    w: 44,
    h: 54,
    draw(ctx, x, base, team) {
      const bone = 0xece6d4;
      for (const dx of [-2.6, 2.6]) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(x + dx, base - 2);
        ctx.lineTo(x + dx, base - 9);
        ctx.stroke();
        ctx.strokeStyle = css(bone);
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      // Rib cage.
      ell(ctx, x, base - 14, 5, 5.5, bone);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.9;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 4, base - 16 + i * 2.6);
        ctx.lineTo(x + 4, base - 16 + i * 2.6);
        ctx.stroke();
      }
      teamCape(ctx, x, base + 2, 0.75, team);
      sword(ctx, x + 7, base - 14, 10, -0.5, '#b7bcc2');
      ell(ctx, x, base - 25, 6.4, 6, bone);
      ell(ctx, x + 0.6, base - 25, 1.6, 1.9, '#20140a', false);
      ell(ctx, x + 4, base - 25, 1.6, 1.9, '#20140a', false);
      ctx.fillStyle = '#20140a';
      ctx.fillRect(x, base - 21.5, 4, 1);
    },
  },
  warlord: {
    w: 60,
    h: 72,
    draw(ctx, x, base, team) {
      // Red cape behind.
      ctx.beginPath();
      ctx.moveTo(x - 7, base - 30);
      ctx.quadraticCurveTo(x - 14, base - 12, x - 11, base - 2);
      ctx.lineTo(x + 2, base - 4);
      ctx.lineTo(x + 4, base - 28);
      ctx.closePath();
      ctx.fillStyle = shaded(ctx, x - 6, base - 16, 14, 0xb3261e);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      const s = 1.25;
      const b = body(ctx, x, base, { s, tunic: 0xc99a2e, belt: 0x5a3b1e, pants: 0x6b4423, boots: 0x3a2414 });
      teamCape(ctx, x, base, s, team);
      // Great axe.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.moveTo(b.hand.x - 2, b.hand.y + 10);
      ctx.lineTo(b.hand.x + 5, b.hand.y - 22);
      ctx.stroke();
      ctx.strokeStyle = '#6b4423';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b.hand.x + 4, b.hand.y - 20);
      ctx.quadraticCurveTo(b.hand.x + 18, b.hand.y - 26, b.hand.x + 16, b.hand.y - 10);
      ctx.quadraticCurveTo(b.hand.x + 10, b.hand.y - 14, b.hand.x + 6, b.hand.y - 12);
      ctx.closePath();
      ctx.fillStyle = shaded(ctx, b.hand.x + 11, b.hand.y - 17, 9, 0xc9d0d8);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ell(ctx, b.hand.x, b.hand.y, 2.8, 2.8, SKIN);
      head(ctx, b.head.x, b.head.y, 1.15);
      // Braided beard.
      ctx.beginPath();
      ctx.moveTo(b.head.x - 7, b.head.y + 1);
      ctx.quadraticCurveTo(b.head.x - 6, b.head.y + 13, b.head.x + 2, b.head.y + 15);
      ctx.quadraticCurveTo(b.head.x + 9, b.head.y + 12, b.head.x + 8.5, b.head.y + 2);
      ctx.quadraticCurveTo(b.head.x + 2.5, b.head.y + 5.5, b.head.x - 7, b.head.y + 1);
      ctx.fillStyle = '#d97b2a';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      // Gold crown.
      ctx.beginPath();
      const hx = b.head.x,
        hy = b.head.y - 7;
      ctx.moveTo(hx - 8, hy + 2);
      for (const [dx, dy] of [
        [-8, -5],
        [-4, -1],
        [0, -7],
        [4, -1],
        [8, -5],
        [8, 2],
      ] as [number, number][])
        ctx.lineTo(hx + dx, hy + dy);
      ctx.closePath();
      ctx.fillStyle = shaded(ctx, hx, hy - 2, 8, 0xe8b83e);
      ctx.fill();
      ctx.stroke();
      ell(ctx, hx, hy - 1, 1.6, 1.6, '#d23b2c', false);
    },
  },
  sage: {
    w: 56,
    h: 72,
    draw(ctx, x, base, team) {
      const b = body(ctx, x, base, { s: 1.15, tunic: 0x2f5fa8, robe: true });
      teamCape(ctx, x, base, 1.15, team);
      staff(ctx, b.hand.x + 2, b.hand.y - 3, 32, 0x8ad8ff, 4);
      ell(ctx, b.hand.x, b.hand.y, 2.6, 2.6, SKIN);
      head(ctx, b.head.x, b.head.y, 1.1, SKIN, false);
      // Long white beard and tall hat.
      ctx.beginPath();
      ctx.moveTo(b.head.x - 6, b.head.y + 2);
      ctx.quadraticCurveTo(b.head.x - 3, b.head.y + 22, b.head.x + 3, b.head.y + 22);
      ctx.quadraticCurveTo(b.head.x + 8, b.head.y + 14, b.head.x + 8, b.head.y + 3);
      ctx.quadraticCurveTo(b.head.x + 1, b.head.y + 6, b.head.x - 6, b.head.y + 2);
      ctx.fillStyle = '#f1efe8';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b.head.x - 11, b.head.y - 4);
      ctx.quadraticCurveTo(b.head.x, b.head.y - 8, b.head.x + 11, b.head.y - 4);
      ctx.lineTo(b.head.x + 2, b.head.y - 28);
      ctx.closePath();
      ctx.fillStyle = shaded(ctx, b.head.x, b.head.y - 12, 12, 0x26508f);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f2c23a';
      ctx.beginPath();
      ctx.arc(b.head.x + 1, b.head.y - 15, 1.6, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  battering_ram: {
    w: 76,
    h: 64,
    draw(ctx, x, base) {
      // Wheels behind, frame, iron-capped log, and a small plank roof.
      for (const [dx, dy] of [
        [-16, -10],
        [10, -18],
      ] as [number, number][])
        wheel(ctx, x + dx, base + dy, 6);
      ctx.beginPath();
      ctx.moveTo(x - 24, base - 14);
      ctx.lineTo(x + 16, base - 34);
      ctx.lineTo(x + 24, base - 28);
      ctx.lineTo(x - 16, base - 8);
      ctx.closePath();
      ctx.fillStyle = '#8a5a2e';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      // Ram log.
      ctx.save();
      ctx.translate(x, base - 26);
      ctx.rotate(0.46);
      ctx.beginPath();
      ctx.roundRect(-26, -5, 44, 10, 5);
      ctx.fillStyle = shaded(ctx, -4, -2, 22, 0x9a6a3c);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(14, -7, 12, 14, 4);
      ctx.fillStyle = shaded(ctx, 20, -2, 8, 0x8f969e);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(x - 20, base - 34);
      ctx.lineTo(x + 6, base - 48);
      ctx.lineTo(x + 18, base - 40);
      ctx.lineTo(x - 8, base - 26);
      ctx.closePath();
      ctx.fillStyle = shaded(ctx, x, base - 38, 18, 0xcb5530);
      ctx.fill();
      ctx.stroke();
      for (const [dx, dy] of [
        [-8, 0],
        [20, -12],
      ] as [number, number][])
        wheel(ctx, x + dx, base + dy, 6.5);
    },
  },
};

function wheel(ctx: Ctx, x: number, y: number, r: number) {
  ell(ctx, x, y, r * 0.75, r, 0x6b4423);
  ell(ctx, x, y, r * 0.3, r * 0.4, 0x8f969e);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) {
    const t = (i / 4) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(t) * r * 0.7, y - Math.sin(t) * r * 0.95);
    ctx.lineTo(x + Math.cos(t) * r * 0.7, y + Math.sin(t) * r * 0.95);
    ctx.stroke();
  }
}

export const FALLBACK_UNIT: UnitArt = UNITS.swordsman!;

export function drawUnitShadow(ctx: Ctx, x: number, base: number, w: number) {
  softShadow(ctx, x, base, w * 0.26, w * 0.1, 0.38);
}
