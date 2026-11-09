const cv = document.getElementById("game");
const VERSION = "10";
const DEBUG = new URLSearchParams(location.search).has("debug");
const debugLog = [];
function dbg(msg) {
  if (!DEBUG) return;
  debugLog.push(`${(performance.now() / 1000).toFixed(2)} ${msg}`);
  if (debugLog.length > 16) debugLog.shift();
}
const ctx = cv.getContext("2d");
const W = 480,
  H = 800,
  GROUND = 70;
const TOTAL = 50,
  MINOR = 30;
const GRAVITY = 2600;
const HOVER = 260;
const BASE = { x: W / 2 - 120, y: 0, w: 240, h: 30, base: true };

// Block i (0-based): smaller and faster the higher you get.
function spec(i) {
  const t = i / (TOTAL - 1);
  return {
    w: Math.round(170 - 134 * Math.pow(t, 0.85)),
    h: Math.round(44 - 20 * t),
    speed: 170 + 450 * Math.pow(t, 1.1),
  };
}

function color(i) {
  return `hsl(${(i * 27) % 360}, 95%, 58%)`;
}

// World heights of the prize lines.
function heightAfter(n) {
  let y = BASE.h;
  for (let i = 0; i < n; i++) y += spec(i).h;
  return y;
}
const MINOR_Y = heightAfter(MINOR),
  MAJOR_Y = heightAfter(TOTAL);

const stars = Array.from({ length: 90 }, () => ({
  x: Math.random() * W,
  y: Math.random() * H,
  r: Math.random() * 1.6 + 0.3,
}));

let state = "title",
  tower,
  cur,
  debris,
  particles,
  camY = 0,
  timer = 0,
  shake = 0,
  level = 0,
  banner = null;
let best = +localStorage.getItem("crazyTowerBest") || 0;

// ---------- audio ----------
let actx = null;
function beep(f, d = 0.1, type = "square", vol = 0.07, slideTo = 0, delay = 0) {
  if (!actx) return;
  const t0 = actx.currentTime + delay;
  const o = actx.createOscillator(),
    g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + d);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(g).connect(actx.destination);
  o.start(t0);
  o.stop(t0 + d);
}
const sfx = {
  drop: () => beep(500, 0.08, "square", 0.05, 200),
  land: (lvl) => {
    beep(180 + lvl * 14, 0.12, "triangle", 0.12);
    beep(360 + lvl * 28, 0.08, "square", 0.04, 0, 0.04);
  },
  fail: () => {
    beep(400, 0.6, "sawtooth", 0.08, 60);
    beep(200, 0.8, "square", 0.05, 40, 0.15);
  },
  minor: () =>
    [523, 659, 784].forEach((f, i) =>
      beep(f, 0.15, "square", 0.06, 0, i * 0.1),
    ),
  win: () =>
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) =>
      beep(f, 0.2, "square", 0.07, 0, i * 0.12),
    ),
};

// ---------- game flow ----------
function start() {
  tower = [BASE];
  debris = [];
  particles = [];
  level = 0;
  camY = 0;
  banner = null;
  Techno.setLevel(0, TOTAL);
  Techno.start();
  spawn();
}

const topBlock = () => tower[tower.length - 1];
const towerTop = () => topBlock().y + topBlock().h;

function spawn() {
  const s = spec(level);
  const dir = Math.random() < 0.5 ? 1 : -1;
  cur = {
    x: dir > 0 ? 0 : W - s.w,
    y: towerTop() + HOVER,
    w: s.w,
    h: s.h,
    vx: s.speed * dir,
    vy: 0,
    color: color(level),
  };
  state = "moving";
}

function press() {
  if (state === "title" || ((state === "over" || state === "win") && timer > 1))
    return start();
  if (state === "moving") {
    state = "dropping";
    cur.vy = 0;
    sfx.drop();
  }
}

// Lowest level whose supporting contact can't hold the center of mass of everything above it.
function findTopple() {
  for (let k = 1; k < tower.length; k++) {
    let m = 0,
      mx = 0;
    for (let j = k; j < tower.length; j++) {
      const b = tower[j],
        a = b.w * b.h;
      m += a;
      mx += a * (b.x + b.w / 2);
    }
    const com = mx / m,
      s = tower[k - 1],
      b = tower[k];
    const lo = Math.max(s.x, b.x),
      hi = Math.min(s.x + s.w, b.x + b.w);
    if (com < lo) return { k, dir: -1, px: lo, py: b.y };
    if (com > hi) return { k, dir: 1, px: hi, py: b.y };
  }
  return null;
}

