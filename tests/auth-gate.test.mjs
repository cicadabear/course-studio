import test from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openStore,PROJECT} from '../store.mjs';
import {createApp,clientAddress,requestProto,hostIsLocal,hostIsPublic,sameOrigin,isLocalAddress,LOGIN_FAIL_LIMIT} from '../server.mjs';

// 伪造 req 只用来验证地址与协议判定，不涉及网络。
const fake=(socket,headers={})=>({socket,headers});

test('反代头无需代理白名单，取首个访客地址，缺省回退到直连地址',()=>{
  const viaProxy=clientAddress(fake({remoteAddress:'192.168.1.10'},{'x-forwarded-for':'203.0.113.9, 192.168.1.10'}));
  assert.equal(viaProxy.ip,'203.0.113.9');assert.equal(viaProxy.proxied,true);assert.equal(viaProxy.unknown,false);
  const forwarded=clientAddress(fake({remoteAddress:'203.0.113.9'},{'x-forwarded-for':'192.168.1.23'}));
  assert.equal(forwarded.ip,'192.168.1.23');assert.equal(forwarded.proxied,true);
  const realIp=clientAddress(fake({remoteAddress:'127.0.0.1'},{'x-real-ip':'::ffff:192.168.1.23'}));
  assert.equal(realIp.ip,'192.168.1.23');
  const missing=clientAddress(fake({remoteAddress:'192.168.1.10'},{}));
  assert.equal(missing.unknown,false);assert.equal(missing.proxied,false);
  assert.equal(isLocalAddress(missing.ip),true);
});

test('反代终结 TLS 时按 X-Forwarded-Proto 判断协议',()=>{
  assert.equal(requestProto(fake({remoteAddress:'192.168.1.10',encrypted:false},{'x-forwarded-proto':'https'})),'https');
  assert.equal(requestProto(fake({remoteAddress:'192.168.1.10',encrypted:false},{})),'http');
  assert.equal(requestProto(fake({remoteAddress:'203.0.113.9',encrypted:false},{'x-forwarded-proto':'https'})),'https');
  assert.equal(requestProto(fake({encrypted:false},{'x-forwarded-proto':'invalid'})),'http');
});

test('来源与访问地址同时限定为局域网，未配置的公网域名也不能注册',async t=>{
  const sandbox=path.join(PROJECT,'artifacts','gate-'+Date.now());
  await fs.mkdir(sandbox,{recursive:true});
  const db=openStore(path.join(sandbox,'test.sqlite'));
  const server=createApp(db,sandbox,{publicHosts:['courses.example.test']});
  await new Promise(r=>server.listen(0,'0.0.0.0',r));
  const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();await fs.rm(sandbox,{recursive:true,force:true})});
  const post=(url,body,xff)=>fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json',...(xff?{'X-Forwarded-For':xff}:{})},body:JSON.stringify(body)});
  // fetch 不允许改写 Host，用 http.request 才能模拟反代传来的 Host。
  const postHost=(body,xff,host)=>new Promise(resolve=>{
    const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/register',method:'POST',headers:{'Content-Type':'application/json','Host':host,'X-Forwarded-For':xff}},res=>{
      let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:text}));
    });
    req.end(JSON.stringify(body));
  });
  const publicVisitor=await post('/api/register',{username:'PublicVisitor',password:'visitor-password'},'203.0.113.9');
  assert.equal(publicVisitor.status,403);
  assert.match((await publicVisitor.json()).error,/局域网/);
  // 路由器端口映射会把来源改写成路由器局域网地址，此时按 Host 兜底：公网域名一律拒绝。
  const publicHost=await postHost({username:'HairpinnedVisitor',password:'visitor-password'},'192.168.1.1','courses.example.test:9003');
  assert.equal(publicHost.status,403);
  for(const host of ['new-public.example.test:7000','192.168.1.1.evil.example:7000','198.51.100.7:7000']){
    const blocked=await postHost({username:'BlockedVisitor',password:'visitor-password'},'192.168.1.1',host);
    assert.equal(blocked.status,403,host);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE username=?').get('BlockedVisitor').n,0);
    const me=await new Promise((resolve,reject)=>{
      const req=http.get({host:'127.0.0.1',port:server.address().port,path:'/api/me',headers:{Host:host,'X-Forwarded-For':'192.168.1.1'}},res=>{
        let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve(JSON.parse(text)));
      });req.on('error',reject);
    });
    assert.equal(me.canRegister,false,host);
  }
  const noHeader=await post('/api/register',{username:'NoHeaderVisitor',password:'visitor-password'});
  assert.equal(noHeader.status,200);
  const noHeaderPublic=await new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port:server.address().port,path:'/api/me',headers:{Host:'courses.example.test:7000'}},res=>{
      let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve(JSON.parse(text)));
    });req.on('error',reject);
  });
  assert.equal(noHeaderPublic.canRegister,false);
  // 来源和访问地址都是局域网 IP 时仍允许注册。
  const lanViaProxy=await postHost({username:'LanViaProxy',password:'visitor-password'},'192.168.1.1','192.168.1.10:9003');
  assert.equal(lanViaProxy.status,200);
  // 局域网设备直连 3000（不经反代）才允许注册。
  const direct=await fetch('http://127.0.0.1:'+server.address().port+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'LanVisitor',password:'visitor-password'})});
  assert.equal(direct.status,200);
  const me=await fetch(origin+'/api/me',{headers:{'X-Forwarded-For':'203.0.113.9'}}).then(r=>r.json());
  assert.equal(me.canRegister,false);
});

