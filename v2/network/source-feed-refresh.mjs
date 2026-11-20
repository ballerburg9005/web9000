// Offline/opt-in operator command. Explicitly stages HTTPS snapshots; does NOT
// sign, publish, restart a peer, or install a browser-default trust source.
// Usage:
// node source-feed-refresh.mjs stage /private/plan.json /private/staging-root
import {readFile,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {stageSourceRefresh} from './source-refresh-stage.mjs';
const [mode,planPath,stagingRoot]=process.argv.slice(2);
if(mode!=='stage'||!isAbsolute(planPath||'')||
   !isAbsolute(stagingRoot||'')||process.argv.length!==5)
 throw Error('Usage: source-feed-refresh.mjs stage /absolute/operator-private-plan.json /absolute/private-staging-root');
const stat=await lstat(planPath);
if(!stat.isFile()||stat.size>16000||(stat.mode&0o077)!==0)
 throw Error('Source refresh plan must be a private regular 0600 JSON file');
const plan=JSON.parse(await readFile(planPath,'utf8'));
const result=await stageSourceRefresh(plan,stagingRoot);
console.log(JSON.stringify({
 ok:true,stagingDirectory:result.directory,
 sourcesFile:result.sourcesFile,
 snapshots:result.manifest.sources.map(item=>({
  uri:item.uri,category:item.category,license:item.license,
  sha256:item.sha256,bytes:item.bytes,retrievedAt:item.retrievedAt,
  path:item.file
 })),
 notice:'Staged ONLY: operator must check source licenses/diff and separately run source-feed-import + source-feed-operator update --sources, then explicitly reload their opt-in peer'
}));
