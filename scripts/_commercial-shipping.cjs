const MAX_AGE_MS = 10 * 60_000;
const MAX_REPORTS = 2000;

// Explicitly classified working vessels; unknown, military and pleasure craft
// stay out. Reuse the relay's existing position and static-data caches.
function selectCommercialVessels(vessels, metadata, militaryCandidates, now = Date.now()) {
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
    reports.push({ ...vessel, shipType, name: vessel.name || meta?.shipName || '' });
  }
  reports.sort((a, b) => b.timestamp - a.timestamp || String(a.mmsi).localeCompare(String(b.mmsi)));
  return { vessels: reports.slice(0, MAX_REPORTS), limited: reports.length > MAX_REPORTS };
}

module.exports = { selectCommercialVessels, MAX_AGE_MS, MAX_REPORTS };
