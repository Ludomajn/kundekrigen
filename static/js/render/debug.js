/* Kundekrigen — F3-overlay.
 *
 * Tegner den RÅ maske oven på det shadede terræn. Formålet er at gøre drift
 * mellem fysikmasken og den tegnede maske ØJEBLIKKELIGT SYNLIG, i stedet for
 * at den skal udledes af at en bæver falder gennem en bakke.
 */
'use strict';

import { Mesh, PlaneGeometry, ShaderMaterial, DataTexture, RedFormat,
         UnsignedByteType, NearestFilter } from '../three.js';
import { LUFT } from '../sim/terrain.js';

const FS = `
precision mediump float;
uniform sampler2D uMaske; varying vec2 vUv;
void main(){
  float m = texture2D(uMaske, vUv).r;
  if (m < 0.5) discard;
  gl_FragColor = vec4(1.0, 0.25, 0.7, 0.42);
}`;
const VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `;

export function lavDebug(scene, terraen) {
  const { w, h } = terraen;
  const data = new Uint8Array(w * h);
  const tex = new DataTexture(data, w, h, RedFormat, UnsignedByteType);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.generateMipmaps = false; tex.flipY = false;

  const mat = new ShaderMaterial({ vertexShader: VS, fragmentShader: FS,
                                   transparent: true, depthTest: false });
  mat.uniforms = { uMaske: { value: tex } };
  const mesh = new Mesh(new PlaneGeometry(w, h), mat);
  mesh.position.set(w / 2, h / 2, 40);
  mesh.renderOrder = 40;
  mesh.visible = false;
  scene.add(mesh);

  return {
    get synlig() { return mesh.visible; },
    skift() {
      mesh.visible = !mesh.visible;
      if (mesh.visible) this.opdater();
      return mesh.visible;
    },
    opdater() {
      if (!mesh.visible) return;
      for (let y = 0; y < h; y++) {
        const k = (h - 1 - y) * w, m = y * w;
        for (let x = 0; x < w; x++) data[m + x] = terraen.maske[k + x] === LUFT ? 0 : 255;
      }
      tex.needsUpdate = true;
    },
    fjern() { scene.remove(mesh); mesh.geometry.dispose(); mat.dispose(); tex.dispose(); },
  };
}
