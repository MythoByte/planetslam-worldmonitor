import { installPlanetSlamLinks } from '@/services/planetslam-links';

// Static article pages may hydrate their own navigation after first paint.
installPlanetSlamLinks(document.body);
