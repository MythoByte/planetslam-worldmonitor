import type { Page } from '@playwright/test';
import type { EarthDataset, EarthEnvelope, EarthEvent } from '../src/types/earth';

export function earthFixture(dataset: EarthDataset): EarthEnvelope<unknown> {
  const now = Date.now();
  const event: EarthEvent = { id: 'fixture-volcano', sourceId: 'synthetic', title: 'Synthetic Kīlauea activity', kind: 'volcano', latitude: 19.421, longitude: -155.287,
    region: 'Hawaiʻi', severity: 'unknown', mode: 'observed', status: 'Tracked event', observedAt: now - 60_000, expiresAt: null,
    url: 'https://example.com/earth/volcano', provider: 'Synthetic observatory', summary: 'Synthetic acceptance event; not an operational report.' };
  const weatherPoint = { time: now, temperatureC: 18, windKmh: 12, precipitationMm: .2, symbol: 'partlycloudy_day' };
  const all: Record<EarthDataset, unknown> = {
    earthquakes: { items: [{ ...event, id: 'fixture-quake', title: 'Synthetic Pacific earthquake', kind: 'earthquake', magnitude: 4.5, depthKm: 12, severity: 'unknown', region: 'Pacific' }] },
    events: { items: [event, { ...event, id: 'fixture-fire', title: 'Synthetic wildfire observation', kind: 'wildfire', latitude: 38, longitude: -120, region: 'California' }] },
    alerts: { items: [{ ...event, id: 'fixture-flood', title: 'Synthetic flood warning', kind: 'flood', mode: 'warning', severity: 'severe', expiresAt: now + 3600_000, latitude: null, longitude: null, region: 'United States' }] },
    weather: { items: [{ id: 'london', sourceId: 'synthetic', name: 'London', latitude: 51.5, longitude: -.12, region: 'Europe', modelRunAt: now - 3600_000, current: weatherPoint, forecast: [weatherPoint], sourceUrl: 'https://example.com/earth/weather' },
      { id: 'tokyo', sourceId: 'synthetic', name: 'Tokyo', latitude: 35.68, longitude: 139.69, region: 'Asia', modelRunAt: now, current: { ...weatherPoint, temperatureC: 22 }, forecast: [weatherPoint], sourceUrl: 'https://example.com/earth/weather' }] },
    news: { items: [{ id: 'news1', sourceId: 'synthetic', title: 'Synthetic volcano agency update', url: event.url, summary: '<script>window.earthXss=true</script> Synthetic update.', publisher: 'Synthetic official source', publishedAt: now - 60_000, kind: 'volcano', region: 'Hawaiʻi', official: true },
      { id: 'news2', sourceId: 'synthetic', title: 'Synthetic flood reporting', url: 'https://example.com/earth/news/flood', summary: 'Synthetic reporting.', publisher: 'Synthetic news publisher', publishedAt: now - 120_000, kind: 'flood', region: 'United States', official: false, relatedUrls: ['https://example.com/earth/related'] }] },
    rivers: { items: [{ id: 'pitt', sourceId: 'synthetic', name: 'Synthetic Pittsburgh gauge', latitude: 40.44, longitude: -80, region: 'United States', observedAt: now - 60_000, stage: 16.4, unit: 'ft', floodCategory: 'no_flooding', thresholds: { action: 18, minor: 25, moderate: 31, major: 38 }, sourceUrl: 'https://example.com/earth/gauge' }] },
    airquality: { items: [{ id: 'aq1', sourceId: 'synthetic', name: 'Synthetic city', countryCode: 'US', latitude: 40, longitude: -80, region: 'United States', observedAt: now - 120_000, pm25: 8, aqi: 33, riskLevel: 'Good', provider: 'Synthetic air-quality feed', sourceUrl: 'https://example.com/earth/aq' }] },
    health: { items: [] },
  };
  if (dataset === 'health') all.health = { items: (Object.keys(all) as EarthDataset[]).filter(d => d !== 'health').map(d => ({ ...earthFixture(d), data: null })) };
  return { dataset, status: 'fresh', provider: 'Synthetic Earth acceptance provider', sourceUrl: 'https://example.com/earth/source', coverage: 'Synthetic bounded test coverage; not actual hazard information.', fetchedAt: now, observedAt: now - 60_000, expiresAt: now + 3600_000, data: all[dataset] };
}
export async function installEarthFixtures(page: Page, overrides: Partial<Record<EarthDataset, Partial<EarthEnvelope<unknown>>>> = {}) {
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/bootstrap*', route => route.fulfill({ json: { missing: [], data: {} } }));
  await page.route('**/api/earth?*', route => {
    const dataset = new URL(route.request().url()).searchParams.get('dataset') as EarthDataset;
    return route.fulfill({ json: { ...earthFixture(dataset), ...overrides[dataset] } });
  });
  await page.route('https://api.rainviewer.com/**', route => route.fulfill({ json: { radar: { past: [] } } }));
}
