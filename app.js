/* PedalEight — eight-bar pedal point. Audio-clock desk. Samples pinned to commit SHAs. */
const PIANO = "https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples";
const GM = "https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@044fab8e1456bfafc5776e86dfd6bb8697149aef/FluidR3_GM";
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const SR = 48000;
const NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const CHAIRS = ["piano", "bass", "cello", "flute", "kit"];

const SAMPLE_NOTES = {
  piano: ["C3", "E3", "G3", "A3", "C4", "E4", "G4", "A4", "C5", "E5"],
  bass: ["E1", "G1", "A1", "C2", "E2", "G2", "A2", "C3", "E3"],
  cello: ["C2", "E2", "G2", "A2", "C3", "E3", "G3", "A3", "C4"],
  flute: ["C4", "E4", "G4", "A4", "C5", "E5", "G5", "A5", "C6"]
};

const RECIPES = [
  { id: "tonic-hold", name: "Tonic hold", blurb: "Upright and cello hold the key root. Piano changes. Flute answers the third." },
  { id: "fifth-pedal", name: "Fifth pedal", blurb: "Dominant pedal under moving chords. The section leans forward without a riser." },
  { id: "cello-swell", name: "Cello swell", blurb: "A real attack ramp inside each held cello bar. Bass pulses the pedal on 1 and 3." },
  { id: "flute-over", name: "Flute over", blurb: "Flute moves in quarters. Bass holds. Piano stabs once a bar." },
  { id: "late-walk", name: "Late walk", blurb: "Pedal for six bars. Bars 7–8 the upright finally walks the changes." },
  { id: "octave-bed", name: "Octave bed", blurb: "Bass and cello an octave apart on the pedal. Kit only on 2 and 4." }
];

const state = {
  bpm: 92,
  key: "A minor",
  chords: "Am F C G",
  bars: 8,
  side: "B",
  recipe: "tonic-hold",
  mutes: { piano: false, bass: false, cello: false, flute: false, kit: false }
};

let ctx = null;
let chairGain = {};
let buffers = {};
let raw = {};
let missing = [];
let timerId = null;
let nextStepTime = 0;
let step = 0;
let anchorTime = 0;
let anchorStep = 0;
let raf = 0;
let active = [];

const $ = (id) => document.getElementById(id);

function midiOf(name) {
  const m = name.match(/^([A-G]b?)(-?\d)$/);
  return NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12;
}

function parseChord(token) {
  const t = token.trim();
  const m = t.match(/^([A-G]b?)(.*)$/);
  if (!m) return { root: 0, minor: false, label: "C" };
  const root = NAMES.indexOf(m[1]);
  const minor = /m/.test(m[2]) && !/maj/i.test(m[2]);
  return { root: root < 0 ? 0 : root, minor, label: t };
}

function keyRoot() {
  const m = state.key.match(/^([A-G]b?)/);
  return NAMES.indexOf(m ? m[1] : "A");
}

function progression() {
  return state.chords.split(/\s+/).filter(Boolean).map(parseChord);
}

function chordAt(barIndex) {
  const p = progression();
  return p[barIndex % p.length] || { root: 0, minor: false, label: "C" };
}

function third(ch, base) {
  return base + (ch.minor ? 3 : 4);
}

function nearest(chair, midi) {
  const list = SAMPLE_NOTES[chair];
  let best = list[0];
  let bestD = 99;
  for (const n of list) {
    const d = Math.abs(midiOf(n) - midi);
    if (d < bestD) { bestD = d; best = n; }
  }
  const sampleMidi = midiOf(best);
  let target = midi;
  if (target - sampleMidi > 4) target = sampleMidi + 4;
  if (sampleMidi - target > 4) target = sampleMidi - 4;
  return { key: chair + ":" + best, rate: Math.pow(2, (target - sampleMidi) / 12), midi: target };
}

function recipeMeta() {
  return RECIPES.find((r) => r.id === state.recipe) || RECIPES[0];
}

