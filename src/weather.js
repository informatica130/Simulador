// =====================================================================
//  Tiempo atmosférico visible: lluvia (estrías inclinadas por el viento,
//  en varias capas de profundidad), cielo cubierto y suelo mojado.
//  La lluvia física (escorrentía, lahares secundarios, incendios) la
//  calcula el motor; aquí sólo se representa lo que se vería.
// =====================================================================
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const RAIN_FS = /* glsl */`
uniform sampler2D tDiffuse; uniform float uRain; uniform float uTime; uniform vec2 uTilt; uniform float uAspect; uniform vec3 uLight;
varying vec2 vUv;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// una capa de gotas: celdas en pantalla, cada una con una estría que cae y se inclina con el viento
float layer(vec2 uv, float scale, float speed, float len, float seed){
  vec2 p = uv * vec2(scale * uAspect, scale * 0.25);
  p.x += p.y * uTilt.x * 0.25;
  p.y += uTime * speed;
  vec2 c = floor(p), f = fract(p);
  float r = h21(c + seed);
  if (r > 0.18 + 0.6 * clamp(uRain / 25.0, 0.0, 1.0)) return 0.0;
  float x = 0.2 + 0.6 * h21(c + seed + 7.1);
  float y = fract(r * 13.7);
  float w = 0.035 + 0.02 * r;
  float d = abs(f.x - x);
  float s = (1.0 - smoothstep(0.0, w, d)) * smoothstep(y - len, y, f.y) * (1.0 - smoothstep(y, y + 0.02, f.y));
  return s;
}
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  if (uRain <= 0.0) { gl_FragColor = c; return; }
  float k = clamp(uRain / 20.0, 0.0, 1.0);
  float s = layer(vUv, 34.0, 2.6, 0.55, 1.0) * 0.55 + layer(vUv, 60.0, 3.4, 0.45, 9.0) * 0.4 + layer(vUv, 110.0, 4.6, 0.35, 21.0) * 0.28;
  // la lluvia densa vela el paisaje (bruma gris) y las gotas reflejan la luz del cielo
  vec3 haze = uLight * 0.55;
  c.rgb = mix(c.rgb, haze, 0.18 * k);
  c.rgb += uLight * s * (0.35 + 0.4 * k);
  gl_FragColor = c;
}`;

export class RainPass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    this.U = { tDiffuse: { value: null }, uRain: { value: 0 }, uTime: { value: 0 }, uTilt: { value: new THREE.Vector2(0, 0) }, uAspect: { value: 1 }, uLight: { value: new THREE.Color(0.6, 0.62, 0.66) } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: RAIN_FS, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.mat);
  }
  setSize(w, h) { this.U.uAspect.value = w / Math.max(1, h); }
  render(renderer, writeBuffer, readBuffer) {
    this.U.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

// Intensidad de lluvia visible en el instante t (mm/h), con 20 min de transición
export function rainAt(rain, startH, t) {
  if (!rain) return 0;
  const t0 = startH * 3600;
  return rain * Math.max(0, Math.min(1, (t - t0) / 1200));
}
