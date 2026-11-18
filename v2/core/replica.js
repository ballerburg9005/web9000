import {verifyEvent} from './events.js';
// Store everything a user CHOOSES to mirror, including labels they disagree with.
// Protocol validity only checks signatures/schema. There is no space ownership ACL.
export class Replica {
  #events = new Map();
  constructor({maxEvents=10000}={}) { this.maxEvents=maxEvents; }
  async ingest(event) {
    if (!await verifyEvent(event)) return {accepted:false, reason:'invalid signature or envelope'};
    if (this.#events.has(event.id)) return {accepted:true, duplicate:true};
    if (this.#events.size >= this.maxEvents) return {accepted:false, reason:'local replica capacity'};
    this.#events.set(event.id, structuredClone(event));
    return {accepted:true, duplicate:false};
  }
  get(id) { const v=this.#events.get(id); return v ? structuredClone(v) : null; }
  list() { return Array.from(this.#events.values(),e=>structuredClone(e)); }
  get size() { return this.#events.size; }
}