function eventsFor(local) {
  const events = [];
  const stepDur = 60 / local.bpm / 4;
  const kr = keyRoot();
  const add = (chair, midi, stepIndex, durSteps, gain, swell) => {
    if (local.mutes[chair]) return;
    events.push({
      chair,
      midi,
      time: stepIndex * stepDur,
      dur: durSteps * stepDur,
      gain,
      swell: !!swell,
      step: stepIndex
    });
  };
  for (let bar = 0; bar < local.bars; bar++) {
    const ch = chordAt(bar);
    const root = 48 + ((ch.root - kr + 12) % 12) + kr;
    const b0 = bar * 16;
    const pedal = 36 + kr;
    const fifth = pedal + 7;
    if (local.side !== "B") {
      add("piano", root, b0, 8, 0.2, false);
      add("piano", third(ch, root), b0, 8, 0.15, false);
      add("piano", root + 7, b0, 8, 0.12, false);
      add("piano", root, b0 + 8, 8, 0.16, false);
      add("bass", root - 24, b0, 8, 0.32, false);
      add("bass", root - 24 + 7 > 45 ? root - 17 : root - 24, b0 + 8, 8, 0.26, false);
      add("cello", root - 12, b0, 16, 0.16, false);
      add("flute", third(ch, root) + 12, b0 + 4, 4, 0.12, false);
      add("flute", root + 12, b0 + 12, 4, 0.1, false);
      add("kit", 36, b0, 2, 0.42, false);
      add("kit", 38, b0 + 4, 2, 0.32, false);
      add("kit", 36, b0 + 8, 2, 0.36, false);
      add("kit", 38, b0 + 12, 2, 0.32, false);
      for (let s = 0; s < 16; s += 2) add("kit", 42, b0 + s, 1, 0.12, false);
      continue;
    }
    const rec = local.recipe;
    const tone = rec === "fifth-pedal" ? fifth : pedal;
    if (rec === "late-walk" && bar >= 6) {
      add("bass", root - 24, b0, 4, 0.3, false);
      add("bass", third(ch, root) - 24, b0 + 4, 4, 0.24, false);
      add("bass", root - 17, b0 + 8, 4, 0.24, false);
      add("bass", root - 24, b0 + 12, 4, 0.28, false);
      add("cello", tone + 12, b0, 16, 0.14, true);
    } else if (rec === "cello-swell") {
      add("cello", tone + 12, b0, 16, 0.26, true);
      add("bass", tone, b0, 4, 0.28, false);
      add("bass", tone, b0 + 8, 4, 0.24, false);
    } else if (rec === "octave-bed") {
      add("bass", tone, b0, 16, 0.3, false);
      add("cello", tone + 12, b0, 16, 0.2, true);
    } else {
      add("bass", tone, b0, 16, 0.3, false);
      add("cello", tone + 12, b0, 16, 0.18, rec === "tonic-hold");
    }
    if (rec === "flute-over") {
      add("piano", root + 12, b0, 2, 0.14, false);
      add("flute", third(ch, root) + 12, b0, 4, 0.16, false);
      add("flute", root + 12, b0 + 4, 4, 0.14, false);
      add("flute", root + 7 + 12, b0 + 8, 4, 0.14, false);
      add("flute", third(ch, root) + 12, b0 + 12, 4, 0.12, false);
    } else if (rec === "octave-bed") {
      add("piano", root, b0 + 8, 4, 0.12, false);
    } else {
      add("piano", root, b0, 6, 0.16, false);
      add("piano", third(ch, root), b0, 6, 0.12, false);
      add("piano", root + 7, b0 + 8, 6, 0.12, false);
      add("flute", third(ch, root) + 12, b0 + 8, 6, 0.12, false);
    }
    if (rec === "octave-bed") {
      add("kit", 38, b0 + 4, 2, 0.28, false);
      add("kit", 38, b0 + 12, 2, 0.28, false);
    } else {
      add("kit", 36, b0, 2, 0.34, false);
      add("kit", 38, b0 + 8, 2, 0.26, false);
      if (bar % 2 === 0) add("kit", 42, b0 + 4, 1, 0.1, false);
    }
  }
  return events;
}

