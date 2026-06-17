import '@testing-library/jest-dom';

if (typeof window !== 'undefined') {
  class MemoryStorage {
    private items = new Map<string, string>();

    get length() {
      return this.items.size;
    }

    clear() {
      this.items.clear();
    }

    getItem(key: string) {
      return this.items.get(key) ?? null;
    }

    key(index: number) {
      return Array.from(this.items.keys())[index] ?? null;
    }

    removeItem(key: string) {
      this.items.delete(key);
    }

    setItem(key: string, value: string) {
      this.items.set(key, value);
    }
  }

  const storage = new MemoryStorage();

  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Storage', {
    value: MemoryStorage,
    configurable: true,
  });
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(window, 'Storage', {
    value: MemoryStorage,
    configurable: true,
  });
}
