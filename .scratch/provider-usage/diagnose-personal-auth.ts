import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { claudeProfiles } from '../../extensions/lib/claude-profiles.ts';
import { resolveLaunch } from '../../extensions/lib/provider-usage/readers.ts';
for (const profile of Object.values(claudeProfiles())) {
 const env={...process.env,CLAUDE_CONFIG_DIR:profile.configDir}; delete env.ANTHROPIC_API_KEY;
 const launch=resolveLaunch({command:'claude',args:['auth','status','--json']});
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(launch.file,launch.args,{env,stdio:'pipe',windowsHide:true}); let output='';
  const timer=setTimeout(()=>{child.kill();reject(new Error('auth status timeout'));},30000);
  child.stdin.end(); child.stdout.setEncoding('utf8'); child.stdout.on('data',c=>output+=c);child.stderr.on('data',()=>{});
  child.on('error',reject);child.on('close',code=>{clearTimeout(timer);let status;try {const r=JSON.parse(output);status={keys:Object.keys(r),loggedIn:r.loggedIn,authMethod:r.authMethod,apiProvider:r.apiProvider,subscriptionType:r.subscriptionType,tokenSource:r.tokenSource,apiKeySource:r.apiKeySource,error:r.error};}catch{status={parseFailed:true};}
   console.log(JSON.stringify({profile:profile.id,configDir:profile.configDir,credentialsFileExists:existsSync(path.join(profile.configDir,'.credentials.json')),profileConfigExists:existsSync(path.join(profile.configDir,'.claude.json')),exitCode:code,status}));resolve();
  });
 });
}
