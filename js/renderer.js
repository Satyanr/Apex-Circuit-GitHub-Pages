import { SEATS, COLORS } from './common.js';
import { TRACK, WORLD, trackAt } from './physics.js';

const TAU = Math.PI * 2;

function pathTrack(ctx) {
  ctx.beginPath();
  TRACK.points.forEach(({ x, y }, index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
}

function stripe(ctx, width, color) {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function chevron(ctx, distance) {
  const { x, y, heading } = trackAt(distance);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.beginPath();
  ctx.moveTo(-8, -8);
  ctx.lineTo(3, 0);
  ctx.lineTo(-8, 8);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#c1cdc454';
  ctx.stroke();
  ctx.restore();
}

function label(ctx, x, y, title, detail) {
  ctx.textAlign = 'left';
  ctx.fillStyle = '#758d7a';
  ctx.font = '700 12px monospace';
  ctx.fillText(detail, x, y);
  ctx.fillStyle = '#b3c8ac';
  ctx.font = '900 24px system-ui';
  ctx.fillText(title, x, y + 30);
}

function trackArt() {
  const surface = document.createElement('canvas');
  surface.width = WORLD.width;
  surface.height = WORLD.height;
  const ctx = surface.getContext('2d');
  ctx.fillStyle = '#1b2b21';
  ctx.fillRect(0, 0, surface.width, surface.height);

  ctx.strokeStyle = '#304535';
  ctx.lineWidth = 1;
  for (let x = 0; x < WORLD.width; x += 27) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); ctx.stroke();
  }
  for (let y = 0; y < WORLD.height; y += 27) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke();
  }
  ctx.strokeStyle = '#456150';
  ctx.strokeRect(32.5, 35.5, 1135, 604);

  for (let i = 0; i < 1060; i++) {
    const x = (i * 1237.67) % WORLD.width;
    const y = (i * i * 27.41 + i * 19) % WORLD.height;
    ctx.fillStyle = i % 4 ? '#80a28726' : '#040b0750';
    ctx.fillRect(x, y, i % 3 + 1, 1);
  }
  ctx.lineJoin = 'round';
  pathTrack(ctx);
  stripe(ctx, 128, '#111b16');
  stripe(ctx, 121, '#6d7e65');
  stripe(ctx, 115, '#303d33');
  stripe(ctx, 103, '#adb7a5');
  stripe(ctx, 98, '#42494a');
  stripe(ctx, 82, '#3a4244');
  ctx.setLineDash([9, 21]);
  stripe(ctx, 1.5, '#97a29c49');
  ctx.setLineDash([]);

  const curbSteps = Math.round(TRACK.length / 14);
  for (const side of [-1, 1]) {
    for (let i = 0; i < curbSteps; i++) {
      const a = trackAt(i * TRACK.length / curbSteps, 54 * side);
      const b = trackAt((i + 1) * TRACK.length / curbSteps, 54 * side);
      ctx.strokeStyle = i % 2 ? '#cbd4bf' : '#b25949';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  for (let distance = 180; distance < TRACK.length - 125; distance += 210) chevron(ctx, distance);

  const start = trackAt(0);
  ctx.save();
  ctx.translate(start.x, start.y);
  ctx.rotate(start.heading);
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 2; col++) {
      ctx.fillStyle = (row + col) % 2 ? '#e9ede2' : '#151c18';
      ctx.fillRect(col * 8 - 8, row * 8 - 48, 8, 8);
    }
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#c6d7ca88';
  for (const x of [-23, -60]) {
    for (const y of [-25, 25]) ctx.strokeRect(x - 16, y - 11, 32, 22);
  }
  ctx.restore();

  ctx.fillStyle = '#344e3a';
  ctx.font = 'italic 900 61px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('NEON LOOP', 594, 425);
  ctx.fillStyle = '#90a88e';
  ctx.font = '700 13px monospace';
  ctx.fillText('A P E X   C I R C U I T   /   S I R K U I T   0 1', 595, 449);
  label(ctx, 215, 235, 'PIT LANE', 'SEKTOR 01');
  label(ctx, 847, 236, 'APEX CLUB', 'SEKTOR 03');

  ctx.strokeStyle = '#536e57';
  ctx.lineWidth = 1.5;
  for (const x of [205, 835]) {
    for (let i = 0; i < 6; i++) ctx.strokeRect(x + i * 14, 283, 10, 24);
  }
  ctx.fillStyle = '#d5fa52';
  ctx.font = '700 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('GRID / FINIS', 548, 628);
  return surface;
}

function drawCar(ctx, car) {
  const color = COLORS[SEATS.indexOf(car.seat)];
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.heading);
  ctx.fillStyle = '#0009';
  ctx.beginPath(); ctx.ellipse(1, 3, 20, 11, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#141a17';
  for (const x of [-12, 7]) for (const y of [-11, 7]) ctx.fillRect(x, y, 8, 4);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-17, -8); ctx.lineTo(10, -8); ctx.lineTo(18, -4);
  ctx.lineTo(18, 4); ctx.lineTo(10, 8); ctx.lineTo(-17, 8);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#20312c';
  ctx.fillRect(-5, -5, 12, 10);
  ctx.fillStyle = '#fffedc';
  ctx.fillRect(14, -6, 3, 3);
  ctx.fillRect(14, 3, 3, 3);
  ctx.fillStyle = '#2b3932';
  ctx.fillRect(-16, -8, 3, 16);
  ctx.restore();
  ctx.font = '900 14px monospace';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#131a16';
  ctx.fillStyle = color;
  const number = String(SEATS.indexOf(car.seat) + 1).padStart(2, '0');
  ctx.strokeText(number, car.x, car.y - 17);
  ctx.fillText(number, car.x, car.y - 17);
}

export function makeRenderer(canvas) {
  const surface = trackArt();
  const ctx = canvas.getContext('2d');
  return cars => {
    ctx.drawImage(surface, 0, 0);
    for (const car of cars) drawCar(ctx, car);
  };
}
