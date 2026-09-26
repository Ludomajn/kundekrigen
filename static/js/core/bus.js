/* Kundekrigen — minimal hændelsesbus.
 * Simulationen udsender; rendering og brugerflade lytter. Aldrig omvendt. */
'use strict';

export function lavBus() {
  const lyttere = new Map();
  return {
    paa(navn, cb) {
      if (!lyttere.has(navn)) lyttere.set(navn, new Set());
      lyttere.get(navn).add(cb);
      return () => lyttere.get(navn).delete(cb);
    },
    af(navn, cb) { lyttere.get(navn)?.delete(cb); },
    send(navn, data) {
      const s = lyttere.get(navn);
      if (s) for (const cb of s) cb(data);
      const alle = lyttere.get('*');
      if (alle) for (const cb of alle) cb({ navn, data });
    },
    ryd() { lyttere.clear(); },
  };
}
