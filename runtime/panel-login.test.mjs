import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('./',import.meta.url));
test('browser panel script parses before owner login is attempted',()=>{
  assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',root+'panel.js'],{stdio:'pipe'}));
});
test('login errors are visible inside access card and password toggle remains wired',()=>{
  const html=readFileSync(root+'panel.html','utf8');
  const js=readFileSync(root+'panel.js','utf8');
  assert.match(html,/<form id="login-form">[\s\S]*?<\/form><p id="message" role="alert"/);
  assert.match(js,/\$\('toggle-password'\)\.addEventListener\('click'/);
  assert.match(js,/\$\('message'\)\.hidden=false/);
});
