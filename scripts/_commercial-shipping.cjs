const MAX_AGE_MS = 10 * 60_000;
const MAX_REPORTS = 2000;
const MAX_PER_CHOKEPOINT = 120;
const MAX_BACKGROUND_REPORTS = 100;

// Explicitly classified working vessels; unknown, military and pleasure craft
// stay out. Reuse the relay's existing position and static-data caches.
function selectCommercialVessels(vessels, metadata, militaryCandidates, now = Date.now(), { bbox, chokepoints } = {}) {
  const reports = [];
  for (const vessel of vessels.values()) {
    const meta = metadata.get(vessel.mmsi);
    const shipType = Number(vessel.shipType || meta?.shipType);
    if (!Number.isInteger(shipType) || !(shipType === 30 || shipType === 31 || shipType === 32 || shipType === 52
      || (shipType >= 60 && shipType <= 89))) continue;
    if (!/^\d{9}$/.test(String(vessel.mmsi)) || militaryCandidates.has(vessel.mmsi)) continue;
    if (!Number.isFinite(vessel.timestamp) || now - vessel.timestamp > MAX_AGE_MS || vessel.timestamp > now) continue;
    if (!Number.isFinite(vessel.lat) || !Number.isFinite(vessel.lon)
      || Math.abs(vessel.lat) > 90 || Math.abs(vessel.lon) > 180) continue;
    if (bbox && (vessel.lat < bbox.sw.lat || vessel.lat > bbox.ne.lat
      || vessel.lon < bbox.sw.lon || vessel.lon > bbox.ne.lon)) continue;
    reports.push({ ...vessel, shipType, name: vessel.name || meta?.shipName || '' });
  }
  reports.sort((a, b) => b.timestamp - a.timestamp || String(a.mmsi).localeCompare(String(b.mmsi)));
  if (bbox || !chokepoints) return { vessels: reports.slice(0, MAX_REPORTS), limited: reports.length > MAX_REPORTS };

  const focused = [];
  const background = [];
  const counts = new Map();
  for (const report of reports) {
    const areas = chokepoints.get(report.mmsi);
    if (!areas?.size) {
      if (background.length < MAX_BACKGROUND_REPORTS) background.push(report);
      continue;
    }
    for (const area of areas) {
      const count = counts.get(area) ?? 0;
      if (count >= MAX_PER_CHOKEPOINT) continue;
      counts.set(area, count + 1);
      focused.push(report);
      break;
    }
  }
  // Keep some geographic context, including when AIS has no positions near chokepoints.
  const backgroundLimit = focused.length ? Math.floor(focused.length / 2) : MAX_BACKGROUND_REPORTS;
  const selected = focused.concat(background.slice(0, backgroundLimit)).slice(0, MAX_REPORTS);
  return { vessels: selected, limited: selected.length < reports.length };
}

module.exports = { selectCommercialVessels, MAX_AGE_MS, MAX_REPORTS };
