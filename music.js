// Procedural techno: kick, hats, clap, acid bass and stabs. Layers and tempo build up with the level.
const Techno = (() => {
  // Basslines in semitones from the root; null = rest. A random one is also generated per game.
  const PATTERNS = [
    [0, null, 12, 0, null, 3, 0, 12, 0, null, 10, 0, 7, null, 12, 3],
    [null, 0, 12, 0, null, 0, 12, 0, null, 0, 12, 0, null, 0, 10, 0],
    [0, 0, 12, 0, 0, 0, 10, 0, 0, 0, 12, 0, 7, 0, 5, 3],
    [
      0,
      null,
      null,
      0,
      null,
      null,
      0,
      null,
      null,
      0,
      null,
      null,
      12,
      null,
      10,
      null,
    ],
    [0, 12, null, 0, 15, null, 0, 12, null, 0, 10, null, 7, 12, null, 3],
  ];
  const STABS = [
    [2, 7, 10],
    [3, 6, 11, 14],
    [0, 6, 12],
    [2, 5, 10, 13],
  ];
  // E1, F1, G1, A1, Bb1, C2
  const ROOTS = [41.2, 43.65, 49, 55, 58.27, 65.41];
  const VOLUME = 0.3;
  let bassPat, accentPat, stabSteps, root;
  let ac, out, noise;
  let timerId = null,
    wanted = false,
    step = 0,
    nextTime = 0;
  let bpm = 126,
    intensity = 0,
    muted = false;
  const kicks = [];

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function generatePattern() {
    const notes = [0, 0, 0, 12, 3, 7, 10, 5, 15];
    return Array.from({ length: 16 }, (_, i) =>
      i === 0 ? 0 : Math.random() < 0.25 ? null : pick(notes),
    );
  }

  function randomize() {
    bassPat = Math.random() < 0.35 ? generatePattern() : pick(PATTERNS);
    accentPat = bassPat.map(() => (Math.random() < 0.4 ? 1 : 0));
    stabSteps = pick(STABS);
    root = pick(ROOTS);
  }

  function init(audioCtx) {
    if (ac) return;
    ac = audioCtx;
    const comp = ac.createDynamicsCompressor();
    out = ac.createGain();
    out.gain.value = muted ? 0 : VOLUME;
    out.connect(comp).connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function env(t, peak, decay) {
    const g = ac.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    g.connect(out);
    return g;
  }

  function kick(t) {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(env(t, 1, 0.4));
    o.start(t);
    o.stop(t + 0.4);
    kicks.push(t);
    if (kicks.length > 8) kicks.shift();
  }

  function noiseHit(t, type, freq, peak, decay, q = 1) {
    const src = ac.createBufferSource();
    const f = ac.createBiquadFilter();
    src.buffer = noise;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f).connect(env(t, peak, decay));
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay);
  }

  function bass(t, semi, accent, len) {
    const o = ac.createOscillator();
    const f = ac.createBiquadFilter();
    o.type = "sawtooth";
    o.frequency.value = root * 2 ** (semi / 12);
    f.type = "lowpass";
    f.Q.value = 14;
    f.frequency.setValueAtTime(400 + intensity * 2200 + accent * 1200, t);
    f.frequency.exponentialRampToValueAtTime(110, t + len);
    o.connect(f).connect(env(t, accent ? 0.45 : 0.3, len));
    o.start(t);
    o.stop(t + len);
  }

  function stab(t) {
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2400;
    f.connect(env(t, 0.08, 0.18));
    for (const s of [12, 15, 19, 24]) {
      const o = ac.createOscillator();
      o.type = "square";
      o.frequency.value = root * 2 * 2 ** (s / 12);
      o.connect(f);
      o.start(t);
      o.stop(t + 0.18);
    }
  }

  function play(s, t) {
    const len = 60 / bpm / 4;
    if (s % 4 === 0) kick(t);
    if (s % 4 === 2) noiseHit(t, "highpass", 7000, 0.35, 0.12);
    else if (intensity >= 0.4) noiseHit(t, "highpass", 9000, 0.12, 0.03);
    if (intensity >= 0.2 && (s === 4 || s === 12))
      noiseHit(t, "bandpass", 1400, 0.9, 0.16, 0.8);
    if (bassPat[s] !== null) bass(t, bassPat[s], accentPat[s], len * 0.9);
    if (intensity >= 0.6 && stabSteps.includes(s)) stab(t);
  }

  function tick() {
    while (nextTime < ac.currentTime + 0.12) {
      play(step, nextTime);
      nextTime += 60 / bpm / 4;
      step = (step + 1) % 16;
    }
  }

  return {
    init(audioCtx) {
      init(audioCtx);
      if (wanted) this.start();
    },
    // May be called before init; playback then begins as soon as audio is unlocked.
    start() {
      wanted = true;
      if (!ac || timerId) return;
      randomize();
      step = 0;
      nextTime = ac.currentTime + 0.05;
      timerId = setInterval(tick, 25);
    },
    stop() {
      wanted = false;
      clearInterval(timerId);
      timerId = null;
    },
    setLevel(level, total) {
      intensity = level / total;
      bpm = 126 + 24 * intensity;
    },
    toggleMute() {
      muted = !muted;
      if (out)
        out.gain.setTargetAtTime(muted ? 0 : VOLUME, ac.currentTime, 0.02);
      return muted;
    },
    // 0..1, peaks on every kick; handy for visuals.
    pulse() {
      if (!ac || !timerId || muted) return 0;
      const now = ac.currentTime;
      let k = -1;
      for (const t of kicks) if (t <= now) k = t;
      return k < 0 ? 0 : Math.exp(-(now - k) * 10);
    },
  };
})();
