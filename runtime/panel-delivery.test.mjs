import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html=await readFile(new URL('./panel.html',import.meta.url),'utf8');
const js=await readFile(new URL('./panel.js',import.meta.url),'utf8');

test('panel offers an owner-readable delivery summary without technical jargon',()=>{
  for(const label of ['Proyecto trabajado','Qué problema se encontró','Qué se corrigió realmente','Qué archivos se modificaron','Qué quedó pendiente','Pruebas','Estado de los cambios'])
    assert.ok(js.includes(label),`missing owner summary field: ${label}`);
  assert.match(js,/No se ejecutaron pruebas automáticas: el resultado NO está verificado\./);
});

test('panel never shows invented links and states pending GitHub delivery',()=>{
  assert.match(js,/startsWith\('https:\/\/github\.com\/'\)/);
  assert.match(js,/Cambios preparados, pendientes de enviar a GitHub\./);
  assert.doesNotMatch(js,/(?:'|")https:\/\/github\.com\/'+t\.branch/);
});

test('review buttons exist and approval is limited to the next stage',()=>{
  for(const label of ['Ver resultado','Solicitar corrección','Aprobar cambios'])assert.ok(js.includes(label),`missing button: ${label}`);
  assert.match(js,/Aprobar autoriza únicamente la siguiente etapa de revisión\. No publica los cambios en producción\./);
  assert.match(html,/<details[^>]*><summary>Detalles técnicos \(opcional\)<\/summary>/);
  assert.doesNotMatch(html,/<details[^>]*open/);
});

test('correction flow reuses the previous task instead of starting from zero',()=>{
  assert.match(js,/CORRECCIÓN DE ENTREGA ANTERIOR \('/);
  assert.match(js,/Revisa el resultado de la tarea anterior/);
  assert.match(js,/PROYECTO_NO_DISPONIBLE/);
});