function track(node, audioCtx) {
  if (audioCtx !== ctx) return;
  active.push(node);
  node.onended = () => { active = active.filter((n) => n !== node); };
}

function playNote(audioCtx, when, ev, dest, bag) {
  if (ev.chair === "kit") {
    const map = { 36: "kit:kick", 38: "kit:snare", 42: "kit:hat" };
    const buf = bag[map[ev.midi] || "kit:kick"];
    if (!buf) return;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(Math.max(0.04, ev.gain), when);
    const rel = Math.max(0.05, Math.min(ev.dur, 0.35));
    g.gain.linearRampToValueAtTime(0.0001, when + rel);
    src.connect(g);
    g.connect(dest);
    src.start(when);
    src.stop(when + rel + 0.02);
    track(src, audioCtx);
    return;
  }
  const pick = nearest(ev.chair, ev.midi);
  const buf = bag[pick.key];
  if (!buf) return;
  const hold = Math.max(0.2, ev.dur);
  const slice = 0.48;
  const n = Math.max(1, Math.ceil(hold / (slice * 0.82)));
  for (let i = 0; i < n; i++) {
    const t = when + i * slice * 0.82;
    if (t >= when + hold) break;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(pick.rate, t);
    const g = audioCtx.createGain();
    const attack = ev.swell && i === 0 ? Math.min(1.4, hold * 0.45) : 0.01;
    const peak = ev.swell ? ev.gain * (0.35 + 0.65 * ((i + 1) / n)) : ev.gain;
    const onset = i === 0 ? Math.max(0.03, peak * 0.35) : Math.max(0.02, peak * 0.45);
    g.gain.setValueAtTime(onset, t);
    g.gain.linearRampToValueAtTime(Math.max(onset, peak), t + attack);
    const end = Math.min(when + hold, t + slice);
    g.gain.setValueAtTime(Math.max(0.001, peak * 0.85), Math.max(t + attack + 0.01, end - 0.012));
    g.gain.linearRampToValueAtTime(0.0001, end + 0.012);
    src.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(end + 0.03);
    track(src, audioCtx);
  }
}

function scheduleStep(stepIndex, when) {
  const total = state.bars * 16;
  const s = stepIndex % total;
  const local = {
    bpm: state.bpm,
    side: state.side,
    recipe: state.recipe,
    bars: state.bars,
    mutes: state.mutes,
    chords: state.chords,
    key: state.key
  };
  eventsFor(local).forEach((e) => {
    if (e.step === s) playNote(ctx, when, e, chairGain[e.chair], buffers);
  });
}

function scheduler() {
  if (!ctx) return;
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(step, nextStepTime);
    const stepDur = 60 / state.bpm / 4;
    nextStepTime += stepDur;
    step = (step + 1) % (state.bars * 16);
  }
}

function stopAll() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  active.forEach((n) => { try { n.stop(0); } catch (e) { /* ended */ } });
  active = [];
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  document.querySelectorAll(".bar").forEach((el) => el.classList.remove("now"));
}

function paintHead() {
  if (!ctx || !timerId) return;
  const stepDur = 60 / state.bpm / 4;
  const elapsed = ctx.currentTime - anchorTime;
  const pos = anchorStep + elapsed / stepDur;
  const s = ((Math.floor(pos) % (state.bars * 16)) + state.bars * 16) % (state.bars * 16);
  const bar = Math.floor(s / 16);
  document.querySelectorAll(".bar").forEach((el, i) => el.classList.toggle("now", i === bar));
}