function fail() {
  state = "failing";
  timer = 0;
  shake = 14;
  Techno.stop();
  sfx.fail();
  if (level > best) {
    best = level;
    localStorage.setItem("crazyTowerBest", best);
  }
}

function land() {
  const t = topBlock();
  const overlap = Math.min(cur.x + cur.w, t.x + t.w) - Math.max(cur.x, t.x);
  if (overlap <= 0) {
    const dir = Math.sign(cur.x + cur.w / 2 - (t.x + t.w / 2)) || 1;
    debris.push({
      blocks: [cur],
      px: cur.x + cur.w / 2,
      py: cur.y,
      dir,
      angle: 0,
      omega: 4,
      free: true,
      ox: 0,
      oy: 0,
      vx: dir * 140,
      vy: cur.vy * 0.3,
    });
    return fail();
  }
  cur.y = towerTop();
  const block = { x: cur.x, y: cur.y, w: cur.w, h: cur.h, color: cur.color };
  tower.push(block);
  burst(cur.x + cur.w / 2, cur.y, cur.color, 14);
  shake = 4;

  const tp = findTopple();
  if (tp) {
    debris.push({
      blocks: tower.splice(tp.k),
      px: tp.px,
      py: tp.py,
      dir: tp.dir,
      angle: 0,
      omega: 0.6,
      free: false,
      ox: 0,
      oy: 0,
      vx: 0,
      vy: 0,
    });
    return fail();
  }

  level++;
  Techno.setLevel(level, TOTAL);
  sfx.land(level);
  if (level > best) {
    best = level;
    localStorage.setItem("crazyTowerBest", best);
  }
  if (level === TOTAL) {
    state = "win";
    timer = 0;
    sfx.win();
    for (let i = 0; i < 8; i++)
      burst(
        Math.random() * W,
        towerTop() + Math.random() * 300,
        color(i * 6),
        30,
      );
    return;
  }
  if (level === MINOR) {
    banner = { text: "MINOR PRIZE!", t: 1.8 };
    sfx.minor();
  }
  state = "settle";
  timer = 0;
}

function burst(x, y, c, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI,
      s = 100 + Math.random() * 300;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.6 + Math.random() * 0.6,
      c,
    });
  }
}

// ---------- update ----------
function update(dt) {
  timer += dt;
  shake = Math.max(0, shake - dt * 40);
  if (banner && (banner.t -= dt) <= 0) banner = null;

  if (state === "title") return;

  const target = Math.max(0, towerTop() - 260);
  camY += (target - camY) * Math.min(1, dt * 4);

  if (state === "moving") {
    cur.x += cur.vx * dt;
    if (cur.x < 0) {
      cur.x = 0;
      cur.vx *= -1;
    }
    if (cur.x > W - cur.w) {
      cur.x = W - cur.w;
      cur.vx *= -1;
    }
  } else if (state === "dropping") {
    cur.vy -= GRAVITY * dt;
    cur.y += cur.vy * dt;
    if (cur.y <= towerTop()) land();
  } else if (state === "settle" && timer > 0.3) {
    spawn();
  } else if (state === "failing" && timer > 2) {
    state = "over";
    timer = 0;
  }

  for (const d of debris) {
    if (!d.free) {
      d.omega += 7 * dt;
      d.angle += d.omega * dt;
      if (d.angle > 0.9) {
        d.free = true;
        d.vx = d.dir * d.omega * 70;
        d.vy = 0;
      }
    } else {
      d.vy -= GRAVITY * 0.6 * dt;
      d.ox += d.vx * dt;
      d.oy += d.vy * dt;
      d.angle += d.omega * dt;
    }
  }

  for (const p of particles) {
    p.vy -= 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0);
}

// ---------- render ----------
const sy = (wy) => H - GROUND - (wy - camY);

function drawBlock(b) {
  const y = sy(b.y + b.h);
  if (b.base) {
    const g = ctx.createLinearGradient(0, y, 0, y + b.h);
    g.addColorStop(0, "#d8d8e8");
    g.addColorStop(1, "#55556a");
    ctx.fillStyle = g;
    ctx.fillRect(b.x, y, b.w, b.h);
    return;
  }
  ctx.shadowColor = b.color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.roundRect(b.x, y, b.w, b.h, 4);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,.4)";
  ctx.fillRect(b.x + 3, y + 3, b.w - 6, 4);
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fillRect(b.x + 3, y + b.h - 6, b.w - 6, 3);
}

