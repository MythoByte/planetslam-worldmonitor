import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PanelConfig } from '../src/types';
import {
  applyVariantPanelLayoutTransition,
  persistGateOwnershipTransition,
  resolveAppliedPanelLayoutVariant,
  stageVariantSelection,
} from '../src/services/variant-panel-ownership';

describe('variant panel ownership', () => {
  it('seeds new PlanetSlam editions and restores each saved panel profile on return', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    };
    let panels: Record<string, PanelConfig> = {
      world: { name: 'World', enabled: true, priority: 1 },
      positive: { name: 'Positive', enabled: false, priority: 1 },
      'cw-user': { name: 'My widget', enabled: true, priority: 1 },
    };
    const transition = (previousVariant: string, currentVariant: string, defaultKey: string) => {
      panels = applyVariantPanelLayoutTransition({
        currentVariant,
        panelSettings: panels,
        variantPanelKeys: new Set([defaultKey]),
        isDynamicPanel: key => key.startsWith('cw-'),
        getDefaultPanel: key => ({ name: key, enabled: true, priority: 1 }),
        persistPanels: () => {},
        persistAppliedVariant: () => {},
        editionProfiles: { previousVariant, storage },
      });
    };
    transition('full', 'happy', 'positive');
    assert.equal(panels.positive?.enabled, true, 'a disabled World panel must not hide a new edition default');
    assert.equal(panels['cw-user']?.enabled, true);
    panels.positive!.enabled = false; // User explicitly hides it in Good News.
    transition('happy', 'full', 'world');
    assert.equal(panels.world?.enabled, true, 'the original World preferences return');
    transition('full', 'happy', 'positive');
    assert.equal(panels.positive?.enabled, false, 'the Good News preference survives a round trip');
    assert.ok(store.has('planetslam-panels:full'));
    assert.ok(store.has('planetslam-panels:happy'));
  });

  it('persists free ownership before a destructive preference and stops on failure', () => {
    const events: string[] = [];
    const failed = persistGateOwnershipTransition(
      'free',
      () => { events.push('preference'); },
      () => { events.push('ownership'); return false; },
    );

    assert.deepEqual(events, ['ownership']);
    assert.deepEqual(failed, {
      preferencePersisted: false,
      ownershipPersisted: false,
      complete: false,
    });
  });

  it('persists a Pro restoration before clearing ownership and retains it on failure', () => {
    const events: string[] = [];
    const failed = persistGateOwnershipTransition(
      'pro',
      () => { events.push('preference'); return false; },
      () => { events.push('ownership'); },
    );

    assert.deepEqual(events, ['preference']);
    assert.deepEqual(failed, {
      preferencePersisted: false,
      ownershipPersisted: false,
      complete: false,
    });
  });

  it('reports a durable Pro preference even when ownership clearing must retry', () => {
    const events: string[] = [];
    const result = persistGateOwnershipTransition(
      'pro',
      () => { events.push('preference'); },
      () => { events.push('ownership'); throw new Error('quota'); },
    );

    assert.deepEqual(events, ['preference', 'ownership']);
    assert.deepEqual(result, {
      preferencePersisted: true,
      ownershipPersisted: false,
      complete: false,
    });
  });

  it('seeds a stable valid legacy profile without treating it as a variant switch', () => {
    const seeded: string[] = [];
    const applied = resolveAppliedPanelLayoutVariant({
      appliedVariant: null,
      legacyVariant: 'full',
      currentVariant: 'full',
      validVariants: new Set(['full', 'tech']),
      persistAppliedVariant: (variant) => { seeded.push(variant); },
    });

    assert.equal(applied, 'full');
    assert.deepEqual(seeded, ['full']);
  });

  it('keeps an existing applied marker authoritative during a staged switch', () => {
    const seeded: string[] = [];
    const applied = resolveAppliedPanelLayoutVariant({
      appliedVariant: 'full',
      legacyVariant: 'tech',
      currentVariant: 'tech',
      validVariants: new Set(['full', 'tech']),
      persistAppliedVariant: (variant) => { seeded.push(variant); },
    });

    assert.equal(applied, 'full');
    assert.deepEqual(seeded, []);
  });

  it('ignores an invalid legacy variant when the applied marker is missing', () => {
    const applied = resolveAppliedPanelLayoutVariant({
      appliedVariant: null,
      legacyVariant: 'removed-variant',
      currentVariant: 'full',
      validVariants: new Set(['full', 'tech']),
      persistAppliedVariant: () => { throw new Error('must not seed'); },
    });

    assert.equal(applied, null);
  });

  it('keeps the selected and applied layout variants distinct across a reload', () => {
    const writes: Array<[string, string]> = [];
    assert.equal(
      stageVariantSelection('full', 'tech', (key, value) => {
        writes.push([key, value]);
      }),
      true,
    );
    assert.deepEqual(writes, [
      ['worldmonitor-panel-layout-variant', 'full'],
      ['worldmonitor-variant', 'tech'],
    ]);
  });

  it('does not overwrite the selected variant when the applied marker cannot persist', () => {
    const writes: string[] = [];
    const staged = stageVariantSelection('full', 'tech', (key) => {
      writes.push(key);
      return false;
    });

    assert.equal(staged, false);
    assert.deepEqual(writes, ['worldmonitor-panel-layout-variant']);
  });

  it('persists the marker-free panel reset before marking the new layout applied', () => {
    const panels: Record<string, PanelConfig> = {
      keep: { name: 'Keep', enabled: true },
      outsideEnabled: { name: 'Outside enabled', enabled: true, proGated: true },
      outsideHidden: { name: 'Outside hidden', enabled: false, proGated: true },
      'cw-user': { name: 'Widget', enabled: false, proGated: true },
    };
    const events: string[] = [];
    let persisted: Record<string, PanelConfig> | null = null;

    const result = applyVariantPanelLayoutTransition({
      currentVariant: 'tech',
      panelSettings: panels,
      variantPanelKeys: new Set(['keep', 'new-default']),
      isDynamicPanel: (key) => key.startsWith('cw-'),
      getDefaultPanel: (key) => ({ name: key, enabled: true }),
      persistPanels: (next) => {
        events.push('panels');
        persisted = structuredClone(next);
      },
      persistAppliedVariant: (variant) => events.push(`variant:${variant}`),
    });

    assert.deepEqual(events, ['panels', 'variant:tech']);
    assert.equal(result.outsideEnabled?.enabled, false);
    assert.equal(result.outsideEnabled?.proGated, undefined);
    assert.equal(result.outsideHidden?.enabled, false);
    assert.equal(result.outsideHidden?.proGated, undefined);
    assert.equal(result['cw-user']?.proGated, true, 'dynamic panel state survives variant resets');
    assert.equal(result['new-default']?.enabled, true);
    assert.deepEqual(persisted, result);
  });

  it('does not advance the applied marker when panel persistence fails', () => {
    const events: string[] = [];
    const result = applyVariantPanelLayoutTransition({
      currentVariant: 'tech',
      panelSettings: { outside: { name: 'Outside', enabled: true, proGated: true } },
      variantPanelKeys: new Set(),
      isDynamicPanel: () => false,
      getDefaultPanel: (key) => ({ name: key, enabled: true }),
      persistPanels: () => {
        events.push('panels');
        throw new Error('quota exceeded');
      },
      persistAppliedVariant: () => events.push('variant'),
    });

    assert.deepEqual(events, ['panels']);
    assert.equal(result.outside?.enabled, false, 'the safe in-memory transition still applies');
    assert.equal(result.outside?.proGated, undefined);
  });
});
