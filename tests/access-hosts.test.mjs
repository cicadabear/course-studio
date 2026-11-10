import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openStore,PROJECT} from '../store.mjs';
import {createApp,accessHostAllowed} from '../server.mjs';

const allowed=['courses.example.test','other.example.test','192.168.*.*'];
const req=(host,remote='203.0.113.7',headers={})=>({headers:{host,...headers},socket:{remoteAddress:remote}});
test('access addresses match exact domains or valid 192.168 IPv4 literals, with loopback reserved for local callers',()=>{
  for(const host of ['courses.example.test','COURSES.EXAMPLE.TEST:3000','courses.example.test.:7000','other.example.test:7443','192.168.32.56:3000','192.168.0.1','192.168.255.255'])assert.equal(accessHostAllowed(req(host),allowed),true,host);
  for(const host of ['203.0.113.9:3000','[2001:db8::1]:3000','evil.example.test','sub.courses.example.test','courses.example.test.evil.test','evilcourses.example.test','192.168.evil.test','192.168.32.56.evil.test','192.168.999.1','192.168.001.1','0xc0a82038','3232243768','10.0.0.1','localhost','127.0.0.1','[::1]',undefined,'','courses.example.test/path','courses.example.test:0','courses.example.test:65536','courses.example.test?x','user@courses.example.test','courses.example.test,evil.test','%63ourses.example.test'])assert.equal(accessHostAllowed(req(host),allowed),false,host);
  for(const host of ['localhost:3000','127.0.0.1:3000','[::1]:3000']){
    assert.equal(accessHostAllowed(req(host,'127.0.0.1'),allowed),true);
    assert.equal(accessHostAllowed(req(host,'127.0.0.1',{'x-forwarded-for':'203.0.113.7'}),allowed),false);
    assert.equal(accessHostAllowed(req(host,'192.168.32.1',{'x-forwarded-for':'127.0.0.1'}),allowed),false);
  }
  assert.equal(accessHostAllowed(req('evil.test','203.0.113.7',{'x-forwarded-host':'courses.example.test','x-forwarded-for':'127.0.0.1'}),allowed),false);
  assert.equal(accessHostAllowed(req('any.example.test'),[]),true);
});

test('the access gate applies before pages, auth, sharing, health and media; unconfigured preview stays accessible',async t=>{
  const temp=await fs.mkdtemp(path.join(PROJECT,'artifacts','access-hosts-')),db=openStore(path.join(temp,'qa.sqlite'));
  const restricted=createApp(db,temp,{allowedHosts:allowed}),preview=createApp(db,temp,{allowedHosts:[]});
  await Promise.all([restricted,preview].map(server=>new Promise(r=>server.listen(0,'127.0.0.1',r))));
  t.after(async()=>{await Promise.all([restricted,preview].map(server=>new Promise(r=>server.close(r))));db.close();await fs.rm(temp,{recursive:true,force:true})});
  const request=(server,host,url='/',method='GET',headers={})=>new Promise((resolve,reject)=>{
    const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method,headers:{Host:host,...headers}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});request.on('error',reject);request.end();
  });
  for(const url of ['/','/app.js','/share','/api/health','/api/me','/api/catalog','/media/'+'a'.repeat(24)]){
    assert.equal(await request(restricted,'203.0.113.9:3000',url),403,url);
    assert.equal(await request(restricted,'evil.test',url,'HEAD'),403,url);
  }
  for(const url of ['/api/login','/api/register','/api/shares'])assert.equal(await request(restricted,'203.0.113.9',url,'POST'),403);
  for(const host of ['courses.example.test:3000','other.example.test:7000','192.168.32.56:3000'])assert.equal(await request(restricted,host,'/api/health','GET',{'X-Forwarded-For':'203.0.113.7'}),200);
  assert.equal(await request(restricted,'127.0.0.1:3000','/api/health'),200);
  assert.equal(await request(restricted,'127.0.0.1:3000','/api/health','GET',{'X-Forwarded-For':'203.0.113.7'}),403);
  assert.equal(await request(restricted,'203.0.113.9','/','GET',{'X-Forwarded-Host':'courses.example.test'}),403);
  assert.equal(await request(preview,'203.0.113.9','/'),200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);
});
