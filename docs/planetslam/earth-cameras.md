# PlanetSlam Earth cameras

The initial catalog contains nine curated official cameras. Coverage is regional,
not a worldwide camera network. Map coordinates locate a camera approximately;
they do not claim that an event is visible from it.

| Camera | Operator | Media | Typical refresh |
| --- | --- | --- | --- |
| Kīlauea V1cam | USGS Hawaiian Volcano Observatory | YouTube live video source | Player verifies playback |
| Ruapehu North | GeoNet / Earth Sciences New Zealand | Still image | 10 minutes |
| Whakaari from Te Kaha | GeoNet / Earth Sciences New Zealand | Still image | 10 minutes |
| Raoul Island | GeoNet / Earth Sciences New Zealand | Still image | 10 minutes |
| Redwood Pacific coast | National Park Service | Still image | 1 minute |
| Paria Overlook / Colorado River | National Park Service | Still image | 10 minutes |
| Mount Rainier / Paradise | National Park Service | Still image | 5 minutes |
| Mount Washburn south | National Park Service | Still image | 1 minute |
| Barrow Observatory | NOAA Global Monitoring Laboratory | Still image | 5 minutes |

## Sources and attribution

Each card links to the operator's source page. The catalog uses public official
embeds and image endpoints without scraping private feeds, removing attribution,
or proxying access restrictions.

- [USGS summit cameras](https://www.usgs.gov/volcanoes/kilauea/summit-webcams)
  links the V1cam YouTube video. The USGS media entry identifies its imagery as
  public domain. The video ID can rotate; an unavailable player retains a source
  link instead of implying a live view. Do not use the generic USGS channel's
  featured live video as a fallback because it may show another location.
- [GeoNet camera documentation](https://www.geonet.org.nz/data/types/camera)
  documents the latest-image URLs, approximate ten-minute update cycle, and
  timestamp labels. The [GeoNet data policy](https://www.geonet.org.nz/policy)
  applies CC BY 3.0 NZ; cards credit GeoNet / Earth Sciences New Zealand and link
  to that policy. Images are displayed without alteration.
- [Redwood cameras](https://www.nps.gov/redw/learn/photosmultimedia/webcams.htm),
  [Paria Overlook](https://www.nps.gov/media/webcam/view.htm?id=81B467B9-1DD8-B71B-0BA34037897F857D),
  [Mount Rainier cameras](https://www.nps.gov/mora/learn/photosmultimedia/webcams.htm),
  and [Yellowstone cameras](https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm)
  publish the NPS image URLs used in the catalog.
- [NOAA Barrow live camera](https://gml.noaa.gov/obop/brw/livecamera.html)
  publishes the Observatory still image with an embedded UTC timestamp.

## Behavior and verification limits

Media loads only after the user connects a camera. Video uses the existing
PlanetSlam player and labels live, recording, connecting, unverified, and offline
states separately. Still images are always labeled periodic snapshots. Loading
an image successfully establishes reachability, not capture freshness. The panel
shows the load time and asks the viewer to inspect the timestamp within the image.
An old image returned with HTTP 200 must not be called live.

Snapshot refresh and video playback pause while the camera panel is offscreen,
collapsed, detached, or the browser document is hidden. Filters stop existing
media sessions. A camera selected on the map focuses its card without playback.
An event selection narrows the view to cameras within 250 km; a nearby camera is
geographic context and does not verify the event.

Favorites persist locally under `planetslam-earth-camera-favorites-v1`; malformed
or removed camera IDs are discarded. Type, region, and saved-only controls filter
the catalog. Filters are session state, separate from saved favorites.

On 2026-11-07, the eight image endpoints returned HTTP 200 and the V1cam official
YouTube oEmbed returned HTTP 200 with USGS attribution. All eight images also decoded successfully in headless Chromium. This verifies
source reachability and browser image loading at that time. It does not prove
live video playback, continuous availability, current snapshot capture times, or
visibility during an event.
