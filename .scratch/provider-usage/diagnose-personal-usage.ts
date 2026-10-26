import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { claudeProfiles } from '../../extensions/lib/claude-profiles.ts';
import { readClaudeUsageAt } from '../../extensions/lib/provider-usage/claude.ts';
import { runProcess } from '../../extensions/lib/provider-usage/readers.ts';
import { parseClaude } from '../../extensions/lib/provider-usage/model.ts';
const tmp=await mkdtemp(path.join(os.tmpdir(),'claude-usage-diagnostic-'));
try {
 const debug=path.join(tmp,'usage.log');
 const raw=await readClaudeUsageAt((request,signal)=>runProcess({...request,args:[...request.args,'--debug-file',debug]},signal),AbortSignal.timeout(35000),claudeProfiles().personal.configDir);
 const value=parseClaude(raw);
 assert(value.kind==='spend' && value.windows.some(window=>window.id==='5h') && value.windows.some(window=>window.id==='week'));
 const log=await readFile(debug,'utf8').catch(()=>'');
 const diagnostics=log.split(/\r?\n/).filter(line=>/fetchUtilization: (GET|200|replayed)/.test(line)).map(line=>line.slice(0,250));
 const report=JSON.stringify({verifiedAt:new Date().toISOString(),parentTrafficRestriction:process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,value,diagnostics},null,2);
 console.log(report);
 await writeFile('.scratch/provider-usage/personal-usage-network-evidence.json',report+'\n');
}finally{await rm(tmp,{recursive:true,force:true});}