function start() {
  if (!ctx || missing.length) return;
  if (ctx.state === "suspended") ctx.resume();
  stopAll();
  nextStepTime = ctx.currentTime + 0.1;
  step = 0;
  anchorTime = nextStepTime;
  anchorStep = 0;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  const loop = () => {
    if (!timerId) return;
    paintHead();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function wireBus(audioCtx, dest) {
  const comp = audioCtx.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.knee.value = 6;
  comp.ratio.value = 12;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  const out = audioCtx.createGain();
  out.gain.value = 0.72;
  comp.connect(out);
  out.connect(dest);
  const gains = {};
  CHAIRS.forEach((c) => {
    const g = audioCtx.createGain();
    g.gain.value = 0.9;
    g.connect(comp);
    gains[c] = g;
  });
  return gains;
}

function sampleUrl(chair, note) {
  if (chair === "piano" || chair === "bass") return PIANO + "/" + chair + "/" + note + ".mp3";
  if (chair === "cello") return GM + "/cello-mp3/" + note + ".mp3";
  if (chair === "flute") return GM + "/flute-mp3/" + note + ".mp3";
  return "";
}

async function loadSamples() {
  missing = [];
  const files = [];
  Object.keys(SAMPLE_NOTES).forEach((chair) => {
    SAMPLE_NOTES[chair].forEach((n) => files.push([chair + ":" + n, chair, sampleUrl(chair, n)]));
  });
  [
    ["kit:kick", "kit", PIANO + "/drums/kick.mp3"],
    ["kit:snare", "kit", PIANO + "/drums/snare.mp3"],
    ["kit:hat", "kit", PIANO + "/drums/hihat.mp3"]
  ].forEach((f) => files.push(f));
  let done = 0;
  for (const [key, chair, url] of files) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      const ab = await r.arrayBuffer();
      raw[key] = ab;
      buffers[key] = await ctx.decodeAudioData(ab.slice(0));
    } catch (e) {
      missing.push(chair + " (" + key + ")");
    }
    done += 1;
    $("status").textContent = "Seating chairs " + done + "/" + files.length;
  }
  if (missing.length) {
    const uniq = [...new Set(missing.map((m) => m.split(" ")[0]))];
    $("status").textContent = "Missing instruments: " + uniq.join(", ") + " — " + missing.join("; ");
    return;
  }
  $("status").textContent = "Chairs seated · FluidR3 pinned · " + files.length + " samples";
}

function readForm() {
  state.bpm = Math.max(60, Math.min(180, Number($("bpm").value) || 92));
  state.key = $("key").value;
  state.chords = $("chords").value.trim() || "Am F C G";
  state.bars = Math.max(4, Math.min(16, Number($("bars").value) || 8));
  localStorage.setItem("pedaleight-v1", JSON.stringify(state));
  paintBars();
  punch();
}

function paintBars() {
  const host = $("barsView");
  host.innerHTML = "";
  host.style.gridTemplateColumns = "repeat(" + state.bars + ", 1fr)";
  for (let i = 0; i < state.bars; i++) {
    const ch = chordAt(i);
    const el = document.createElement("div");
    const held = state.side === "B" && !(state.recipe === "late-walk" && i >= 6);
    el.className = "bar" + (held ? " hold" : "");
    el.innerHTML = "<b>" + (i + 1) + "</b>" + ch.label + (held ? " · pedal" : " · moves");
    host.appendChild(el);
  }
  $("blurb").textContent = state.side === "A"
    ? "Print. Every chair follows the chord. This is the loop that will not sit."
    : recipeMeta().blurb;
}

function punch() {
  const lines = [
    "PedalEight · " + (state.side === "A" ? "print" : recipeMeta().name),
    state.bpm + " bpm · " + state.key + " · " + state.chords,
    state.side === "A" ? "Do not export the print as the pedal." : "Drop these " + state.bars + " bars where the section needs gravity.",
    "Bass and cello hold. Piano and flute move. Chorus starts the bar after this file ends."
  ];
  $("punch").textContent = lines.join("\n");
}

