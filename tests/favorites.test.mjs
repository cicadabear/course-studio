import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {openStore,PROJECT} from '../store.mjs';
import {createApp} from '../server.mjs';

test('favorites are persistent, idempotent, account-scoped and independent of progress',async t=>{
  const temp=await fs.mkdtemp(path.join(PROJECT,'artifacts','favorites-test-'));
  const filename=path.join(temp,'test.sqlite');
  let db=openStore(filename),server;
  t.after(async()=>{
    if(server)await new Promise(r=>server.close(r));
    db.close();
    assert.ok(temp.startsWith(path.join(PROJECT,'artifacts')+path.sep));
    await fs.rm(temp,{recursive:true,force:true});
  });
  const id='a'.repeat(24),other='b'.repeat(24),missing='c'.repeat(24);
  for(const [cid,title] of [[id,'Course A'],[other,'Course B']])db.prepare('INSERT INTO courses(id,title,author,folder,category,status) VALUES(?,?,?,?,?,?)').run(cid,title,'Teacher',title,'Science','done');
  const cookies=[];
  for(const username of ['Alice','Bob']){
    const uid=Number(db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run(username,'unused',Date.now()).lastInsertRowid);
    const token=crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),uid,Date.now()+60000);
    cookies.push('sid='+token);
  }
  async function start(){server=createApp(db,temp);await new Promise(r=>server.listen(0,'127.0.0.1',r))}
  await start();
  async function request(url,method='GET',cookie=cookies[0],origin){
    const r=await fetch('http://127.0.0.1:'+server.address().port+url,{method,headers:{...(cookie?{cookie}:{}),...(method==='GET'?{}:{'Content-Type':'application/json'}),...(origin?{origin}:{})},body:method==='GET'?undefined:'{}'});
    return {status:r.status,data:await r.json()};
  }
  const route='/api/courses/'+id+'/favorite';
  assert.equal((await request(route,'PUT','')).status,401);
  assert.equal((await request(route,'PUT',cookies[0],'https://evil.example')).status,403);
  assert.equal((await request('/api/courses/'+missing+'/favorite','PUT')).status,404);
  assert.equal((await request('/api/catalog')).data.courses.find(c=>c.id===id).isFavorite,false);
  const first=await request(route,'PUT');assert.equal(first.status,200);assert.equal(first.data.isFavorite,true);
  assert.ok(first.data.favoritedAt>0);
  assert.deepEqual((await request(route,'PUT')).data,first.data);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_favorites').get().n,1);
  assert.equal((await request('/api/catalog')).data.courses.find(c=>c.id===id).isFavorite,true);
  assert.equal((await request('/api/courses/'+id)).data.course.isFavorite,true);
  assert.equal((await request('/api/catalog?shelf=courses')).data.courses.find(c=>c.id===id).isFavorite,true);
  assert.equal((await request('/api/courses/'+id,'GET',cookies[1])).data.course.isFavorite,false);
  assert.equal((await request('/api/catalog','GET',cookies[1])).data.courses.find(c=>c.id===id).isFavorite,false);
  await request(route,'DELETE',cookies[1]);
  assert.equal((await request('/api/courses/'+id)).data.course.isFavorite,true);
  for(const table of ['progress','course_state'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
  await new Promise(r=>server.close(r));server=null;db.close();db=openStore(filename);await start();
  assert.deepEqual((await request('/api/courses/'+id)).data.course.favoritedAt,first.data.favoritedAt);
  assert.equal((await request(route,'DELETE')).data.isFavorite,false);
  assert.equal((await request(route,'DELETE')).data.favoritedAt,null);
  assert.equal((await request('/api/catalog')).data.courses.find(c=>c.id===id).isFavorite,false);
  db.prepare('UPDATE courses SET active=0 WHERE id=?').run(id);
  assert.equal((await request(route,'PUT')).status,404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_favorites').get().n,0);
});
