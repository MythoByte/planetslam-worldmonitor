import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewEnvironmentImport,emptyEnvironment,mergeEnvironmentImport,manualEnvironmentPackage,canLookupPackage,identityKey,lookupPlan,parseEnvironment,pinEnvironmentTask,environmentExport,remediationCsv,type EnvironmentAdvisory} from '../src/services/cyber-environment-model';
const cdx=(components:unknown[])=>JSON.stringify({bomFormat:'CycloneDX',specVersion:'1.6',components});
const component=(patch={})=>({name:'lodash',version:'4.17.19',purl:'pkg:npm/lodash@4.17.19',...patch});
const imported=()=>previewEnvironmentImport(cdx([component()]),'Synthetic server');
const advisory:EnvironmentAdvisory={id:'GHSA-synthetic-0001',summary:'Synthetic advisory, not a real vulnerability.',aliases:['CVE-2026-99999'],modified:'2026-11-07T00:00:00Z',published:'2026-11-06T00:00:00Z',url:'https://osv.dev/vulnerability/GHSA-synthetic-0001',fixes:['4.17.21'],observedAt:Date.now()};
test('CycloneDX imports nested components and only declared software identity; private metadata is discarded',()=>{
 const preview=previewEnvironmentImport(cdx([{...component(),properties:[{name:'secret',value:'PRIVATE-SBOM-METADATA'}],components:[component({name:'@scope/package',version:'1.2.3',purl:'pkg:npm/%40scope/package@1.2.3'})]}]),'Host label');
 assert.equal(preview.packages.length,2);assert.equal(preview.packages[1]!.name,'@scope/package');assert.ok(preview.packages.every(canLookupPackage));assert.ok(!JSON.stringify(preview).includes('PRIVATE-SBOM-METADATA'));
});
test('SPDX 2.3 purls and normalized PyPI, Maven and cargo names map to exact registry identities',()=>{
 const raw=JSON.stringify({spdxVersion:'SPDX-2.3',packages:[{name:'Jinja2',versionInfo:'3.1.4',externalRefs:[{referenceType:'purl',referenceLocator:'pkg:pypi/jinja2@3.1.4'}]}]});const p=previewEnvironmentImport(raw,'test').packages[0]!;assert.equal(p.ecosystem,'PyPI');assert.equal(p.name,'jinja2');assert.ok(canLookupPackage(p));
 const m=previewEnvironmentImport(cdx([component({group:'org.apache.commons',name:'commons-text',version:'1.9',purl:'pkg:maven/org.apache.commons/commons-text@1.9'})]),'test').packages[0]!;assert.equal(m.name,'org.apache.commons:commons-text');assert.ok(canLookupPackage(m));
 assert.equal(manualEnvironmentPackage({name:'FOO_BAR',version:'1.2.3',ecosystem:'crates.io',asset:'a'}).name,'foo-bar');
});
test('missing, conflicting, qualified, malformed and unsupported identities stay unknown rather than silently becoming queryable',()=>{
 for(const patch of [{version:'latest',purl:'pkg:npm/lodash@latest'},{version:'4.17.19',purl:'pkg:npm/lodash@4.17.21'},{purl:'pkg:deb/debian/lodash@4.17.19'},{purl:'pkg:constructor/lodash@4.17.19'},{purl:'pkg:npm/lodash@4.17.19?repository_url=https%3A%2F%2Fprivate.example'},{name:'express'},{purl:'pkg:pypi/foo%2fbar@4.17.19'}])assert.equal(canLookupPackage(previewEnvironmentImport(cdx([component(patch)]),'a').packages[0]!),false);
 const missing=previewEnvironmentImport(cdx([{name:'vendor product'}]),'a');assert.equal(missing.missingVersions,1);assert.equal(missing.unidentified,1);
 assert.throws(()=>manualEnvironmentPackage({asset:'a',name:'lodash',version:'^4.17.0',ecosystem:'npm'}),/exact/);
});
test('duplicate imports and asset replacement preserve stable IDs and keep other assets and pinned remediation evidence',()=>{
 let s=mergeEnvironmentImport(emptyEnvironment(),imported());const id=s.packages[0]!.id;s=pinEnvironmentTask(s,s.packages[0]!,advisory);s=mergeEnvironmentImport(s,previewEnvironmentImport(cdx([component()]),'Other asset'));
 const next=mergeEnvironmentImport(s,imported(),true);assert.equal(next.packages.length,2);assert.equal(next.packages.find(p=>p.asset==='Synthetic server')!.id,id);assert.equal(next.tasks.length,1);
 const updated=mergeEnvironmentImport(next,previewEnvironmentImport(cdx([component({version:'4.17.21',purl:'pkg:npm/lodash@4.17.21'})]),'Synthetic server'),true);assert.equal(updated.packages.length,2);assert.equal(updated.tasks[0]!.packageSnapshot.version,'4.17.19');assert.equal(updated.tasks[0]!.status,'open');
});
test('lookup plans deduplicate exact identities across assets, omit unknowns, and cap at 25',()=>{
 const packages=Array.from({length:30},(_,i)=>manualEnvironmentPackage({asset:'a',name:`package-${i}`,version:'1.0.0',ecosystem:'npm'}));packages.push({...packages[0]!,id:crypto.randomUUID(),asset:'b'},manualEnvironmentPackage({asset:'a',name:'Vendor appliance',version:'2026',ecosystem:'Unknown'}));
 const plan=lookupPlan({...emptyEnvironment(),packages},packages.map(p=>p.id));assert.equal(plan.length,25);assert.equal(new Set(plan.map(identityKey)).size,25);assert.ok(plan.every(canLookupPackage));
});
test('unsupported documents, ambiguous purls, invalid JSON and oversized inventories fail without partial import',()=>{
 assert.throws(()=>previewEnvironmentImport('<xml/>','a'),/JSON/);assert.throws(()=>previewEnvironmentImport('{}','a'),/Supported/);assert.throws(()=>previewEnvironmentImport(cdx(Array.from({length:501},(_,n)=>component({name:`pkg-${n}`,purl:`pkg:npm/pkg-${n}@4.17.19`}))),'a'),/500/);
 assert.throws(()=>previewEnvironmentImport(JSON.stringify({spdxVersion:'SPDX-2.3',packages:[{name:'x',externalRefs:[{referenceType:'purl',referenceLocator:'pkg:npm/x@1.0.0'},{referenceType:'purl',referenceLocator:'pkg:npm/y@1.0.0'}]}]}),'a'),/Conflicting/);
 assert.throws(()=>previewEnvironmentImport(' '.repeat(5*1024*1024+1),'a'),/5 MiB/);
});
test('validated local state rejects corrupt structures, unsafe URLs and invalid task dates',()=>{
 let s=mergeEnvironmentImport(emptyEnvironment(),imported());s=pinEnvironmentTask(s,s.packages[0]!,advisory);assert.ok(parseEnvironment(JSON.stringify(s)));
 for(const bad of [{...s,packages:null},{...s,packages:[s.packages[0],s.packages[0]]},{...s,tasks:[{...s.tasks[0],due:'2026-02-30'}]},{...s,tasks:[{...s.tasks[0],advisory:{...advisory,url:'javascript:alert(1)'}}]}])assert.equal(parseEnvironment(JSON.stringify(bad)),null);
 assert.equal(parseEnvironment('{'),null);assert.equal(parseEnvironment('x'.repeat(2500001)),null);
});
test('exports preserve private notes and source dates, and CSV neutralizes spreadsheet formulas',()=>{
 let s=mergeEnvironmentImport(emptyEnvironment(),imported());s=pinEnvironmentTask(s,s.packages[0]!,advisory);s.tasks[0]!.owner=' =HYPERLINK("bad")';s.tasks[0]!.notes='PRIVATE-NOTE, "quoted"\nsecond line';
 const json=JSON.parse(environmentExport(s));assert.equal(json.environment.tasks[0].lookupAt,advisory.observedAt);assert.match(json.environment.tasks[0].notes,/PRIVATE-NOTE/);assert.match(json.coverage,/manual workflow/);
 const csv=remediationCsv(s);assert.match(csv,/' =HYPERLINK/);assert.match(csv,/""quoted""/);assert.match(csv,/PRIVATE-NOTE/);
 assert.throws(()=>pinEnvironmentTask(s,s.packages[0]!,advisory),/already/);
});
