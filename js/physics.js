import { clamp, LAP_COUNT, NEUTRAL, RACE_MS } from './common.js';

export const WORLD = { width: 1200, height: 675, roadWidth: 100 };
const knots = [
  [548, 550], [370, 550], [228, 550], [132, 492], [123, 342],
  [159, 172], [262, 115], [440, 115], [534, 175], [551, 271],
  [643, 316], [742, 274], [784, 163], [873, 115], [1030, 127],
  [1091, 207], [1078, 359], [1035, 484], [929, 543], [749, 550]
];

function spline(a, b, c, d, t) {
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d +
    t * (3 * b - a - 3 * c + d)));
}

const points = knots.flatMap((b, index) => {
  const a = knots.at(index - 1);
  const c = knots[(index + 1) % knots.length];
  const d = knots[(index + 2) % knots.length];
  return Array.from({ length: 12 }, (_, step) => {
    const t = step / 12;
    return { x: spline(a[0], b[0], c[0], d[0], t), y: spline(a[1], b[1], c[1], d[1], t) };
  });
});

let length = 0;
const segments = points.map((a, index) => {
  const b = points[(index + 1) % points.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const size = Math.hypot(dx, dy);
  const segment = { a, dx, dy, size, start: length };
  length += size;
  return segment;
});

export const TRACK = { points, length };
const HALF = WORLD.roadWidth / 2;
const FINISH_DISTANCE = TRACK.length * LAP_COUNT;
const wrap = distance => (distance % length + length) % length;
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function trackAt(distance, lane = 0) {
  const progress = wrap(distance);
  const segment = segments.find(s => s.start + s.size > progress) || segments[0];
  const { a, dx, dy, size, start } = segment;
  const t = (progress - start) / size;
  return {
    x: a.x + dx * t - dy * lane / size,
    y: a.y + dy * t + dx * lane / size,
    heading: Math.atan2(dy, dx)
  };
}

export function nearestTrack(x, y) {
  let nearest;
  let bestSquared = Infinity;
  for (const { a, dx, dy, size, start } of segments) {
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (size * size), 0, 1);
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const squared = (x - px) ** 2 + (y - py) ** 2;
    if (squared >= bestSquared) continue;
    bestSquared = squared;
    nearest = { x: px, y: py, distance: wrap(start + size * t) };
  }
  nearest.gap = Math.sqrt(bestSquared);
  return nearest;
}

export function createRace(entries) {
  return {
    elapsed: 0,
    cars: entries.map(({ seat, name, bot }, index) => {
      const progress = -24 - Math.floor(index / 2) * 37;
      const lane = index % 2 ? 24 : -24;
      const start = trackAt(progress, lane);
      return {
        ...start, seat, name, bot, lane, progress, trackDistance: wrap(progress),
        speed: 0, offroad: false, lap: 0, checkpoint: 0, finishedAt: 0
      };
    })
  };
}

export function botInput(car) {
  const lookAhead = 36 + car.speed * 0.27;
  const target = trackAt(car.trackDistance + lookAhead, car.lane * 0.38);
  const desired = Math.atan2(target.y - car.y, target.x - car.x);
  const error = angleDelta(desired, car.heading);
  const tangent = trackAt(car.trackDistance).heading;
  const turn = Math.abs(angleDelta(target.heading, tangent));
  const targetSpeed = 215 + Number(car.seat.slice(1)) * 17 - Math.min(turn, 1.6) * 76;
  return {
    steer: clamp(error * 2.4, -1, 1),
    gas: clamp((targetSpeed - car.speed) / 44, 0, 1),
    brake: car.speed > targetSpeed + 35 ? 0.45 : 0
  };
}

function move(car, input, dt) {
  const speed = Math.abs(car.speed);
  const direction = Math.sign(car.speed);
  const turn = input.steer * (2.25 + speed * 0.0037) * Math.min(1, speed / 45);
  car.heading = angleDelta(car.heading + turn * direction * dt, 0);
  const drag = car.offroad ? 105 + speed * 0.88 : 28 + speed * 0.18;

  // Pedal changes must pass through a full stop before changing direction.
  if (input.brake > 0) {
    car.speed = car.speed > 0
      ? Math.max(0, car.speed - (input.brake * 485 + drag) * dt)
      : Math.min(0, car.speed - (input.brake * 210 - drag) * dt);
  } else if (input.gas > 0) {
    car.speed = car.speed < 0
      ? Math.min(0, car.speed + (input.gas * 290 + drag) * dt)
      : Math.max(0, car.speed + (input.gas * 290 - drag) * dt);
  } else {
    car.speed = direction * Math.max(0, speed - drag * dt);
  }
  car.speed = clamp(car.speed, car.offroad ? -85 : -125, car.offroad ? 175 : 385);
  car.x += Math.cos(car.heading) * car.speed * dt;
  car.y += Math.sin(car.heading) * car.speed * dt;
}

function collide(a, b) {
  if (a.finishedAt || b.finishedAt) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const gap = Math.hypot(dx, dy);
  if (gap >= 21) return;
  const push = (21 - gap) / 2;
  const nx = gap ? dx / gap : 1;
  const ny = gap ? dy / gap : 0;
  a.x -= nx * push; a.y -= ny * push;
  b.x += nx * push; b.y += ny * push;
  a.speed *= 0.985; b.speed *= 0.985;
}

function updateProgress(car, elapsed) {
  const road = nearestTrack(car.x, car.y);
  car.offroad = road.gap > HALF - 4;
  const boundary = HALF + 18;
  if (road.gap > boundary) {
    const ratio = boundary / road.gap;
    car.x = road.x + (car.x - road.x) * ratio;
    car.y = road.y + (car.y - road.y) * ratio;
    car.speed *= 0.94;
  }
  const delta = wrap(road.distance - car.trackDistance + length / 2) - length / 2;
  car.trackDistance = road.distance;
  if (Math.abs(delta) > 45) return;
  car.progress += delta;
  const sector = length / 4;
  if (car.progress >= (car.checkpoint + 1) * sector && road.gap <= boundary) {
    car.checkpoint++;
    car.lap = Math.min(LAP_COUNT, Math.floor(car.checkpoint / 4));
  }
  if (car.checkpoint >= LAP_COUNT * 4 && car.progress >= FINISH_DISTANCE) {
    car.finishedAt = Math.max(1, Math.round(elapsed));
    car.speed = 0;
  }
}

export function stepRace(race, inputs, seconds, elapsed) {
  race.elapsed = elapsed;
  for (const car of race.cars) {
    if (!car.finishedAt) move(car, car.bot ? botInput(car) : (inputs[car.seat] || NEUTRAL), seconds);
  }
  for (let i = 0; i < race.cars.length; i++) {
    for (const other of race.cars.slice(i + 1)) collide(race.cars[i], other);
  }
  for (const car of race.cars) {
    if (!car.finishedAt) updateProgress(car, elapsed);
  }
}

export function standings(cars) {
  return [...cars].sort((a, b) =>
    (a.finishedAt || Infinity) - (b.finishedAt || Infinity) || b.progress - a.progress);
}

export function raceResult(race) {
  const finished = standings(race.cars);
  return {
    winner: finished[0]?.finishedAt ? Number(finished[0].seat.slice(1)) : -1,
    times: Object.fromEntries(race.cars.map(car => [
      car.seat, car.finishedAt ? Math.min(car.finishedAt, RACE_MS) : 0
    ]))
  };
}
