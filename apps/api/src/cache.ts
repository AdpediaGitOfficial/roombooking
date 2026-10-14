/**
 * A small read-through cache for expensive, widely shared views (dashboards, pick-lists).
 *
 * - Entries live for `ttlMs` and are dropped early whenever any operation changes data, so a
 *   person who just made a change sees it straight away on the same instance.
 * - Concurrent requests for the same key share one computation, so a burst of dashboard loads
 *   costs one database pass instead of one per request.
 * - With several API instances each keeps its own cache; another instance may serve data up to
 *   `ttlMs` old. Only aggregates and pick-lists should use it, never a record someone is editing.
 */
export class ReadCache {
  private readonly entries = new Map<string, { at: number; value: unknown }>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private generation = 0;
  hits = 0;
  misses = 0;

  constructor(private readonly ttlMs: number, private readonly maxEntries = 500) {}

  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) return load();
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) {
      this.hits++;
      return hit.value as T;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    this.misses++;
    const generation = this.generation;
    const promise = load()
      .then((value) => {
        // A change that landed while this was loading makes the result suspect; serve it once but do not keep it.
        if (generation === this.generation) {
          if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
          this.entries.set(key, { at: Date.now(), value });
        }
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  /** Called after any successful change to data. */
  clear() {
    this.generation++;
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