function prizeLine(wy, label, c) {
  const y = sy(wy);
  if (y < -20 || y > H) return;
  ctx.strokeStyle = c;
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(W, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = c;
  ctx.font = '16px "Arial Black", Impact, sans-serif';
  ctx.textAlign = "left";
  ctx.fillText(label, 8, y - 6);
}

function text(str, x, y, size, c = "#fff", glow = c) {
  ctx.font = `${size}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = "center";
  ctx.shadowColor = glow;
  ctx.shadowBlur = 16;
  ctx.fillStyle = c;
  ctx.fillText(str, x, y);
  ctx.shadowBlur = 0;
}

function render(now) {
  ctx.save();
  if (shake)
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#12002e");
  bg.addColorStop(1, "#3a0a4a");
  ctx.fillStyle = bg;
  ctx.fillRect(-20, -20, W + 40, H + 40);
  const pulse = Techno.pulse();
  ctx.fillStyle = `rgba(255,43,214,${pulse * 0.1})`;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  ctx.fillStyle = "#fff";
  for (const s of stars) {
    ctx.globalAlpha = 0.4 + 0.4 * Math.sin(now / 400 + s.x);
    ctx.fillRect(s.x, (s.y + camY * 0.3) % H, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  prizeLine(MINOR_Y, "MINOR PRIZE", "#3cf");
  prizeLine(MAJOR_Y, "MAJOR PRIZE", "#fd0");

  const gy = sy(0);
  ctx.fillStyle = "#1b1030";
  ctx.fillRect(-20, gy, W + 40, H);
  ctx.fillStyle = "#ff2bd6";
  ctx.fillRect(-20, gy, W + 40, 3 + pulse * 5);

  (tower || [BASE]).forEach(drawBlock);

  for (const d of debris || []) {
    const px = d.px,
      py = sy(d.py);
    ctx.save();
    ctx.translate(px + d.ox, py - d.oy);
    ctx.rotate(d.dir * d.angle);
    ctx.translate(-px, -py);
    d.blocks.forEach(drawBlock);
    ctx.restore();
  }

  if (cur && (state === "moving" || state === "dropping")) {
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(cur.x + cur.w / 2, sy(cur.y));
    ctx.lineTo(cur.x + cur.w / 2, sy(towerTop()));
    ctx.stroke();
    ctx.setLineDash([]);
    drawBlock(cur);
  }

  for (const p of particles || []) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x - 2, sy(p.y) - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // HUD
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.fillRect(0, 0, W, 54);
  ctx.font = '22px "Arial Black", Impact, sans-serif';
  ctx.textAlign = "left";
  ctx.fillStyle = "#fd0";
  ctx.fillText(
    `BLOK ${Math.min(level + (state === "win" ? 0 : 1), TOTAL)}/${TOTAL}`,
    14,
    36,
  );
  ctx.textAlign = "right";
  ctx.fillStyle = "#3cf";
  ctx.fillText(`BEST ${best}`, W - 14, 36);

  // progress meter
  const mh = 300,
    mx = W - 18,
    my = 90;
  ctx.fillStyle = "rgba(255,255,255,.15)";
  ctx.fillRect(mx, my, 8, mh);
  ctx.fillStyle = color(level);
  const ph = (mh * level) / TOTAL;
  ctx.fillRect(mx, my + mh - ph, 8, ph);
  ctx.fillStyle = "#3cf";
  ctx.fillRect(mx - 4, my + mh - (mh * MINOR) / TOTAL, 16, 2);

  if (banner) text(banner.text, W / 2, 140, 40, "#fff", "#3cf");

  const blink = Math.floor(now / 500) % 2 === 0;
  if (state === "title") {
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fillRect(0, 0, W, H);
    text("CRAZY", W / 2, 260, 72, "#ff2bd6");
    text("TOWER", W / 2, 335, 72, "#fd0");
    text(`Stapel ${TOTAL} blokken!`, W / 2, 420, 24);
    text("Ze worden kleiner en sneller...", W / 2, 455, 18, "#ccc", "#000");
    if (blink) text("DRUK OP SPATIE / DROP", W / 2, 560, 24, "#3cf");
    text(`v${VERSION}`, W / 2, H - 20, 14, "#888", "#000");
  } else if (state === "over") {
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0, 0, W, H);
    text("GAME OVER", W / 2, 320, 58, "#f33");
    text(`${level} blokken gestapeld`, W / 2, 390, 26);
    if (level >= MINOR) text("MINOR PRIZE GEWONNEN!", W / 2, 430, 22, "#3cf");
    if (blink && timer > 1)
      text("DRUK OM OPNIEUW TE SPELEN", W / 2, 540, 20, "#fd0");
  } else if (state === "win") {
    if (Math.random() < 0.3)
      burst(
        Math.random() * W,
        camY + 200 + Math.random() * 500,
        color(Math.floor(Math.random() * 50)),
        10,
      );
    text("JACKPOT!", W / 2, 300, 72, "#fd0");
    text("MAJOR PRIZE", W / 2, 360, 34, "#fff", "#ff2bd6");
    if (blink && timer > 1)
      text("DRUK OM OPNIEUW TE SPELEN", W / 2, 540, 20, "#3cf");
  }

  if (DEBUG) {
    const lines = [
      `ctx=${actx ? actx.state : "none"} t=${actx ? actx.currentTime.toFixed(2) : "-"} music=${Techno.playing}`,
      ...debugLog,
    ];
    ctx.fillStyle = "rgba(0,0,0,.7)";
    ctx.fillRect(0, H - 16 * lines.length - 30, W, 16 * lines.length + 30);
    ctx.font = "13px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#0f0";
    lines.forEach((l, i) =>
      ctx.fillText(l, 6, H - 16 * lines.length - 10 + i * 16),
    );
  }
}

// ---------- loop & input ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  keepAudioAlive(now);
  update(dt);
  render(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

const musicBtn = document.getElementById("music");
function toggleMusic() {
  musicBtn.classList.toggle("off", Techno.toggleMute());
}

addEventListener("keydown", (e) => {
  if ((e.code === "Space" || e.code === "Enter") && !e.repeat) {
    e.preventDefault();
    press();
  } else if (e.code === "KeyM") {
    toggleMusic();
  }
});
cv.addEventListener("pointerdown", press);
// Touch pointerdown is not a user-activation event in Chrome; pointerup/touchend then complete the unlock.
function unlockAudio(e) {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: "playback",
    });
    dbg(
      `create on ${e.type} -> ${actx.state} base=${actx.baseLatency?.toFixed(3)}`,
    );
    actx.onstatechange = () => {
      dbg(`state -> ${actx.state}`);
      if (actx.state === "running") Techno.resume();
    };
    Techno.init(actx);
  }
  if (actx.state !== "running") {
    // A silent buffer started inside the gesture helps Chrome Android open the output stream.
    const src = actx.createBufferSource();
    src.buffer = actx.createBuffer(1, 1, 22050);
    src.connect(actx.destination);
    src.start();
    actx.resume().then(
      () => {
        dbg(`resume ok -> ${actx.state}`);
        if (actx.state === "running") Techno.resume();
      },
      (err) => dbg(`resume fail ${err}`),
    );
  }
}
// Chrome Android suspends the context on focus loss (e.g. screenshot) without visibilitychange,
// and sometimes reports "running" while the clock never advances. Sticky activation allows resume().
let audioCheckAt = 0,
  audioLastTime = -1,
  audioStuckSince = 0;
function keepAudioAlive(now) {
  if (!actx || document.hidden || now - audioCheckAt < 100) return;
  audioCheckAt = now;
  if (actx.state !== "running") {
    if (audioLastTime !== -1) dbg(`watchdog resume (${actx.state})`);
    actx.resume().catch((err) => dbg(`resume fail ${err}`));
    audioLastTime = -1;
    return;
  }
  if (actx.currentTime !== audioLastTime) {
    audioLastTime = actx.currentTime;
    audioStuckSince = now;
  } else if (now - audioStuckSince > 300) {
    dbg(`watchdog stalled at t=${actx.currentTime.toFixed(2)}, restart`);
    actx.suspend().then(() => actx.resume());
    audioLastTime = -1;
  }
}
if (DEBUG)
  for (const ev of [
    "pointerdown",
    "pointerup",
    "pointercancel",
    "touchend",
    "touchcancel",
    "click",
  ])
    addEventListener(
      ev,
      (e) =>
        dbg(
          `${e.type}${e.pointerType ? "/" + e.pointerType : ""} act=${navigator.userActivation?.isActive}`,
        ),
      true,
    );
for (const ev of ["pointerdown", "pointerup", "touchend", "click", "keydown"])
  addEventListener(ev, unlockAudio, true);
document.addEventListener("visibilitychange", () => {
  // Never create the context here: there's no user gesture, so it would start blocked.
  if (!document.hidden && actx && actx.state !== "running") actx.resume();
});
document.getElementById("btn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  press();
});
musicBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  toggleMusic();
});