function fileBase() {
  const key = state.key.replace(/\s+/g, "");
  const rec = state.side === "A" ? "print" : state.recipe;
  return "pedaleight-" + rec + "-" + state.bpm + "bpm-" + key;
}

function write24(view, offset, sample) {
  let v = Math.max(-8388608, Math.min(8388607, Math.round(sample * 8388607)));
  if (v < 0) v += 0x1000000;
  view.setUint8(offset, v & 255);
  view.setUint8(offset + 1, (v >> 8) & 255);
  view.setUint8(offset + 2, (v >> 16) & 255);
}

function encodeWav(floatL, floatR, withTail) {
  const n = floatL.length;
  const block = 6;
  const buf = new ArrayBuffer(44 + n * block);
  const v = new DataView(buf);
  const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + n * block, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * block, true);
  v.setUint16(32, block, true);
  v.setUint16(34, 24, true);
  writeStr(36, "data");
  v.setUint32(40, n * block, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    write24(v, o, floatL[i]);
    write24(v, o + 3, floatR[i]);
    o += 6;
  }
  const blob = new Blob([buf], { type: "audio/wav" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileBase() + (withTail ? "-with-tail" : "") + ".wav";
  a.click();
  return n;
}

async function exportWav(withTail) {
  if (missing.length) return;
  readForm();
  const bars = state.bars;
  const length = Math.round(bars * 4 * 60 / state.bpm * SR);
  const tailSec = 1.6;
  const offline = new OfflineAudioContext(2, length + Math.round(tailSec * SR), SR);
  const gains = wireBus(offline, offline.destination);
  const decoded = {};
  for (const k of Object.keys(raw)) decoded[k] = await offline.decodeAudioData(raw[k].slice(0));
  const local = {
    bpm: state.bpm,
    side: state.side,
    recipe: state.recipe,
    bars,
    mutes: { ...state.mutes },
    chords: state.chords,
    key: state.key
  };
  const saved = active;
  active = [];
  eventsFor(local).forEach((e) => playNote(offline, e.time, e, gains[e.chair], decoded));
  active = saved;
  const rendered = await offline.startRendering();
  const l = rendered.getChannelData(0);
  const r = rendered.getChannelData(1);
  const loopL = new Float32Array(withTail ? l.length : length);
  const loopR = new Float32Array(withTail ? r.length : length);
  const n = loopL.length;
  for (let i = 0; i < Math.min(n, l.length); i++) { loopL[i] = l[i]; loopR[i] = r[i]; }
  if (!withTail) {
    for (let i = length; i < l.length; i++) {
      const j = i - length;
      if (j < length) { loopL[j] += l[i]; loopR[j] += r[i]; }
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(loopL[i]), Math.abs(loopR[i]));
  const target = Math.pow(10, -1 / 20);
  const g = peak > target ? target / peak : 1;
  for (let i = 0; i < n; i++) { loopL[i] *= g; loopR[i] *= g; }
  const written = encodeWav(loopL, loopR, withTail);
  $("status").textContent = "WAV " + written + " samples · expected " + length + (withTail ? " plus tail" : "");
}

function vlq(n) {
  let v = n;
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function exportMidi() {
  readForm();
  const local = {
    bpm: state.bpm,
    side: state.side,
    recipe: state.recipe,
    bars: state.bars,
    mutes: { ...state.mutes },
    chords: state.chords,
    key: state.key
  };
  const evs = eventsFor(local);
  const ppq = 480;
  const tracks = CHAIRS.map((chair) => {
    const notes = evs.filter((e) => e.chair === chair).map((e) => {
      const midi = e.chair === "kit" ? e.midi : nearest(e.chair, e.midi).midi;
      const start = Math.round(e.time / (60 / local.bpm) * ppq);
      const dur = Math.max(1, Math.round(e.dur / (60 / local.bpm) * ppq));
      return { start, dur, midi, vel: Math.max(1, Math.min(127, Math.round(e.gain * 280))) };
    }).sort((a, b) => a.start - b.start);
    const events = [{ t: 0, b: [0xFF, 0x03].concat([chair.length], Array.from(chair).map((c) => c.charCodeAt(0))) }];
    notes.forEach((n) => {
      events.push({ t: n.start, b: [0x90, n.midi, n.vel] });
      events.push({ t: n.start + n.dur, b: [0x80, n.midi, 0] });
    });
    events.sort((a, b) => a.t - b.t);
    const bytes = [];
    let last = 0;
    events.forEach((e) => {
      vlq(e.t - last).forEach((x) => bytes.push(x));
      e.b.forEach((x) => bytes.push(x));
      last = e.t;
    });
    vlq(0).forEach((x) => bytes.push(x));
    bytes.push(0xFF, 0x2F, 0x00);
    return bytes;
  });
  const us = Math.round(60000000 / local.bpm);
  const header = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, ppq >> 8, ppq & 255];
  const body = [];
  tracks.forEach((t) => {
    const tempo = [0x00, 0xFF, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0x00, 0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08];
    const data = tempo.concat(t);
    body.push(0x4D, 0x54, 0x72, 0x6B);
    const len = data.length;
    body.push((len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255);
    data.forEach((b) => body.push(b));
  });
  const all = new Uint8Array(header.concat(body));
  const blob = new Blob([all], { type: "audio/midi" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileBase() + ".mid";
  a.click();
}

function bind() {
  const rec = $("recipes");
  RECIPES.forEach((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = r.name;
    b.dataset.id = r.id;
    if (r.id === state.recipe) b.classList.add("on");
    b.addEventListener("click", () => {
      state.recipe = r.id;
      state.side = "B";
      rec.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.id === r.id));
      $("sideB").classList.add("on");
      $("sideA").classList.remove("on");
      readForm();
    });
    rec.appendChild(b);
  });
  const mutes = $("mutes");
  CHAIRS.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = c;
    b.addEventListener("click", () => {
      state.mutes[c] = !state.mutes[c];
      b.classList.toggle("on", state.mutes[c]);
      b.textContent = c + (state.mutes[c] ? " muted" : "");
    });
    mutes.appendChild(b);
  });
  ["bpm", "key", "chords", "bars"].forEach((id) => $(id).addEventListener("change", readForm));
  $("sideA").addEventListener("click", () => { state.side = "A"; $("sideA").classList.add("on"); $("sideB").classList.remove("on"); readForm(); });
  $("sideB").addEventListener("click", () => { state.side = "B"; $("sideB").classList.add("on"); $("sideA").classList.remove("on"); readForm(); });
  $("play").addEventListener("click", start);
  $("stop").addEventListener("click", stopAll);
  $("wav").addEventListener("click", () => exportWav(false));
  $("tail").addEventListener("click", () => exportWav(true));
  $("mid").addEventListener("click", exportMidi);
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select")) return;
    if (e.code === "Space") { e.preventDefault(); timerId ? stopAll() : start(); }
    if (e.key === "1") { state.side = "A"; $("sideA").classList.add("on"); $("sideB").classList.remove("on"); readForm(); }
    if (e.key === "2") { state.side = "B"; $("sideB").classList.add("on"); $("sideA").classList.remove("on"); readForm(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stopAll();
  });
}

async function boot() {
  try {
    const saved = JSON.parse(localStorage.getItem("pedaleight-v1") || "null");
    if (saved) Object.assign(state, saved);
  } catch (e) { /* ignore */ }
  $("bpm").value = state.bpm;
  $("key").value = state.key;
  $("chords").value = state.chords;
  $("bars").value = state.bars;
  bind();
  readForm();
  $("tap").addEventListener("click", async () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      chairGain = wireBus(ctx, ctx.destination);
      await loadSamples();
    }
    if (ctx.state !== "running") await ctx.resume();
    $("tap").textContent = ctx.state === "running" ? "Audio running" : "Tap to start audio";
  });
}

boot();
