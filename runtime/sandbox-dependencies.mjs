// Baked into the reviewed image, not executed from a model-modified checkout.
import { cp, readdir, mkdir, realpath, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
export async function linkDependencies(template='/template',work='/work') {
  async function entries(source,target){
    await mkdir(target,{recursive:true});
    for(const entry of await readdir(source,{withFileTypes:true})){
      const from=join(source,entry.name),to=join(target,entry.name);
      if(entry.isDirectory()&&entry.name.startsWith('@'))await entries(from,to);
      else {
        let destination=from;
        if(entry.isSymbolicLink()){
          const resolved=await realpath(from);
          // Workspace dependencies must point to the modified snapshot, not the baseline source.
          if(resolved.startsWith(template+'/')&&!resolved.includes('/node_modules/'))destination=join(work,resolved.slice(template.length+1));
        }
        await symlink(destination,to);
      }
    }
  }
  async function walk(folder,relative=''){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      if(!entry.isDirectory()||entry.name==='.git')continue;
      const rel=join(relative,entry.name);
      if(entry.name==='node_modules')await entries(join(template,rel),join(work,rel));
      else await walk(join(template,rel),rel);
    }
  }
  await walk(template);
}
if(process.argv[1]==='/opt/ad507-link-deps.mjs'){
  await cp('/source/.','/work',{recursive:true});await linkDependencies();
  const [command,...args]=process.argv.slice(2);if(!command)throw Error('CHECK_COMMAND_REQUIRED');
  const child=spawn(command,args,{cwd:'/work',stdio:'inherit',env:{PATH:process.env.PATH,HOME:'/tmp',NODE_ENV:'test'}});
  child.on('error',()=>process.exit(127));child.on('exit',(code)=>process.exit(code??1));
}
