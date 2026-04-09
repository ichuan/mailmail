import { describe, it, expect, beforeEach } from 'vitest';
import { slotRegistry } from '../../core/slot-registry';

// Minimal React components for testing (just functions — not rendered in jsdom here)
const CompA = () => null;
const CompB = () => null;
const CompC = () => null;

describe('SlotRegistry', () => {
  beforeEach(() => {
    slotRegistry.clear();
  });

  it('should register and retrieve components', () => {
    slotRegistry.register('sidebar:top', 'plugin-a', CompA);
    const components = slotRegistry.getComponents('sidebar:top');
    expect(components).toHaveLength(1);
    expect(components[0]).toBe(CompA);
  });

  it('should return empty array for unregistered slots', () => {
    expect(slotRegistry.getComponents('sidebar:bottom')).toEqual([]);
  });

  it('should sort by order', () => {
    slotRegistry.register('main', 'p1', CompB, 10);
    slotRegistry.register('main', 'p2', CompA, 0);
    slotRegistry.register('main', 'p3', CompC, 5);
    const comps = slotRegistry.getComponents('main');
    expect(comps).toEqual([CompA, CompC, CompB]);
  });

  it('should remove component on dispose', () => {
    const d = slotRegistry.register('slot', 'p1', CompA);
    expect(slotRegistry.getComponents('slot')).toHaveLength(1);
    d.dispose();
    expect(slotRegistry.getComponents('slot')).toHaveLength(0);
  });

  it('should remove all components by plugin id', () => {
    slotRegistry.register('slot-a', 'plugin-x', CompA);
    slotRegistry.register('slot-b', 'plugin-x', CompB);
    slotRegistry.register('slot-a', 'plugin-y', CompC);

    slotRegistry.removeByPlugin('plugin-x');
    expect(slotRegistry.getComponents('slot-a')).toHaveLength(1);
    expect(slotRegistry.getComponents('slot-a')[0]).toBe(CompC);
    expect(slotRegistry.getComponents('slot-b')).toHaveLength(0);
  });

  it('should increment snapshot version on changes', () => {
    const v0 = slotRegistry.getSnapshot();
    slotRegistry.register('slot', 'p', CompA);
    const v1 = slotRegistry.getSnapshot();
    expect(v1).toBeGreaterThan(v0);
  });

  it('should clear all slots', () => {
    slotRegistry.register('a', 'p', CompA);
    slotRegistry.register('b', 'p', CompB);
    slotRegistry.clear();
    expect(slotRegistry.getComponents('a')).toEqual([]);
    expect(slotRegistry.getComponents('b')).toEqual([]);
  });

  it('should notify subscribers on register', () => {
    let notified = false;
    const unsub = slotRegistry.subscribe(() => { notified = true; });
    slotRegistry.register('slot', 'p', CompA);
    expect(notified).toBe(true);
    unsub();
  });
});
