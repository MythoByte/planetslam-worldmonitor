import { IS_PLANETSLAM } from '@/config/brand';
import { resolvePlanetSlamLink } from '@/config/planetslam-links';

const installations = new WeakMap<HTMLElement, () => void>();

/** Covers dynamically rendered Settings, country briefs, and panel links. */
export function installPlanetSlamLinks(root: HTMLElement): () => void {
  if (!IS_PLANETSLAM) return () => {};
  const installed = installations.get(root);
  if (installed) return installed;
  const reconcile = (node: Node): void => {
    if (!(node instanceof Element)) return;
    const anchors = node.matches('a[href]')
      ? [node as HTMLAnchorElement, ...node.querySelectorAll<HTMLAnchorElement>('a[href]')]
      : [...node.querySelectorAll<HTMLAnchorElement>('a[href]')];
    for (const anchor of anchors) {
      const original = anchor.getAttribute('href')!;
      const target = resolvePlanetSlamLink(original);
      if (target === null) anchor.remove();
      else if (target !== original) anchor.setAttribute('href', target);
    }
  };
  reconcile(root);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') reconcile(record.target);
      else for (const node of record.addedNodes) reconcile(node);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
  const dispose = () => { observer.disconnect(); installations.delete(root); };
  installations.set(root, dispose);
  return dispose;
}
