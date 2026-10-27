import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {openStore,PROJECT} from '../store.mjs';
import {createApp} from '../server.mjs';

test('server has no native certificate loading or secondary HTTPS listener',async()=>{
  const source=await fs.readFile(new URL('../server.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/node:https|https\.createServer|config\.tlsDir|config\.tlsPort|TLS_PORT|server\.key|server\.crt/);
});

test('HTTPS reverse proxies still receive Secure login cookies over an HTTP upstream',async t=>{
  const temp=await fs.mkdtemp(path.join(PROJECT,'artifacts','proxy-cookie-'));
  const db=openStore(path.join(temp,'test.sqlite'));
  const server=createApp(db,temp,{trustedProxies:['127.0.0.1']});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();assert.ok(temp.startsWith(path.join(PROJECT,'artifacts')+path.sep));await fs.rm(temp,{recursive:true,force:true})});
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=salt+':'+crypto.scryptSync('proxy-cookie-test-only',salt,64).toString('hex');
  db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run('ProxyCookieQA',hash,Date.now());
  for(const proto of ['https','http']){
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/login',{
      method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'203.0.113.10','X-Forwarded-Proto':proto},
      body:JSON.stringify({username:'ProxyCookieQA',password:'proxy-cookie-test-only'})});
    assert.equal(response.status,200);
    assert.equal(/; Secure(?:;|$)/.test(response.headers.get('set-cookie')),proto==='https');
  }
});
