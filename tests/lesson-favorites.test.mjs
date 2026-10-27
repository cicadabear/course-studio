import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {openStore,PROJECT} from '../store.mjs';
import {createApp} from '../server.mjs';
import {scan} from '../scanner.mjs';

test('lesson favorites isolate accounts, persist across scan/restart, and paginate without changing progress',async t=>{
  const temp=await fs.mkdtemp(path.join(PROJECT,'artifacts','lesson-favorites-test-'));
  const source=path.join(temp,'source'),folder=path.join(source,'Teacher《Favorite Test》'),filename=path.join(temp,'test.sqlite');
  await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'01 Audio.mp3'),'audio');
  await fs.writeFile(path.join(folder,'02 Document.pdf'),'%PDF-1.4');
  let db=openStore(filename),server;
  t.after(async()=>{
    if(server)await new Promise(r=>server.close(r));
    db.close();assert.ok(temp.startsWith(path.join(PROJECT,'artifacts')+path.sep));
    await fs.rm(temp,{recursive:true,force:true});
  });
  await scan(db,source,()=>{});
  const course=db.prepare('SELECT id FROM courses').get(),audio=db.prepare("SELECT id FROM lessons WHERE kind='audio'").get(),doc=db.prepare("SELECT id FROM lessons WHERE kind='document'").get();
  const users=[],cookies=[];
  for(const name of ['Alice','Bob']){
    const uid=Number(db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run(name,'unused',Date.now()).lastInsertRowid);
    const token=crypto.randomBytes(32).toString('hex');users.push(uid);cookies.push('sid='+token);
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),uid,Date.now()+60000);
  }
  async function start(){server=createApp(db,source);await new Promise(r=>server.listen(0,'127.0.0.1',r))}
  await start();
  async function request(url,method='GET',cookie=cookies[0],origin){
    const r=await fetch('http://127.0.0.1:'+server.address().port+url,{method,headers:{...(cookie?{cookie}:{}),...(method==='GET'?{}:{'Content-Type':'application/json'}),...(origin?{origin}:{})},body:method==='GET'?undefined:'{}'});
    return {status:r.status,data:await r.json()};
  }
  const route=id=>'/api/lessons/'+id+'/favorite',list=()=>request('/api/lesson-favorites');
  assert.equal((await list()).data.total,0);
  assert.equal((await request('/api/lesson-favorites','GET','')).status,401);
  assert.equal((await request(route(audio.id),'PUT','')).status,401);
  assert.equal((await request(route(audio.id),'DELETE','')).status,401);
  assert.equal((await request(route(audio.id),'PUT',cookies[0],'https://evil.example')).status,403);
  assert.equal((await request(route('f'.repeat(24)),'PUT')).status,404);
  const first=await request(route(audio.id),'PUT');assert.equal(first.status,200);assert.equal(first.data.isFavorite,true);
  assert.deepEqual((await request(route(audio.id),'PUT')).data,first.data);
  const detail=await request('/api/courses/'+course.id);
  assert.equal(detail.data.lessons.find(l=>l.id===audio.id).isFavorite,true);
  assert.equal(detail.data.course.isFavorite,false);
  assert.equal((await request('/api/courses/'+course.id,'GET',cookies[1])).data.lessons.find(l=>l.id===audio.id).isFavorite,false);
  assert.equal((await request('/api/lesson-favorites','GET',cookies[1])).data.total,0);
  await request(route(audio.id),'DELETE',cookies[1]);assert.equal((await list()).data.total,1);
  await request(route(doc.id),'PUT');
  const saved=(await list()).data.lessons;
  assert.equal(saved.find(l=>l.id===doc.id).kind,'document');assert.ok(saved.find(l=>l.id===doc.id).documentId);
  assert.ok(saved.find(l=>l.id===audio.id).mediaId);assert.ok(saved.every(l=>l.courseId===course.id&&l.courseTitle&&!('primary_file' in l)));
  for(const table of ['progress','course_state','course_favorites'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
  await scan(db,source,()=>{});assert.equal((await list()).data.total,2);
  await new Promise(r=>server.close(r));server=null;db.close();db=openStore(filename);await start();
  assert.equal((await list()).data.lessons.find(l=>l.id===audio.id).favoritedAt,first.data.favoritedAt);
  db.prepare('INSERT INTO progress(user_id,lesson_id,position,duration,completed,updated_at) VALUES(?,?,?,?,?,?)').run(users[0],audio.id,42,90,1,Date.now());
  const progressBefore=db.prepare('SELECT * FROM progress').get();
  for(const url of ['/api/history','/api/history?completed=1']){
    const history=(await request(url)).data.lessons;
    assert.equal(history[0].isFavorite,true);assert.equal(history[0].favoritedAt,first.data.favoritedAt);assert.ok(history[0].mediaId);
    assert.equal((await request(url,'GET',cookies[1])).data.lessons.length,0);
  }
  assert.equal((await list()).data.lessons.find(l=>l.id===audio.id).position,42);
  assert.equal((await request(route(audio.id),'DELETE')).data.isFavorite,false);
  assert.equal((await request(route(audio.id),'DELETE')).data.favoritedAt,null);
  assert.equal((await request('/api/history')).data.lessons[0].isFavorite,false);
  assert.equal((await request('/api/history?completed=1')).data.lessons[0].isFavorite,false);
  assert.deepEqual(db.prepare('SELECT * FROM progress').get(),progressBefore);
  db.prepare('UPDATE lessons SET active=0 WHERE id=?').run(doc.id);
  assert.equal((await list()).data.total,0);assert.equal((await request(route(doc.id),'PUT')).status,404);
  db.prepare('UPDATE lessons SET active=1 WHERE id=?').run(doc.id);
  db.prepare('UPDATE courses SET active=0 WHERE id=?').run(course.id);
  assert.equal((await list()).data.total,0);assert.equal((await request(route(audio.id),'PUT')).status,404);
  db.prepare('UPDATE courses SET active=1 WHERE id=?').run(course.id);
  for(let i=1;i<=102;i++){
    const id=i.toString(16).padStart(24,'0');
    db.prepare('INSERT INTO lessons(id,course_id,title,section,sort_order,kind) VALUES(?,?,?,?,?,?)').run(id,course.id,'Lesson '+i,'',i,'audio');
    db.prepare('INSERT INTO lesson_favorites VALUES(?,?,?)').run(users[0],id,1000);
  }
  const page1=(await list()).data,page2=(await request('/api/lesson-favorites?offset=100')).data;
  assert.equal(page1.total,103);assert.equal(page1.lessons.length,100);assert.equal(page1.hasMore,true);
  assert.equal(page2.lessons.length,3);assert.equal(page2.hasMore,false);
  assert.equal(new Set([...page1.lessons,...page2.lessons].map(l=>l.id)).size,103);
  assert.equal((await request('/api/lesson-favorites?offset=103')).data.lessons.length,0);
  await request(route(page1.lessons[1].id),'DELETE');
  const next=(await request('/api/lesson-favorites?cursor='+encodeURIComponent(page1.nextCursor))).data;
  assert.deepEqual(next.lessons.map(l=>l.id),page2.lessons.map(l=>l.id));assert.equal(next.hasMore,false);
  for(const cursor of ['invalid','-1:'+audio.id,'9007199254740992:'+audio.id])assert.equal((await request('/api/lesson-favorites?cursor='+encodeURIComponent(cursor))).status,400);
  assert.equal((await request('/api/lesson-favorites?offset=1&cursor='+encodeURIComponent(page1.nextCursor))).status,400);
  for(const offset of ['-1','1.5','x','9007199254740992'])assert.equal((await request('/api/lesson-favorites?offset='+offset)).status,400);
});
