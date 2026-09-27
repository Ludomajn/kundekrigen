/* Kundekrigen — Worker som transport.
 *
 * Workeren er værten; hovedtråden er klienten. Det er præcis samme rollefordeling
 * som over netværket, så motoren og brugerfladen kender kun ét mønster.
 */
'use strict';

import { Transport } from './transport.js';

export class WorkerTransport extends Transport {
  constructor() {
    super();
    this.w = new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' });
    this.w.onmessage = (e) => this._besked(e.data);
    queueMicrotask(() => this._aaben());
  }
  get forbundet() { return !!this.w; }
  send(obj) { this.w?.postMessage(obj); }
  luk() {
    if (!this.w) return;
    // En lukket Worker må ikke nå at sende en sidste tilstand ind i den næste kamp.
    this.w.onmessage = null;
    this.w.postMessage({ t: 'stop' });
    this.w.terminate();
    this.w = null;
  }
}
