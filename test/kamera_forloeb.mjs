/* Kundekrigen — et helt, skriptet turforløb til kameratestene: introen,
 * etableringen, gang, sigte og opladning, skud, nedslag og hold, et
 * dødsfald, et zoomtrin og en ny tur på den anden side af banen.
 * Bruges af kamera_glathed.mjs og kamera_determinisme.mjs.
 */
import { lavOpsaetning, lavBane, lavFigur, lavProjektil, TYNGDE } from './kamera_hjaelp.mjs';

/**
 * Kør forløbet i hz. Returnerer prøver pr. frame (glat og vist).
 * o.kamOpt går til lavKamera; o.efter(ops) kaldes til sidst.
 */
export function koerForloeb(hz = 60, o = {}) {
  const ops = lavOpsaetning({ bane: lavBane({ jord: (x) => 600 + 120 * Math.sin(x / 500) }), kamOpt: o.kamOpt });
  const { r, kam, t } = ops;
  const a = lavFigur(1, 800, t.jordHoejde(800) + 1, { vinkel: 0.7 });
  const b = lavFigur(2, 4300, t.jordHoejde(4300) + 1, { retning: -1, vinkel: 0.9 });
  const dt = 1 / hz;
  const proever = [];
  let tid = 0;
  let p = null, nedslag = null, holdTil = -1, landet = false;

  const trin = (sek, fn) => {
    const n = Math.round(sek * hz);
    for (let i = 0; i < n; i++) {
      fn?.(i / hz, i);
      kam.opdater(dt);
      const g = kam.glat;
      proever.push({ tid, x: g.x, y: g.y, zoom: g.zoom, vist: kam.zoom, b: r.bredde, h: r.hoejde,
                     px: r.kamera.position.x, py: r.kamera.position.y, tilstand: g.tilstand });
      tid += dt;
    }
  };

  kam.snap(a.x, a.y + 60);
  kam.kigPaaBanen(true);
  trin(3);                                           // introen: hele banen
  kam.kigPaaBanen(false);
  kam.etabler(a);                                    // første tur
  trin(2.5);
  trin(2, () => { a.x += 105 * dt; });               // gå til højre
  kam.saetSigte('vinkel+kraft', 0, a.id);
  trin(1, (s) => { a.vinkel = 0.7 + 0.25 * s; });    // sigt op
  trin(1.2, (s) => kam.saetSigte('vinkel+kraft', Math.min(1, s / 1.2), a.id));
  kam.saetSigte(null, 0, a.id);
  // Banen regnes analytisk efter tiden, så den er ens ved alle hz (spillets
  // simulation kører altid 60 Hz, uanset billedfrekvensen).
  const x0 = a.x + 20, y0 = a.y + 40, vx0 = Math.cos(a.vinkel) * 1200, vy0 = Math.sin(a.vinkel) * 1200;
  p = lavProjektil(10, x0, y0, vx0, vy0);
  trin(9, (s) => {
    if (!landet && p) {
      p.x = x0 + vx0 * s; p.y = y0 + vy0 * s - TYNGDE * s * s / 2; p.vy = vy0 - TYNGDE * s;
      if (p.y <= t.jordHoejde(p.x) || p.x > t.w + 200) {
        landet = true; nedslag = { x: p.x, y: p.y };
        kam.eksplosion(p.x, p.y, 74);              // Datalæk-bomben
        kam.foelgSkud(nedslag);
        holdTil = s + 1.5;
      } else kam.foelgSkud(p, [p]);
    } else if (holdTil > 0 && s > holdTil) {
      holdTil = -1; kam.fokus(a);                  // som main.js efter NEDSLAG_HOLD_MS
    }
  });
  kam.kortFokus(2500, t.jordHoejde(2500) + 22);    // en kunde lægger på
  trin(2.5);
  kam.zoomUd();
  trin(1.5);
  kam.zoomInd();
  kam.etabler(b);                                    // næste tur, den anden ende af banen
  trin(3);
  kam.friTilstand(true);                             // WASD
  trin(1, () => kam.panorer(700 * dt * kam.zoom, 0));
  kam.friTilstand(false); kam.foelg(b);              // C
  trin(2);
  o.efter?.(ops);
  return { ops, proever };
}
