import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {openStore,PROJECT} from '../store.mjs';
import {createApp} from '../server.mjs';
import {scan} from '../scanner.mjs';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

test('named-user sharing grants expiring, revocable account sessions with an atomic opening limit',async t=>{
  const temp=await fs.mkdtemp(path.join(PROJECT,'artifacts','login-shares-')),source=path.join(temp,'media');
  await fs.mkdir(path.join(source,'老师《账号分享》'),{recursive:true});await fs.writeFile(path.join(source,'老师《账号分享》','01 课时.mp3'),'test media');
  let db=openStore(path.join(temp,'qa.sqlite')),clock=Date.now(),server,origin;
  await scan(db,source,()=>{});const lesson=db.prepare('SELECT * FROM lessons LIMIT 1').get(),users={};
  for(const name of ['Jack','Mary','Bob']){const token=crypto.randomBytes(32).toString('hex'),id=Number(db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run(name,'unused',clock).lastInsertRowid);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),id,clock+30*86400000);users[name]={id,cookie:'sid='+token};}
  const start=async()=>{server=createApp(db,source,{clock:()=>clock});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port};await start();
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();assert.ok(temp.startsWith(path.join(PROJECT,'artifacts')+path.sep));await fs.rm(temp,{recursive:true,force:true})});
  const request=async(route,{method='GET',data,cookie,headers={}}={})=>{const res=await fetch(origin+route,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:data?JSON.stringify(data):undefined});const text=await res.text();return{status:res.status,headers:res.headers,data:method!=='HEAD'&&res.headers.get('content-type')?.includes('json')?JSON.parse(text):text}};
  const create=async(values={})=>{const result=await request('/api/login-shares',{method:'POST',cookie:users.Jack.cookie,data:{lessonId:lesson.id,targetUsername:' mary ',...values}});assert.equal(result.status,201);return{...result.data,token:result.data.path.split('.')[1]}};
  const open=(share,cookie,headers)=>request('/api/login-shares/'+share.id+'/open',{method:'POST',cookie,data:{token:share.token,targetUsername:'Jack'},headers});
  const count=share=>db.prepare('SELECT open_count FROM login_shares WHERE id=?').get(share.id).open_count;
  let share,linkedCookie;
  await t.test('only jack can create/list/revoke and only existing users and active lessons can be targeted',async()=>{
    assert.equal((await request('/api/login-shares',{method:'POST',data:{lessonId:lesson.id,targetUsername:'Mary'}})).status,401);
    assert.equal((await request('/api/login-shares',{method:'POST',cookie:users.Bob.cookie,data:{lessonId:lesson.id,targetUsername:'Mary'}})).status,403);
    for(const values of [{targetUsername:'missing'},{targetUsername:'<script>'},{targetUsername:''},{targetUsername:null},{hours:0},{hours:169},{maxOpens:0},{maxOpens:101},{lessonId:'invalid'}]){const result=await request('/api/login-shares',{method:'POST',cookie:users.Jack.cookie,data:{lessonId:lesson.id,targetUsername:'Mary',...values}});assert.ok([400,404].includes(result.status));}
    assert.equal((await request('/api/login-shares',{method:'POST',cookie:users.Jack.cookie,data:{lessonId:lesson.id,targetUsername:'Mary'},headers:{Origin:'https://evil.example.test'}})).status,403);
    share=await create();assert.equal(share.expiresAt-clock,7*86400000);assert.equal(share.maxOpens,10);assert.equal(share.targetUsername,'Mary');assert.equal(count(share),0);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM login_shares').all()).includes(share.token));
    const list=await request('/api/login-shares?lessonId='+lesson.id,{cookie:users.Jack.cookie});assert.equal(list.data.shares[0].targetUsername,'Mary');assert.ok(!JSON.stringify(list.data).includes(share.token));assert.ok(!JSON.stringify(list.data).includes('password'));
    assert.equal((await request('/api/login-shares?lessonId='+lesson.id,{cookie:users.Bob.cookie})).status,403);
  });
  await t.test('page previews cannot consume a login and bad secrets do not create sessions',async()=>{
    for(const method of ['GET','HEAD']){const page=await request('/share-login',{method});assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.ok(page.headers.get('x-robots-tag').includes('noindex'));}
    assert.equal(count(share),0);const route='/api/login-shares/'+share.id+'/open';
    assert.equal((await request(route)).status,405);assert.equal((await request(route,{method:'POST',data:{token:'0'.repeat(64)}})).status,404);assert.equal(count(share),0);
  });
  await t.test('opening logs into the named account, saves its learning data and reuses the issued session',async()=>{
    const opened=await open(share);assert.equal(opened.status,200);assert.equal(opened.data.user.username,'Mary');assert.equal(opened.data.user.id,users.Mary.id);assert.equal(opened.data.path,'/#course/'+lesson.course_id+'?lesson='+lesson.id);
    const cookie=opened.headers.get('set-cookie');assert.match(cookie,/^sid=/);assert.match(cookie,/HttpOnly; SameSite=Lax; Path=\/; Max-Age=604800$/);linkedCookie=cookie.split(';')[0];
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM sessions').all()).includes(linkedCookie.split('=')[1]));
    assert.equal((await request('/api/me',{cookie:linkedCookie})).data.user.username,'Mary');
    assert.equal((await request('/api/courses/'+lesson.course_id+'/favorite',{method:'PUT',cookie:linkedCookie,data:{}})).status,200);
    assert.equal(db.prepare('SELECT user_id FROM course_favorites').get().user_id,users.Mary.id);
    assert.equal((await open(share,linkedCookie)).headers.get('set-cookie'),null);assert.equal(count(share),1);
    const secure=await open(await create(),undefined,{'X-Forwarded-Proto':'https'});assert.match(secure.headers.get('set-cookie'),/; Secure$/);
  });
  await t.test('the link switches a different logged-in browser into the fixed target, not a client-supplied username',async()=>{
    const another=await create(),opened=await open(another,users.Bob.cookie);assert.equal(opened.data.user.username,'Mary');
    const switched=opened.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/me',{cookie:switched})).data.user.username,'Mary');assert.equal((await request('/api/me',{cookie:users.Bob.cookie})).data.user.username,'Bob');
  });
  await t.test('concurrent browsers respect the quota while admitted sessions still work',async()=>{
    const limited=await create({maxOpens:3}),responses=await Promise.all(Array.from({length:12},()=>open(limited)));
    assert.equal(responses.filter(r=>r.status===200).length,3);assert.equal(responses.filter(r=>r.status===410).length,9);assert.equal(count(limited),3);
    const cookie=responses.find(r=>r.status===200).headers.get('set-cookie').split(';')[0];assert.equal((await open(limited,cookie)).status,200);assert.equal(count(limited),3);
  });
  await t.test('revocation survives restart, ends only link-issued sessions and preserves normal password sessions',async()=>{
    server.closeAllConnections();await new Promise(r=>server.close(r));db.close();db=openStore(path.join(temp,'qa.sqlite'));await start();assert.equal((await request('/api/me',{cookie:linkedCookie})).data.user.username,'Mary');
    const route='/api/login-shares/'+share.id;
    assert.equal((await request(route,{method:'DELETE',cookie:users.Bob.cookie,data:{}})).status,403);
    assert.equal((await request(route,{method:'DELETE',cookie:users.Jack.cookie,data:{}})).status,200);
    assert.equal((await request('/api/me',{cookie:linkedCookie})).data.user,null);assert.equal((await request('/api/catalog',{cookie:linkedCookie})).status,401);assert.equal((await open(share)).status,410);
    assert.equal((await request('/api/me',{cookie:users.Mary.cookie})).data.user.username,'Mary');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM login_share_sessions WHERE share_id=?').get(share.id).n,0);
  });
  await t.test('logout releases its session and removing the link owner cannot leave an authenticated orphan',async()=>{
    const logoutShare=await create(),opened=await open(logoutShare),cookie=opened.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/logout',{method:'POST',cookie,data:{}})).status,200);assert.equal((await request('/api/me',{cookie})).data.user,null);assert.equal((await open(logoutShare,cookie)).status,200);assert.equal(count(logoutShare),2);
    const expiry=await create({hours:1}),admitted=await open(expiry),expCookie=admitted.headers.get('set-cookie').split(';')[0];
    clock=expiry.expiresAt;
    assert.equal((await request('/api/me',{cookie:expCookie})).data.user,null);assert.equal((await open(expiry)).status,410);assert.equal((await request('/api/me',{cookie:users.Mary.cookie})).data.user.username,'Mary');
    const ownerLink=await create(),ownerOpened=await open(ownerLink),ownerCookie=ownerOpened.headers.get('set-cookie').split(';')[0];
    db.prepare('DELETE FROM users WHERE id=?').run(users.Jack.id);
    assert.equal((await request('/api/me',{cookie:ownerCookie})).data.user,null);assert.equal((await request('/api/me',{cookie:users.Mary.cookie})).data.user.username,'Mary');
  });
});
