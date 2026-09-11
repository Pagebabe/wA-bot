import { spawnSync } from 'node:child_process';

function audit(args,label){
  const r=spawnSync('npm',['audit',...args,'--json'],{encoding:'utf8',maxBuffer:8*1024*1024});
  let data;
  try{data=JSON.parse(r.stdout||'{}');}catch{console.log(`dependency-audit ${label}: unavailable (status ${r.status})`);return;}
  const meta=data.metadata?.vulnerabilities||{};
  console.log(`dependency-audit ${label}: total=${meta.total||0} critical=${meta.critical||0} high=${meta.high||0} moderate=${meta.moderate||0} low=${meta.low||0}`);
  for(const [name,v] of Object.entries(data.vulnerabilities||{})){
    if(!['critical','high'].includes(v.severity)) continue;
    const via=(v.via||[]).map(x=>typeof x==='string'?x:(x.title||x.name||x.url||'advisory')).join(' | ');
    const fix=typeof v.fixAvailable==='object'?JSON.stringify(v.fixAvailable):String(v.fixAvailable);
    console.log(`dependency-audit ${label} ${v.severity}: ${name} range=${v.range||'?'} via=${via} fix=${fix}`);
  }
}

audit(['--omit=dev'],'production');
audit([],'all');

const ls=spawnSync('npm',['ls','glob','--all','--json'],{encoding:'utf8',maxBuffer:8*1024*1024});
try{
  const tree=JSON.parse(ls.stdout||'{}');
  const paths=[];
  function walk(node,path){
    for(const [name,dep] of Object.entries(node?.dependencies||{})){
      const next=[...path,`${name}@${dep.version||'?'}`];
      if(name==='glob')paths.push(next.join(' > '));
      walk(dep,next);
    }
  }
  walk(tree,[`${tree.name||'root'}@${tree.version||'?'}`]);
  for(const p of paths)console.log(`dependency-audit glob-path: ${p}`);
}catch{}
