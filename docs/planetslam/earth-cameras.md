# PlanetSlam Earth cameras

The catalog contains thirteen curated operator cameras, including five YouTube
live sources and eight periodic image sources. Coverage is regional,
not a worldwide camera network. Map coordinates locate a camera approximately;
they do not claim that an event is visible from it.

| Camera | Operator | Media | Typical refresh |
| --- | --- | --- | --- |
| Kīlauea V1cam | USGS Hawaiian Volcano Observatory | YouTube live video source | Player verifies playback |
| Kīlauea V2cam | USGS Hawaiian Volcano Observatory | YouTube live video source | Player verifies playback |
| Kīlauea V3cam | USGS Hawaiian Volcano Observatory | YouTube live video source | Player verifies playback |
| Reykjanes / Grindavík mosaic | RÚV | YouTube live video source | Several camera views; player verifies playback |
| Monterey Bay outdoor view | Monterey Bay Aquarium | YouTube live video source | Operator may show recordings outside live hours |
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
  links the V1cam, V2cam and V3cam YouTube videos. The official
  `url.usgs.gov/v2cam` and `url.usgs.gov/v3cam` redirects were resolved to
  explicit videos when the catalog was checked. The USGS media entry identifies its imagery as
  public domain. The video ID can rotate; an unavailable player retains a source
  link instead of implying a live view. Do not use the generic USGS channel's
  featured live video as a fallback because it may show another location.
- [RÚV volcanic-area streams](https://www.ruv.is/frettir/innlent/2023-12-18-bein-streymi-fra-gosstodvum-399932)
  embeds the RÚV Grindavík mosaic. The regional tourism authority also links
  it from [Reykjanes webcams](https://www.visitreykjanes.is/en/volcano-eruption/eruption-information-everything-you-need-to-know/webcams-from-the-eruption-site).
  Its map point represents the viewing area, not every camera in the mosaic or
  an active eruption. RÚV retains its broadcast rights; use the official player
  and source link without downloading, rehosting, or removing its branding.
- [Monterey Bay Aquarium Bay Cam](https://www.montereybayaquarium.org/cams-videos/live-cams/monterey-bay-cam)
  supplies the outdoor ocean-deck YouTube embed. This is the coastline, not an
  indoor aquarium exhibit. The Aquarium retains its media rights. The operator
  explicitly notes recorded footage outside its live hours; the shared player
  rejects ended recordings for built-in live cameras. A stream's metadata cannot
  independently establish that its picture is contemporaneous; inspect the
  operator's timestamp, live status, and off-hours notices.
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
or removed camera IDs are discarded. Type, region, media, and saved-only controls filter
the catalog. Filters are session state, separate from saved favorites.

On 2026-11-07, the eight image endpoints returned HTTP 200 and the V1cam official
YouTube oEmbed returned HTTP 200 with USGS attribution. All eight images also decoded successfully in headless Chromium. This verifies
source reachability and browser image loading at that time. It does not prove
live video playback, continuous availability, current snapshot capture times, or
visibility during an event.

The **Camera media** control separates **YouTube live sources** from **Periodic
snapshots**. Filtering never connects media. Selecting a camera on the map clears
media filters so its card can be focused, without starting playback.

On 2026-11-07, the operator pages linked the five catalogued YouTube videos and
YouTube player metadata reported `isLive=true`, `isLiveNow=true`, playback `OK`,
and embedding allowed for all five. None had an end timestamp. This establishes
that live sources existed at the check time; it is separate from a user-specific
player connection, visibility through weather or darkness, and continuous future
availability. Source checks are dated in each video card. Camera coordinates are
approximate, especially the RÚV multi-camera viewing area.
