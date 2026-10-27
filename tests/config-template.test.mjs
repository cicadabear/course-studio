import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {config,openStore,PROJECT} from '../store.mjs';

test('configuration template is local by default and databases cannot be created in any media folder',()=>{
  const example=JSON.parse(fs.readFileSync(path.join(PROJECT,'config.example.json'),'utf8'));
  assert.equal(example.host,'127.0.0.1');assert.deepEqual(example.trustedProxies,[]);assert.deepEqual(example.publicHosts,[]);
  assert.ok(example.collections.some(source=>source.shelf==='courses'));assert.ok(example.collections.some(source=>source.shelf==='youth'));
  for(const root of [config.mediaRoot,...(config.mediaRoots||[])])assert.throws(()=>openStore(path.join(root,'forbidden-test.sqlite')),/outside media/);
});
