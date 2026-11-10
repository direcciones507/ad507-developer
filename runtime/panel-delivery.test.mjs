import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const js=await readFile(new URL('./panel.js',import.meta.url),'utf8');
test('owner sees delivery facts and truthful review status',()=>{
  for(const label of ['Proyecto trabajado','Problema identificado','Corrección realizada','Archivos modificados','Pendiente','Pruebas','Estado','Ver resultado'])
    assert.ok(js.includes(label),label);
  assert.ok(js.includes('Cambios preparados, pendientes de enviar a GitHub.'));
  assert.ok(js.includes('resultado sin verificar.'));
});
test('only the original approval control remains',()=>{
  assert.ok(js.includes("actions.push(['approve'"));
  assert.equal((js.match(/action:'approve'/g)||[]).length,0);
});
