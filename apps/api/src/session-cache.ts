/**
 * Short-lived cache of resolved sessions, so a busy user does not cost a
 * database round trip on every request. Entries expire after a few seconds,
 * which bounds how long a revoked session or deactivated user stays valid on
 * other instances; this instance drops its entry immediately on sign-out.
 */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();
  constructor(private readonly ttlMs: number, private readonly max: number) {}

  get(key: string, now = Date.now()): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V, now = Date.now()) {
    if (this.ttlMs <= 0) return;
    if (this.map.size >= this.max) {
      for (const [k, v] of this.map) {
        if (v.expiresAt <= now) this.map.delete(k);
      }
      if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    }
    this.map.set(key, { value, expiresAt: now + this.ttlMs });
  }

  delete(key: string) {
    this.map.delete(key);
  }

  get size() {
    return this.map.size;
  }
}
