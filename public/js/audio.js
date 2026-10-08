/* =========================================================
 * 霓虹装甲 · 音频引擎
 * 全部音效与背景音乐均由 WebAudio 程序化合成，零音频文件。
 * ========================================================= */
(function () {
  'use strict';

  var LS_KEY = 'neonTankArena.audio.v1';

  var A = {
    ready: false,
    musicOn: true,
    sfxOn: true,
    unlock: unlock,
    setMusic: setMusic,
    setSfx: setSfx,
    // 音效接口
    uiClick: uiClick,
    shot: shot,
    enemyShot: enemyShot,
    explosion: explosion,
    armorHit: armorHit,
    playerHit: playerHit,
    reloadClick: reloadClick,
    pickup: pickup,
    waveHorn: waveHorn,
    gameOver: gameOverSting,
    record: recordJingle,
    setEngine: setEngine
  };

  // 读取持久化开关
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (typeof saved.music === 'boolean') A.musicOn = saved.music;
    if (typeof saved.sfx === 'boolean') A.sfxOn = saved.sfx;
  } catch (e) { /* ignore */ }

  var ctx = null, master = null, sfxBus = null, musicBus = null;
  var noiseBuf = null;
  var engOsc1 = null, engOsc2 = null, engGain = null, engFilter = null;

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ music: A.musicOn, sfx: A.sfxOn })); } catch (e) { /* ignore */ }
  }

  function unlock() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = A.sfxOn ? 1 : 0; sfxBus.connect(master);
      musicBus = ctx.createGain(); musicBus.gain.value = A.musicOn ? 0.42 : 0; musicBus.connect(master);

      // 共享噪声缓冲
      var len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      initEngine();
      startScheduler();
      A.ready = true;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) { ctx.suspend(); }
    else { ctx.resume(); }
  });

  function setMusic(on) {
    A.musicOn = on; save();
    if (ctx) {
      musicBus.gain.setTargetAtTime(on ? 0.42 : 0, ctx.currentTime, 0.06);
      if (on) resetScheduleCursor();
    }
  }
  function setSfx(on) {
    A.sfxOn = on; save();
    if (ctx) sfxBus.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.03);
  }

  /* ---------------- 基础合成工具 ---------------- */

  function osc(bus, type, f0, f1, t0, dur, peak, curve) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + (curve && curve.a ? curve.a : 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(bus, t0, dur, peak, filterType, freq0, freq1, q, attack) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    var f = ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.setValueAtTime(freq0 || 1000, t0);
    if (freq1) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq1), t0 + dur);
    f.Q.value = q || 0.8;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + (attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  function now() { return ctx.currentTime; }
  function sfxOk() { return !!ctx && A.sfxOn; }

  /* ---------------- 具体音效 ---------------- */

  function uiClick() {
    if (!sfxOk()) return;
    var t = now();
    noise(sfxBus, t, 0.03, 0.18, 'highpass', 1600, null, 1);
    osc(sfxBus, 'sine', 1180, 900, t, 0.05, 0.12);
  }

  function shot() {
    if (!sfxOk()) return;
    var t = now();
    osc(sfxBus, 'square', 155, 44, t, 0.17, 0.42);
    noise(sfxBus, t, 0.08, 0.5, 'highpass', 850, null, 0.7);
    noise(sfxBus, t, 0.24, 0.45, 'lowpass', 420, 120, 0.6);
    osc(sfxBus, 'sine', 68, 34, t, 0.22, 0.5);
  }

  function enemyShot(vol) {
    if (!sfxOk()) return;
    var v = Math.max(0.05, Math.min(1, vol || 0.5));
    var t = now();
    osc(sfxBus, 'square', 120, 38, t, 0.18, 0.3 * v);
    noise(sfxBus, t, 0.2, 0.32 * v, 'lowpass', 500, 130, 0.7);
  }

  function explosion(size, vol) {
    if (!sfxOk()) return;
    var s = Math.max(0.3, Math.min(2, size || 1));
    var v = Math.max(0.05, Math.min(1, vol == null ? 1 : vol));
    var t = now();
    noise(sfxBus, t, 0.4 + 0.35 * s, 0.85 * v, 'lowpass', 1300, 140, 0.5, 0.004);
    osc(sfxBus, 'sine', 105, 26, t, 0.45 + 0.25 * s, 0.8 * v);
    noise(sfxBus, t + 0.03, 0.15, 0.4 * v, 'bandpass', 2400, 900, 1.2);
    // 余烬碎响
    for (var i = 0; i < 3; i++) {
      noise(sfxBus, t + 0.1 + Math.random() * 0.3 * s, 0.05, 0.14 * v, 'highpass', 1500, null, 1);
    }
  }

  function armorHit(vol) {
    if (!sfxOk()) return;
    var v = Math.max(0.1, Math.min(1, vol == null ? 1 : vol));
    var t = now();
    osc(sfxBus, 'triangle', 660, 520, t, 0.1, 0.3 * v);
    osc(sfxBus, 'triangle', 990, 760, t, 0.07, 0.22 * v);
    noise(sfxBus, t, 0.035, 0.28 * v, 'highpass', 3000, null, 1);
  }

  function playerHit() {
    if (!sfxOk()) return;
    var t = now();
    osc(sfxBus, 'sine', 90, 44, t, 0.28, 0.62);
    noise(sfxBus, t, 0.18, 0.4, 'lowpass', 480, 150, 0.7);
    osc(sfxBus, 'triangle', 220, 140, t, 0.12, 0.2);
  }

  function reloadClick() {
    if (!sfxOk()) return;
    var t = now();
    noise(sfxBus, t, 0.02, 0.22, 'highpass', 2400, null, 1);
    noise(sfxBus, t + 0.07, 0.025, 0.26, 'highpass', 2000, null, 1);
    osc(sfxBus, 'square', 840, 840, t + 0.07, 0.04, 0.08);
  }

  function pickup() {
    if (!sfxOk()) return;
    var t = now();
    osc(sfxBus, 'sine', 660, 660, t, 0.09, 0.3);
    osc(sfxBus, 'sine', 990, 990, t + 0.08, 0.14, 0.3);
    osc(sfxBus, 'triangle', 1320, 1320, t + 0.08, 0.1, 0.12);
  }

  function waveHorn() {
    if (!sfxOk()) return;
    var t = now();
    [110, 165, 220].forEach(function (f, i) {
      var o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = f * (i === 2 ? 1.003 : 1);
      fl.type = 'lowpass';
      fl.frequency.setValueAtTime(400, t);
      fl.frequency.linearRampToValueAtTime(1400, t + 0.25);
      fl.frequency.linearRampToValueAtTime(500, t + 0.9);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.1);
      g.gain.setValueAtTime(0.16, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      o.connect(fl); fl.connect(g); g.connect(sfxBus);
      o.start(t); o.stop(t + 1.05);
    });
    osc(sfxBus, 'sine', 55, 55, t, 0.5, 0.35);
  }

  function gameOverSting() {
    if (!sfxOk()) return;
    var t = now();
    osc(sfxBus, 'sawtooth', 220, 52, t, 1.3, 0.25, { a: 0.05 });
    osc(sfxBus, 'sine', 110, 30, t, 1.2, 0.4, { a: 0.05 });
    noise(sfxBus, t, 0.9, 0.3, 'lowpass', 800, 90, 0.7, 0.02);
  }

  function recordJingle() {
    if (!sfxOk()) return;
    var t = now();
    [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
      osc(sfxBus, 'sine', f, f, t + i * 0.09, 0.22, 0.22);
      osc(sfxBus, 'triangle', f * 2, f * 2, t + i * 0.09, 0.12, 0.06);
    });
  }

  /* ---------------- 坦克引擎声（持续） ---------------- */

  function initEngine() {
    engOsc1 = ctx.createOscillator(); engOsc1.type = 'sawtooth'; engOsc1.frequency.value = 42;
    engOsc2 = ctx.createOscillator(); engOsc2.type = 'sawtooth'; engOsc2.frequency.value = 43.7;
    engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 220; engFilter.Q.value = 0.6;
    engGain = ctx.createGain(); engGain.gain.value = 0;
    engOsc1.connect(engFilter); engOsc2.connect(engFilter);
    engFilter.connect(engGain); engGain.connect(sfxBus);
    engOsc1.start(); engOsc2.start();
  }

  // ratio: 0（怠速/停）~ 1（全速）；<0 表示完全静音（如菜单/死亡）
  function setEngine(ratio) {
    if (!ctx || !engGain) return;
    var t = ctx.currentTime;
    if (ratio < 0 || !A.sfxOn) {
      engGain.gain.setTargetAtTime(0, t, 0.1);
      return;
    }
    var r = Math.min(1, ratio);
    engGain.gain.setTargetAtTime(0.03 + 0.1 * r, t, 0.12);
    engOsc1.frequency.setTargetAtTime(40 + 55 * r, t, 0.15);
    engOsc2.frequency.setTargetAtTime(41.6 + 57 * r, t, 0.15);
    engFilter.frequency.setTargetAtTime(200 + 380 * r, t, 0.15);
  }

  /* ---------------- 背景音乐（暗色合成波循环） ---------------- */

  var BPM = 106;
  var STEP = 60 / BPM / 4;            // 16 分音符
  var current16th = 0;
  var nextTime = 0;
  var schedTimer = null;

  // 和弦进行：Am — F — C — G（每和弦 2 小节，共 8 小节循环）
  var CHORDS = [
    { root: 55.0,  tones: [110.0, 130.81, 164.81] },  // Am
    { root: 43.65, tones: [87.31, 110.0, 130.81] },   // F
    { root: 65.41, tones: [130.81, 164.81, 196.0] },  // C
    { root: 49.0,  tones: [98.0, 123.47, 146.83] }    // G
  ];
  var BASS_STEPS = [0, 3, 6, 8, 11, 14];
  var ARP_SEQ = [0, 1, 2, 1, 0, 2, 1, 2];

  function startScheduler() {
    resetScheduleCursor();
    schedTimer = setInterval(function () {
      if (!ctx || ctx.state !== 'running' || !A.musicOn) return;
      var horizon = ctx.currentTime + 0.2;
      var guard = 0;
      while (nextTime < horizon && guard++ < 64) {
        scheduleStep(current16th, nextTime);
        nextTime += STEP;
        current16th++;
      }
    }, 40);
  }

  function resetScheduleCursor() {
    if (!ctx) return;
    nextTime = ctx.currentTime + 0.08;
    // 从小节开头继续，避免半拍切入
    current16th = Math.ceil(current16th / 16) * 16;
  }

  function scheduleStep(step16, t) {
    var stepInBar = step16 % 16;
    var bar = Math.floor(step16 / 16) % 8;
    var chord = CHORDS[Math.floor(bar / 2)];

    // 底鼓
    if (stepInBar % 4 === 0) {
      osc(musicBus, 'sine', 130, 42, t, 0.14, 0.5);
    }
    // 军鼓（轻）
    if (stepInBar === 4 || stepInBar === 12) {
      noise(musicBus, t, 0.09, 0.14, 'bandpass', 1900, null, 1.1);
    }
    // 踩镲
    if (stepInBar % 2 === 0) {
      noise(musicBus, t, 0.03, stepInBar % 4 === 2 ? 0.075 : 0.045, 'highpass', 6200, null, 1);
    }
    // 贝斯
    if (BASS_STEPS.indexOf(stepInBar) !== -1) {
      var oct = (stepInBar === 8 && bar % 2 === 1) ? 2 : 1;
      osc(musicBus, 'triangle', chord.root * oct, chord.root * oct, t, 0.22, 0.34);
      osc(musicBus, 'square', chord.root * oct, chord.root * oct, t, 0.12, 0.07);
    }
    // 琶音点缀
    if (stepInBar % 2 === 0 && (bar % 2 === 0 || stepInBar % 4 === 0)) {
      var idx = ARP_SEQ[(step16 / 2) % ARP_SEQ.length | 0];
      var f = chord.tones[idx] * 2;
      osc(musicBus, 'sine', f, f, t, 0.16, 0.055);
    }
    // 长音和弦垫（每 2 小节触发一次）
    if (stepInBar === 0 && bar % 2 === 0) {
      padChord(chord, t);
    }
  }

  function padChord(chord, t) {
    var dur = STEP * 32;
    chord.tones.forEach(function (f) {
      [0.9985, 1.0015].forEach(function (det) {
        var o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = f * det;
        fl.type = 'lowpass'; fl.Q.value = 0.5;
        fl.frequency.setValueAtTime(420, t);
        fl.frequency.linearRampToValueAtTime(900, t + dur * 0.5);
        fl.frequency.linearRampToValueAtTime(420, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 1.1);
        g.gain.setValueAtTime(0.05, t + dur - 1.4);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(fl); fl.connect(g); g.connect(musicBus);
        o.start(t); o.stop(t + dur + 0.1);
      });
    });
  }

  window.AudioSys = A;
})();
