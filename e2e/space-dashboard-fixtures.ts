import type { Page } from '@playwright/test';
import type { SpaceDataset, SpaceEnvelope } from '../src/types/space';

export function spaceFixture(dataset: SpaceDataset): SpaceEnvelope<unknown> {
  const now = Date.now();
  const date = new Date(now).toISOString().slice(0, 10);
  const item = { id: 'fixture-launch', name: 'Synthetic Falcon mission', net: now + 3600000, windowStart: now + 3600000, windowEnd: now + 7200000, status: 'Go for launch', provider: 'SpaceX', rocket: 'Falcon fixture', mission: 'Synthetic acceptance mission; not an actual launch.', pad: 'Cape Canaveral fixture pad', latitude: 28.561, longitude: -80.577, webcastUrl: 'https://www.spacex.com/launches/', url: 'https://example.com/launch' };
  const data: Record<SpaceDataset, unknown> = {
    apod: { items: [
      { date, title: 'Synthetic nebula acceptance image', explanation: '<script>unsafe</script> Text must be escaped.', mediaType: 'image', url: 'https://example.com/space-test-image.png', hdUrl: '', thumbnailUrl: '', credit: 'Synthetic fixture — not NASA imagery', sourceUrl: 'https://example.com/apod' },
      { date: '2026-10-01', title: 'Synthetic APOD video', explanation: 'A video archive day.', mediaType: 'video', url: 'https://www.youtube.com/watch?v=fixture1234', hdUrl: '', thumbnailUrl: '', credit: 'Synthetic fixture', sourceUrl: 'https://example.com/apod/video' },
    ] },
    news: { items: [
      { id: 'n1', title: 'SpaceX synthetic acceptance headline', url: 'https://example.com/news/spacex', summary: 'Starship news fixture with source attribution.', publisher: 'Synthetic news provider', publishedAt: now - 60000, launchIds: ['fixture-launch'] },
      { id: 'n2', title: 'Telescope science acceptance headline', url: 'https://example.com/news/science', summary: 'A science fixture.', publisher: 'Synthetic agency feed', publishedAt: now - 120000, launchIds: [] },
    ] },
    launches: { items: [item] },
    weather: { scales: { G: 1, R: 0, S: 0 }, kp: [1, 2, 3, 2, 4, 3].map((value, i) => ({ time: now - (6 - i) * 180000, value })), wind: [420, 440, 430, 460].map((speed, i) => ({ time: now - (4 - i) * 60000, speed, density: 4, bz: -3 })), alerts: [{ id: 'SYNTHETIC-NOAA-BULLETIN', message: 'Synthetic bulletin for acceptance; not an operational alert.', issuedAt: now }] },
    aurora: { forecastAt: now + 1800000, observationAt: now - 60000, points: Array.from({ length: 72 }, (_, i) => ({ latitude: 65 + Math.sin(i / 6) * 5, longitude: i * 5, probability: 30 + i % 60 })) },
    solar: { items: [{ id: 'sun', title: 'Synthetic solar observation', url: 'https://example.com/space-test-image.png', sourceUrl: 'https://example.com/sdo', observedAt: now - 60000 }] },
    events: { items: [{ id: 'SYNTHETIC-FLARE', type: 'flare', time: now - 3600000, classType: 'M1.0', note: 'Synthetic flare record for acceptance.', url: 'https://example.com/donki' }] },
    neo: { items: [{ id: 'neo1', name: 'Synthetic asteroid', approachAt: now + 86400000, diameterMinKm: .03, diameterMaxKm: .08, missDistanceKm: 1200000, lunarDistance: 3.12, velocityKmS: 12.3, potentiallyHazardous: true, url: 'https://example.com/neo' }] },
    health: { items: [] },
  };
  if (dataset === 'health') data.health = { items: (['apod', 'news', 'launches', 'weather', 'aurora', 'solar', 'events', 'neo'] as SpaceDataset[]).map(key => ({ ...spaceFixture(key), data: null })) };
  return { dataset, status: 'fresh', provider: 'Synthetic acceptance provider', sourceUrl: 'https://example.com/provider', fetchedAt: now, observedAt: now - 60000, expiresAt: now + 3600000, data: data[dataset] };
}

export async function installSpaceFixtures(page: Page, overrides: Partial<Record<SpaceDataset, Partial<SpaceEnvelope<unknown>>>> = {}) {
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: {} } }));
  await page.route('**/api/space?*', route => {
    const dataset = new URL(route.request().url()).searchParams.get('dataset') as SpaceDataset;
    return route.fulfill({ json: { ...spaceFixture(dataset), ...overrides[dataset] } });
  });
  await page.route('https://example.com/space-test-image.png', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="800" height="480" fill="#08192b"/><circle cx="400" cy="220" r="150" fill="#226b91"/><text x="400" y="440" text-anchor="middle" fill="white" font-size="24">SYNTHETIC ACCEPTANCE IMAGE</text></svg>' }));
}
