// Sonido procedural (WebAudio): retumbo de la columna, explosiones, rugido de lahares, viento.
// La intensidad depende de la distancia de la cámara a cada fuente (retardo y atenuación).
export class Sound {
  constructor() { this.ctx = null; this.on = false; }
  enable() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return false;
      const ctx = this.ctx = new C();
      const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      const src = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 3); return s; };
      this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
      const chain = (type, f, q) => { const s = src(), fl = ctx.createBiquadFilter(), g = ctx.createGain(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.master); return g; };
      this.rumble = chain('lowpass', 70, 0.7);
      this.roar = chain('bandpass', 320, 0.6);
      this.wind = chain('bandpass', 900, 0.4);
      this.hiss = chain('highpass', 2500, 0.5);
    }
    this.ctx.resume(); this.on = true; return true;
  }
  disable() { if (this.ctx) this.ctx.suspend(); this.on = false; }
  boom(intensity, dist) {
    if (!this.on) return; const ctx = this.ctx, t = ctx.currentTime + Math.min(8, dist / 0.34) * 0.15;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    const a = Math.min(1, intensity) / (1 + dist * 0.25);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * a + 1e-4, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.7);
  }
  update(s) {
    if (!this.on) return; const t = this.ctx.currentTime, k = 0.4;
    const set = (g, v) => g.gain.setTargetAtTime(v, t, k);
    set(this.rumble, Math.min(1.2, s.mer > 50 ? (Math.log10(s.mer) - 3) * 0.22 : 0) / (1 + s.dVent * 0.12));
    set(this.roar, Math.min(1, s.mud / (1 + s.dMud * 1.5)) * 0.8);
    set(this.hiss, Math.min(0.4, s.lava / (1 + s.dLava * 2)) * 0.5);
    set(this.wind, 0.05 + Math.min(0.15, s.alt / 30000));
  }
}
