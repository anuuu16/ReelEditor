const cache = new Map<string, Promise<unknown>>();

export function getOrCreate<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing as Promise<T>;
  const promise = factory();
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}
