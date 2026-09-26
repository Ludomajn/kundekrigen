/* Kundekrigen — spillets palet som THREE-farver (samme tokens som app.css). */
'use strict';

import { Color } from '../three.js';

export const HEX = {
  primary: 0x10546B,
  deep:    0x0D3145,
  ice:     0xCFE8F0,
  yellow:  0xFFD86F,
  green:   0x4E684E,
  forest:  0x212F22,
  sage:    0xA5B69B,
  brown:   0x695B4B,
  espresso:0x3D3123,
  sand:    0xB9AF9A,
  grey:    0x5A5A5A,
  ink:     0x232323,
  line:    0xDADADA,
  hvid:    0xFFFFFF,
};

export const C = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, new Color(v)]));

/* Holdfarver. Klinik Rød er en teglrød fra jordtonefamilien, så den passer
 * til resten af paletten og stadig er tydelig. */
export const HOLD = {
  blaa:  { hex: 0x10546B, kant: 0x0D3145, tekst: '#fff',    navn: 'Klinik Blå',  css: '#10546B' },
  roed:  { hex: 0xA34526, kant: 0x7A3520, tekst: '#fff',    navn: 'Klinik Rød',  css: '#A34526' },
  gul:   { hex: 0xFFD86F, kant: 0x8A6B1C, tekst: '#232323', navn: 'Klinik Gul',  css: '#FFD86F' },
  groen: { hex: 0x4E684E, kant: 0x212F22, tekst: '#fff',    navn: 'Klinik Grøn', css: '#4E684E' },
};
export const HOLD_ORDEN = ['blaa', 'roed', 'gul', 'groen'];

export const holdFarve = (i) => HOLD[HOLD_ORDEN[i % 4]];

export function hexStr(n) { return '#' + n.toString(16).padStart(6, '0'); }
