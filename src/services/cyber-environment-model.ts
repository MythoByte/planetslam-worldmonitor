export const ENVIRONMENT_KEY = 'planetslam-cyber-environment-v1';
export const INVENTORY_LIMIT = 500;
export const TASK_LIMIT = 200;
export const LOOKUP_LIMIT = 100;
export const IMPORT_BYTES = 5 * 1024 * 1024;
export const ECOSYSTEMS = ['Unknown', 'npm', 'PyPI', 'Go', 'Maven', 'crates.io', 'RubyGems', 'NuGet', 'Packagist'] as const;
export type Ecosystem = typeof ECOSYSTEMS[number];
export interface EnvironmentPackage {
  id: string; asset: string; name: string; version: string; ecosystem: Ecosystem;
  identityNote: string; importedAt: number;
}
export interface EnvironmentAdvisory {
  id: string; summary: string; aliases: string[]; modified: string; published: string;
  url: string; fixes: string[]; observedAt: number;
}
export interface EnvironmentLookup {
  key: string; name: string; version: string; ecosystem: Ecosystem; at: number;
  status: 'complete' | 'partial' | 'failed'; advisories: EnvironmentAdvisory[]; message: string;
}
export type RemediationStatus = 'open' | 'in-progress' | 'resolved' | 'accepted';
export interface EnvironmentTask {
  id: string; packageId: string; packageSnapshot: EnvironmentPackage; advisory: EnvironmentAdvisory;
  lookupAt: number; status: RemediationStatus; owner: string; due: string; notes: string;
  createdAt: number; updatedAt: number;
}
export interface EnvironmentStore {
  version: 1; packages: EnvironmentPackage[]; lookups: EnvironmentLookup[]; tasks: EnvironmentTask[];
}
export interface InventoryPreview {
  format: string; packages: EnvironmentPackage[]; duplicates: number; missingVersions: number; unidentified: number;
}
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const stamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const clean = (v: unknown, max: number): string => typeof v === 'string' ? v.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '';
export function environmentUrl(v: unknown): v is string {
  if (!text(v, 2048)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}
export function emptyEnvironment(): EnvironmentStore { return {version: 1, packages: [], lookups: [], tasks: []}; }
export function identityKey(p: Pick<EnvironmentPackage, 'name' | 'version' | 'ecosystem'>): string {
  return JSON.stringify([p.ecosystem, p.name, p.version]);
}
export function exactEnvironmentVersion(v: string): boolean {
  return v.length <= 120 && /^v?\d[0-9A-Za-z._+!~:-]*$/.test(v);
}
function validPackageName(ecosystem: Ecosystem, name: string): boolean {
  const plain = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (ecosystem === 'npm') return name.length<=214 && /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name);
  if (ecosystem === 'Maven') return /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(name);
  if (ecosystem === 'Go') return /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)+$/.test(name);
  if (ecosystem === 'Packagist') return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(name);
  return plain.test(name);
}
export function canLookupPackage(p: EnvironmentPackage): boolean {
  return p.ecosystem !== 'Unknown' && validPackageName(p.ecosystem,p.name) && exactEnvironmentVersion(p.version) && !p.identityNote && !/[\r\n]/.test(p.name + p.version);
}
export function packageIdentity(ecosystem: Ecosystem, name: string): string {
  if (ecosystem === 'PyPI') return name.toLowerCase().replace(/[-_.]+/g, '-');
  if (ecosystem === 'NuGet') return name.toLowerCase();
  if (ecosystem === 'crates.io') return name.toLowerCase().replace(/_/g, '-');
  return name;
}
function purlIdentity(raw: unknown): {name: string; version: string; ecosystem: Ecosystem; problem: string} | null {
  if (!text(raw, 2048) || !raw.startsWith('pkg:')) return null;
  try {
    const m = /^pkg:([a-z][a-z0-9.+-]*)\/([^?#]+)(?:\?([^#]*))?(?:#.*)?$/.exec(raw);
    if (!m) return null;
    let path = m[2]!; const at = path.lastIndexOf('@'); let version = '';
    if (at > path.lastIndexOf('/')) {version = decodeURIComponent(path.slice(at + 1)); path = path.slice(0, at);}
    const segments = path.split('/').map(s => decodeURIComponent(s));
    if (segments.some(s => !s || /[\s\u0000-\u001f?#/]/.test(s))) return null;
    const types: Record<string, Ecosystem> = {npm: 'npm', pypi: 'PyPI', golang: 'Go', maven: 'Maven', cargo: 'crates.io', gem: 'RubyGems', nuget: 'NuGet', composer: 'Packagist'};
    const ecosystem = Object.prototype.hasOwnProperty.call(types,m[1]!) ? types[m[1]!]! : 'Unknown'; let name = segments.join('/');
    if (ecosystem === 'Maven') {if (segments.length !== 2) return null; name = segments.join(':');}
    if (ecosystem === 'npm' && (segments.length > 2 || segments.length === 2 && !segments[0]!.startsWith('@'))) return null;
    if (['PyPI','crates.io','RubyGems','NuGet'].includes(ecosystem) && segments.length !== 1) return null;
    const customRegistry = m[3] && /(?:^|&)(?:repository_url|download_url|distro)=/i.test(m[3]);
    return {name: packageIdentity(ecosystem, name), version, ecosystem, problem: customRegistry ? 'Qualified/private-registry identity requires manual review.' : ecosystem === 'Unknown' ? 'PURL ecosystem is not supported for OSV lookups.' : ''};
  } catch { return null; }
}
export function manualEnvironmentPackage(input: {asset: string; name: string; version: string; ecosystem: string}, id: string = crypto.randomUUID(), now = Date.now()): EnvironmentPackage {
  if (!ECOSYSTEMS.includes(input.ecosystem as Ecosystem)) throw new Error('Choose a supported ecosystem or Unknown.');
  const ecosystem = input.ecosystem as Ecosystem;
  const name = packageIdentity(ecosystem, clean(input.name, 240));
  if (!name) throw new Error('Package/product name is required.');
  const version = clean(input.version, 120);
  if (input.name.trim().length>240 || input.version.trim().length>120) throw new Error('Package name or version exceeds its limit.');
  if (ecosystem!=='Unknown' && (!validPackageName(ecosystem,name) || version && !exactEnvironmentVersion(version))) throw new Error('Use the registry package name and an exact release version, not a range or tag.');
  return {id, asset: clean(input.asset, 100) || 'My environment', name, version, ecosystem, identityNote: '', importedAt: now};
}
export function previewEnvironmentImport(raw: string, asset: string, now = Date.now()): InventoryPreview {
  if (new TextEncoder().encode(raw).byteLength > IMPORT_BYTES) throw new Error('Inventory JSON must be at most 5 MiB.');
  let root: unknown; try {root = JSON.parse(raw);} catch {throw new Error('Choose valid JSON. XML, archives and executable files are not supported.');}
  if (!obj(root)) throw new Error('Expected a JSON inventory object.');
  let format = ''; const rows: {name: unknown; version: unknown; purl: unknown; ecosystem?: unknown}[] = [];
  if (root.bomFormat === 'CycloneDX' && ['1.4','1.5','1.6','1.7'].includes(String(root.specVersion))) {
    format = `CycloneDX ${root.specVersion}`;
    if (!Array.isArray(root.components)) throw new Error('CycloneDX components[] is required.');
    if(root.components.length>2000)throw new Error('Inventory contains more than 2,000 component nodes.');
    const queue = [...root.components];
    if (obj(root.metadata) && obj(root.metadata.component)) queue.push(root.metadata.component);
    for (let at = 0; at < queue.length; at++) {
      if (at >= 2000) throw new Error('Inventory contains more than 2,000 component nodes. Split it into smaller SBOMs.');
      const c = queue[at]; if (!obj(c)) throw new Error('Invalid CycloneDX component.');
      rows.push({name: c.group ? `${clean(c.group,160)}/${clean(c.name,240)}` : c.name, version: c.version, purl: c.purl});
      if (c.components !== undefined) {if (!Array.isArray(c.components)) throw new Error('Invalid nested components.');if(queue.length+c.components.length>2000)throw new Error('Inventory contains more than 2,000 component nodes.'); queue.push(...c.components);}
    }
  } else if (['SPDX-2.2','SPDX-2.3'].includes(String(root.spdxVersion))) {
    format = String(root.spdxVersion); if (!Array.isArray(root.packages) || root.packages.length > 2000) throw new Error('SPDX packages[] must contain at most 2,000 entries.');
    for (const c of root.packages) {
      if (!obj(c)) throw new Error('Invalid SPDX package.');
      const refs = Array.isArray(c.externalRefs) ? c.externalRefs : [];
      const purls = refs.filter(r => obj(r) && r.referenceType === 'purl').map(r => (r as Record<string,unknown>).referenceLocator);
      if (new Set(purls).size > 1) throw new Error('Conflicting package URLs in an SPDX package. Correct the source SBOM.');
      rows.push({name: c.name, version: c.versionInfo, purl: purls[0]});
    }
  } else if (root.format === 'planetslam-inventory' && root.version === 1 && Array.isArray(root.packages) && root.packages.length <= 2000) {
    format = 'PlanetSlam inventory';
    for (const c of root.packages) {if (!obj(c)) throw new Error('Invalid inventory package.'); rows.push({name:c.name,version:c.version,purl:c.purl,ecosystem:c.ecosystem});}
  } else throw new Error('Supported JSON: CycloneDX 1.4–1.7, SPDX 2.2/2.3, or PlanetSlam inventory v1.');
  const unique = new Map<string, EnvironmentPackage>(); let duplicates = 0;
  for (const row of rows) {
    const purl = purlIdentity(row.purl); const named = clean(row.name,240);
    if (!named && !purl?.name) throw new Error('A component has no usable name. No packages were imported.');
    const explicit = ECOSYSTEMS.includes(row.ecosystem as Ecosystem) ? row.ecosystem as Ecosystem : 'Unknown';
    const rawVersion = typeof row.version === 'string' && !['NOASSERTION','NONE'].includes(row.version) ? clean(row.version,120) : '';
    const ecosystem = purl?.ecosystem ?? explicit;
    const name = packageIdentity(ecosystem,purl?.name || named);
    const version = rawVersion || purl?.version || '';
    let note = purl?.problem || (ecosystem === 'Unknown' ? 'No supported package identity; version applicability is unknown.' : '');
    if (purl && named && packageIdentity(ecosystem,ecosystem==='Maven'?named.replace(/\/(?=[^/]+$)/,':'):named)!==purl.name) note = 'SBOM name differs from PURL identity; resolve it manually.';
    if (row.purl && !purl) note = 'Invalid PURL; resolve identity manually before lookup.';
    if (purl?.version && rawVersion && purl.version !== rawVersion) note = 'SBOM and PURL versions conflict; resolve identity manually.';
    if (ecosystem!=='Unknown' && (!validPackageName(ecosystem,name) || version && !exactEnvironmentVersion(version))) note = 'Package identity or version is not a supported exact identifier.';
    if (typeof row.name==='string'&&row.name.trim().length>240 || typeof row.version==='string'&&row.version.trim().length>120 || name.length>240 || version.length>120) throw new Error('A package name/version exceeds the supported size; nothing was saved.');
    const p: EnvironmentPackage = {id: crypto.randomUUID(), asset: clean(asset,100) || 'My environment', name, version, ecosystem, identityNote: note, importedAt: now};
    const key = JSON.stringify([p.asset,identityKey(p),note]);
    if (unique.has(key)) duplicates++; else unique.set(key,p);
  }
  if (unique.size > INVENTORY_LIMIT) throw new Error('Import exceeds 500 unique packages. Split the inventory; nothing has been saved.');
  const packages = [...unique.values()]; if (!packages.length) throw new Error('No software components were found.');
  return {format,packages,duplicates,missingVersions:packages.filter(p=>!p.version).length,unidentified:packages.filter(p=>p.ecosystem==='Unknown'||!!p.identityNote).length};
}
export function mergeEnvironmentImport(s: EnvironmentStore, preview: InventoryPreview, replaceAsset = false): EnvironmentStore {
  const existing = new Map(s.packages.map(p=>[JSON.stringify([p.asset,identityKey(p),p.identityNote]),p]));
  const base = replaceAsset ? s.packages.filter(p=>p.asset!==preview.packages[0]?.asset) : s.packages;
  const seen = new Set(base.map(p=>JSON.stringify([p.asset,identityKey(p),p.identityNote])));
  const added = preview.packages.filter(p=>!seen.has(JSON.stringify([p.asset,identityKey(p),p.identityNote]))).map(p=>({...p,id:existing.get(JSON.stringify([p.asset,identityKey(p),p.identityNote]))?.id??p.id}));
  if (base.length + added.length > INVENTORY_LIMIT) throw new Error('The combined inventory exceeds 500 packages. Remove entries or use a smaller import.');
  return {...s,packages:[...base,...added]};
}
export function lookupPlan(s: EnvironmentStore, packageIds: string[]): EnvironmentPackage[] {
  const selected = new Set(packageIds); const unique = new Map<string,EnvironmentPackage>();
  for (const p of s.packages) if (selected.has(p.id) && canLookupPackage(p)) unique.set(identityKey(p),p);
  return [...unique.values()].slice(0,25);
}
export function parseEnvironment(raw: string | null): EnvironmentStore | null {
  if (raw === null) return emptyEnvironment();
  if (raw.length > 2500000) return null;
  const pkg = (p: unknown): p is EnvironmentPackage => obj(p) && text(p.id,80) && /^[\w-]+$/.test(p.id) && text(p.asset,100) && text(p.name,240) && !!p.name && text(p.version,120) && ECOSYSTEMS.includes(p.ecosystem as Ecosystem) && text(p.identityNote,200) && stamp(p.importedAt);
  const advisory = (a: unknown): a is EnvironmentAdvisory => obj(a) && text(a.id,100) && /^[\w.-]+$/.test(a.id) && text(a.summary,800) && Array.isArray(a.aliases) && a.aliases.length<=30 && a.aliases.every(v=>text(v,100)) && text(a.modified,40) && text(a.published,40) && environmentUrl(a.url) && stamp(a.observedAt) && Array.isArray(a.fixes) && a.fixes.length<=20 && a.fixes.every(v=>text(v,120));
  try {
    const s = JSON.parse(raw) as EnvironmentStore;
    if (!s || s.version!==1 || !Array.isArray(s.packages) || s.packages.length>INVENTORY_LIMIT || !s.packages.every(pkg) || new Set(s.packages.map(p=>p.id)).size!==s.packages.length
      || !Array.isArray(s.lookups) || s.lookups.length>LOOKUP_LIMIT || !s.lookups.every(l=>l && text(l.key,600) && text(l.name,240) && text(l.version,120) && ECOSYSTEMS.includes(l.ecosystem) && l.key===identityKey(l) && stamp(l.at) && ['complete','partial','failed'].includes(l.status) && text(l.message,300) && Array.isArray(l.advisories) && l.advisories.length<=50 && l.advisories.every(advisory))
      || new Set(s.lookups.map(l=>l.key)).size!==s.lookups.length || s.lookups.reduce((n,l)=>n+l.advisories.length,0)>500
      || !Array.isArray(s.tasks) || s.tasks.length>TASK_LIMIT || !s.tasks.every(t=>t && text(t.id,80) && /^[\w-]+$/.test(t.id) && text(t.packageId,80) && pkg(t.packageSnapshot) && advisory(t.advisory) && stamp(t.lookupAt) && ['open','in-progress','resolved','accepted'].includes(t.status) && text(t.owner,100) && text(t.due,10) && (!t.due || /^\d{4}-\d{2}-\d{2}$/.test(t.due) && new Date(t.due+'T00:00:00Z').toISOString().slice(0,10)===t.due) && text(t.notes,4000) && stamp(t.createdAt) && stamp(t.updatedAt))
      || new Set(s.tasks.map(t=>t.id)).size!==s.tasks.length) return null;
    return s;
  } catch { return null; }
}
export function pinEnvironmentTask(s: EnvironmentStore, p: EnvironmentPackage, a: EnvironmentAdvisory): EnvironmentStore {
  if (s.tasks.length >= TASK_LIMIT) throw new Error('The 200-task remediation limit is reached.');
  if (s.tasks.some(t=>t.packageId===p.id && identityKey(t.packageSnapshot)===identityKey(p) && t.advisory.id===a.id)) throw new Error('This package/version and advisory already have a remediation task.');
  const now = Date.now();
  return {...s,tasks:[{id:crypto.randomUUID(),packageId:p.id,packageSnapshot:structuredClone(p),advisory:structuredClone(a),lookupAt:a.observedAt,status:'open',owner:'',due:'',notes:'',createdAt:now,updatedAt:now},...s.tasks]};
}
export function environmentExport(s: EnvironmentStore): string {
  return JSON.stringify({format:'planetslam-environment-export',version:1,exportedAt:Date.now(),coverage:'User-declared inventory and OSV version-query snapshots. Not a scanner, proof of compromise, or a complete vulnerability assessment. Resolved/accepted are manual workflow states. No automatic validation of deployments or fixes.',privacy:'Contains private inventory, asset labels and remediation notes.',environment:s},null,2);
}
export function remediationCsv(s: EnvironmentStore): string {
  const cell = (v: unknown) => {let x=String(v??'');if(/^[\s\u0000-\u001f]*[=+@-]/u.test(x)||/^[\t\r\n]/u.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"';};
  return '\uFEFF'+[['asset','package','ecosystem','version','advisory','status','owner','due','notes','source_url','lookup_at_utc','coverage'],...s.tasks.map(t=>[t.packageSnapshot.asset,t.packageSnapshot.name,t.packageSnapshot.ecosystem,t.packageSnapshot.version,t.advisory.id,t.status,t.owner,t.due,t.notes,t.advisory.url,new Date(t.lookupAt).toISOString(),'Manual remediation workflow; verify applicability and deployed fixes.'])].map(r=>r.map(cell).join(',')).join('\r\n');
}