test('同一 IP 密码连错 5 次锁 12 小时，重启服务仍然锁着',async t=>{
  const sandbox=path.join(PROJECT,'artifacts','lock-'+Date.now());
  await fs.mkdir(sandbox,{recursive:true});
  let db=openStore(path.join(sandbox,'test.sqlite'));
  let server=createApp(db,sandbox);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let origin='http://127.0.0.1:'+server.address().port;
  const login=(password,xff='198.51.100.7')=>fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':xff},body:JSON.stringify({username:'GateUser',password})});
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();await fs.rm(sandbox,{recursive:true,force:true})});
  // 注册只对直连局域网开放，所以账号直接建库，登录尝试用公网 IP。
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=salt+':'+crypto.scryptSync('gate-password',salt,64).toString('hex');
  db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run('GateUser',hash,Date.now());
  for(let i=1;i<=LOGIN_FAIL_LIMIT;i++){
    const r=await login('wrong-password-'+i);
    if(i<LOGIN_FAIL_LIMIT){assert.equal(r.status,401);assert.match((await r.json()).error,/剩余尝试/)}
    else{assert.equal(r.status,423);assert.match((await r.json()).error,/12 小时/)}
  }
  // 正确密码也被锁住，说明锁的是 IP 而不是账号尝试结果。
  assert.equal((await login('gate-password')).status,423);
  // 换 IP 不受影响。
  assert.equal((await login('gate-password','198.51.100.8')).status,200);
  await new Promise(r=>server.close(r));db.close();
  db=openStore(path.join(sandbox,'test.sqlite'));
  server=createApp(db,sandbox);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  assert.equal((await login('gate-password')).status,423);
});
test('Origin 校验忽略端口：反代与端口映射不会挡掉登出和进度保存',()=>{
  // 浏览器 Origin 带公网端口，上游 Host 被反代改写，只比较协议与主机名。
  assert.equal(sameOrigin('https://courses.example.test:9003','courses.example.test','https'),true);
  assert.equal(sameOrigin('https://courses.example.test:9003','courses.example.test:9003','https'),true);
  assert.equal(sameOrigin('http://192.168.1.23:3000','192.168.1.23:3000','http'),true);
  assert.equal(sameOrigin(undefined,'192.168.1.23:3000','http'),true);
  // 协议或主机名不同仍然拒绝。
  assert.equal(sameOrigin('http://courses.example.test:9003','courses.example.test','https'),false);
  assert.equal(sameOrigin('https://evil.example.com','courses.example.test','https'),false);
  assert.equal(sameOrigin('not-a-url','courses.example.test','https'),false);
});

test('Host 兜底：拿不到真实 IP 时按 Host 区分公网入口',()=>{
  const hosts=['courses.example.test'];
  assert.equal(hostIsPublic('courses.example.test',hosts),true);
  assert.equal(hostIsPublic('COURSES.Example.Test:9003',hosts),true);
  assert.equal(hostIsPublic('192.168.1.10:9003',hosts),false);
  assert.equal(hostIsPublic('',hosts),false);
});

test('注册访问地址只允许 localhost 或有效的局域网 IP',()=>{
  for(const host of ['localhost:7000','127.0.0.1:3000','192.168.1.23:7000','10.1.2.3','172.20.1.2:3001','[::1]:7000','[fd00::1]:7000'])assert.equal(hostIsLocal(host),true,host);
  for(const host of ['',undefined,'new-public.example.test:7000','localhost.evil.example','192.168.1.23.evil.example','203.0.113.9:7000','192.168.1.23@evil.example','192.168.1.23/path'])assert.equal(hostIsLocal(host),false,String(host));
  assert.equal(isLocalAddress('192.168.evil.example'),false);
  assert.equal(isLocalAddress('10.evil.example'),false);
});
