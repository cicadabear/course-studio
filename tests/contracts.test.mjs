import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {openStore,PROJECT} from '../store.mjs';
import {scan,courseInfo,cleanTitle} from '../scanner.mjs';
import {createApp,parseRange,isLocalAddress} from '../server.mjs';
import {compareLessonNumbers,lessonNumber} from '../lesson-order.mjs';
test('默认课时与队列跨年份目录按数字排序，自定义顺序仍保留',async t=>{
  const sandbox=path.join(PROJECT,'artifacts','order-'+Date.now()),source=path.join(sandbox,'source');
  await fs.mkdir(source,{recursive:true});
  const fixtures=[['2023','10丨第十课'],['2025','02丨第二课'],['2026','第1讲 第一课'],['2024','发刊词']];
  for(const [folder,title] of fixtures){const dir=path.join(source,'老师《排序测试》',folder);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,title+'.mp3'),'audio')}
  const db=openStore(path.join(sandbox,'test.sqlite'));let server;
  t.after(async()=>{if(server)await new Promise(r=>server.close(r));db.close();await fs.rm(sandbox,{recursive:true,force:true})});
  await scan(db,source,()=>{});
  const course=db.prepare('SELECT id FROM courses').get(),read=()=>db.prepare('SELECT id,title,sort_order FROM lessons WHERE active=1 ORDER BY sort_order').all();
  const lessons=read();assert.deepEqual(lessons.map(l=>l.title),['第1讲 第一课','02丨第二课','10丨第十课','发刊词']);
  assert.equal(lessonNumber('【００３】 第三课'),3);assert.equal(lessonNumber('2025年的展望'),null);
  assert.deepEqual([{title:'10丨十'},{title:'2丨二'},{title:'1丨一'}].sort(compareLessonNumbers).map(l=>l.title),['1丨一','2丨二','10丨十']);
  server=createApp(db,source);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(origin+'/api/courses/'+course.id)).status,401);
  const reg=await fetch(origin+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'OrderUser',password:'order-test-password'})});
  const cookie=reg.headers.get('set-cookie').split(';')[0];
  const guest=await fetch(origin+'/api/courses/'+course.id,{headers:{cookie}}).then(r=>r.json());assert.deepEqual(guest.state.queue,lessons.map(l=>l.id));
  const user=db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run('OrderTest','unused',Date.now()).lastInsertRowid;
  const custom=lessons.map(l=>l.id).reverse();db.prepare('INSERT INTO course_state(user_id,course_id,queue_json,last_lesson_id) VALUES(?,?,?,?)').run(user,course.id,JSON.stringify(custom),lessons[1].id);
  db.prepare('INSERT INTO progress(user_id,lesson_id,position,duration,completed,updated_at) VALUES(?,?,?,?,?,?)').run(user,lessons[1].id,42,90,1,Date.now());
  await scan(db,source,()=>{});assert.deepEqual(read().map(l=>l.id),lessons.map(l=>l.id));
  const state=db.prepare('SELECT queue_json,last_lesson_id FROM course_state WHERE user_id=?').get(user);assert.deepEqual(JSON.parse(state.queue_json),custom);assert.equal(state.last_lesson_id,lessons[1].id);
  assert.equal(db.prepare('SELECT position FROM progress WHERE user_id=?').get(user).position,42);
});
test('账号、队列、进度、目录与媒体的完整行为',async t=>{
  const sandbox=path.join(PROJECT,'artifacts','contract-'+Date.now());
  assert.ok(!/^d:/i.test(sandbox));
  await fs.mkdir(sandbox,{recursive:true});
  const source=path.join(sandbox,'read-only-source'),courseA='￥199元-老师甲·《老师甲·测试课程》（完结）',courseB='￥299元-老师乙·《另一门课》（更新中）';
  const section=path.join(source,courseA,'01丨第一模块');
  await fs.mkdir(section,{recursive:true});await fs.mkdir(path.join(source,courseB),{recursive:true});
  await fs.writeFile(path.join(section,'ab-0101丨01｜测试.mp3'),Buffer.from('0123456789abcdef'));
  await fs.writeFile(path.join(section,'ab-0101丨01丨测试.pdf'),Buffer.from('%PDF-1.4\ntest'));
  await fs.writeFile(path.join(section,'ab-0102丨问答.mp3'),Buffer.from('a'.repeat(1024)));
  await fs.writeFile(path.join(section,'ab-0103丨问答.mp3'),Buffer.from('b'.repeat(2048)));
  await fs.writeFile(path.join(section,'ab-0104丨文稿.pdf'),Buffer.from('%PDF-1.4\nonly'));
  await fs.writeFile(path.join(section,'视频.mp4'),Buffer.from('excluded'));
  await fs.writeFile(path.join(source,courseB,'01丨另一个.mp3'),Buffer.from('other'));
  let db=openStore(path.join(sandbox,'test.sqlite'));await scan(db,source,()=>{});
  const a=db.prepare('SELECT * FROM courses WHERE author=?').get('老师甲'),b=db.prepare('SELECT * FROM courses WHERE author=?').get('老师乙');
  const lessons=db.prepare('SELECT * FROM lessons WHERE course_id=? AND active=1 ORDER BY sort_order').all(a.id),first=lessons.find(l=>l.title.startsWith('01')),doc=lessons.find(l=>l.kind==='document'),other=db.prepare('SELECT * FROM lessons WHERE course_id=? AND active=1').get(b.id);
  const before=await fs.stat(path.join(section,'ab-0101丨01｜测试.mp3'));
  let server=createApp(db,source);await new Promise(r=>server.listen(0,'127.0.0.1',r));let origin='http://127.0.0.1:'+server.address().port;
  async function request(url,{method='GET',body,cookie,headers={}}={}){
    const r=await fetch(origin+url,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,headers:r.headers,data:r.headers.get('content-type')?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};
  }
  let alice,bob;
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();assert.ok(sandbox.startsWith(path.join(PROJECT,'artifacts')+path.sep));await fs.rm(sandbox,{recursive:true,force:true})});
  await t.test('课程属性拆分、同名不同日期保留、PDF配对、忽略视频',()=>{
    assert.equal(a.title,'测试课程');assert.equal(a.price_yuan,199);assert.equal(a.author,'老师甲');assert.equal(a.status,'已完结');
    assert.equal(lessons.filter(l=>l.title==='问答').length,2);assert.ok(first.document_file);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM files WHERE ext=? AND active=1').get('.mp4').n,0);
    assert.equal(cleanTitle('ab-0101丨01｜测试'),'01｜测试');
  });
  await t.test('访客不能播放或写记录，注册账号隔离',async()=>{
    assert.equal((await request('/media/'+first.primary_file)).status,401);
    assert.equal((await request('/api/progress',{method:'POST',body:{}})).status,401);
    assert.equal((await request('/api/catalog')).status,401);
    assert.equal((await request('/api/courses/'+first.course_id)).status,401);
    assert.equal((await request('/api/me')).data.canRegister,true);
    assert.ok(isLocalAddress('127.0.0.1')&&isLocalAddress('::1')&&isLocalAddress('::ffff:127.0.0.1')&&isLocalAddress('192.168.1.23')&&isLocalAddress('10.1.2.3')&&isLocalAddress('172.20.5.6')&&isLocalAddress('fd12::34'));
    assert.ok(!isLocalAddress('8.8.8.8')&&!isLocalAddress('172.32.1.1')&&!isLocalAddress('')&&!isLocalAddress('2001:4860:4860::8888'));
    const ar=await request('/api/register',{method:'POST',body:{username:'Alice',password:'test-password-alice'}});assert.equal(ar.status,200);alice=ar.headers.get('set-cookie').split(';')[0];
    const br=await request('/api/register',{method:'POST',body:{username:'Bob',password:'test-password-bob'}});assert.equal(br.status,200);bob=br.headers.get('set-cookie').split(';')[0];
    assert.ok(ar.headers.get('set-cookie').includes('HttpOnly'));
    assert.notEqual(db.prepare('SELECT password_hash FROM users WHERE username=?').get('Alice').password_hash,'test-password-alice');
    assert.equal((await request('/api/register',{method:'POST',body:{username:'alice',password:'test-password-alice'}})).status,409);
    assert.equal((await request('/api/login',{method:'POST',body:{username:'Alice',password:'wrong-password'}})).status,401);
    assert.equal((await request('/api/login',{method:'POST',body:null})).status,400);
    assert.equal((await request('/api/register',{method:'POST',body:{username:'Bad',password:'short'}})).status,400);
  });
  await t.test('媒体分段、后缀、HEAD、PDF和越界',async()=>{
    const ranged=await request('/media/'+first.primary_file,{cookie:alice,headers:{Range:'bytes=3-6'}});assert.equal(ranged.status,206);assert.equal(ranged.data.toString(),'3456');assert.equal(ranged.headers.get('content-range'),'bytes 3-6/16');
    const suffix=await request('/media/'+first.primary_file,{cookie:alice,headers:{Range:'bytes=-4'}});assert.equal(suffix.data.toString(),'cdef');
    const head=await request('/media/'+first.primary_file,{method:'HEAD',cookie:alice});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'16');assert.equal(head.data.length,0);
    const invalid=await request('/media/'+first.primary_file,{cookie:alice,headers:{Range:'bytes=999-'}});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),'bytes */16');
    assert.equal((await request('/media/'+first.document_file,{cookie:alice})).headers.get('content-type'),'application/pdf');
    assert.throws(()=>parseRange('bytes=0-1,3-4',16));
  });
  await t.test('续播、完成和不同账号的记录互不影响',async()=>{
    const saved=await request('/api/progress',{method:'POST',cookie:alice,body:{lessonId:first.id,position:42,duration:90,completed:true}});assert.equal(saved.status,200);
    const detailA=(await request('/api/courses/'+a.id,{cookie:alice})).data,detailB=(await request('/api/courses/'+a.id,{cookie:bob})).data;
    assert.equal(detailA.lessons.find(l=>l.id===first.id).position,42);assert.equal(detailA.lessons.find(l=>l.id===first.id).completed,1);
    assert.equal(detailA.state.lastLessonId,first.id);assert.equal(detailB.lessons.find(l=>l.id===first.id).position,0);assert.equal(detailB.state.lastLessonId,null);
    assert.equal((await request('/api/progress',{method:'POST',cookie:alice,body:{lessonId:first.id,position:5,duration:90}})).status,200);
    assert.equal((await request('/api/courses/'+a.id,{cookie:alice})).data.lessons.find(l=>l.id===first.id).completed,1);
    assert.equal((await request('/api/progress',{method:'POST',cookie:alice,body:{lessonId:first.id,position:100,duration:90}})).status,400);
  });
  await t.test('旧暂存记录不会覆盖新进度，标记其他课时不改变续播位置',async()=>{
    const stamp=Date.now();
    await request('/api/progress',{method:'POST',cookie:alice,body:{lessonId:first.id,position:42,duration:90,completed:true,observedAt:stamp}});
    const stale=await request('/api/progress',{method:'POST',cookie:alice,body:{lessonId:first.id,position:1,duration:90,completed:false,observedAt:stamp-10000}});
    assert.equal(stale.data.skipped,true);
    let d=(await request('/api/courses/'+a.id,{cookie:alice})).data;
    assert.equal(d.lessons.find(l=>l.id===first.id).position,42);assert.equal(d.lessons.find(l=>l.id===first.id).completed,1);
    const another=lessons.find(l=>l.primary_file&&l.id!==first.id);
    await request('/api/progress',{method:'POST',cookie:alice,body:{lessonId:another.id,position:0,duration:0,completed:false,touchCurrent:false}});
    d=(await request('/api/courses/'+a.id,{cookie:alice})).data;assert.equal(d.state.lastLessonId,first.id);
  });
  await t.test('每门课独立队列、空队列、倍速、恢复、拒绝跨课程',async()=>{
    const ids=lessons.filter(l=>l.primary_file).map(l=>l.id),custom=ids.slice(0,2).reverse();
    assert.equal((await request('/api/courses/'+a.id+'/state',{method:'PUT',cookie:alice,body:{queue:custom,rate:1.5,autonext:false}})).status,200);
    let d=(await request('/api/courses/'+a.id,{cookie:alice})).data;assert.deepEqual(d.state.queue,custom);assert.equal(d.state.rate,1.5);assert.equal(d.state.autonext,false);assert.equal(d.state.lastLessonId,first.id);
    assert.deepEqual((await request('/api/courses/'+a.id,{cookie:bob})).data.state.queue,ids);
    assert.deepEqual((await request('/api/courses/'+b.id,{cookie:alice})).data.state.queue,[other.id]);
    assert.equal((await request('/api/courses/'+a.id+'/state',{method:'PUT',cookie:alice,body:{queue:[other.id]}})).status,400);
    assert.equal((await request('/api/courses/'+a.id+'/state',{method:'PUT',cookie:alice,body:{queue:[doc.id]}})).status,400);
    await request('/api/courses/'+a.id+'/state',{method:'PUT',cookie:alice,body:{queue:[]}});assert.deepEqual((await request('/api/courses/'+a.id,{cookie:alice})).data.state.queue,[]);
    await request('/api/courses/'+a.id+'/state',{method:'PUT',cookie:alice,body:{queue:null}});assert.deepEqual((await request('/api/courses/'+a.id,{cookie:alice})).data.state.queue,ids);
    assert.equal((await request('/api/courses/'+a.id+'/state',{method:'PUT',cookie:alice,body:{rate:3}})).status,400);
  });
  await t.test('重新索引不丢进度，文稿新增音频后保持课时身份',async()=>{
    const docId=doc.id;await fs.writeFile(path.join(section,'ab-0104丨文稿.mp3'),Buffer.from('new-audio'));
    await scan(db,source,()=>{});
    assert.equal(db.prepare('SELECT completed FROM progress WHERE lesson_id=?').get(first.id).completed,1);
    const changed=db.prepare('SELECT * FROM lessons WHERE id=?').get(docId);assert.equal(changed.kind,'audio');assert.ok(changed.primary_file);
  });
  await t.test('完成列表按状态筛选并可翻页',async()=>{
    const aliceId=db.prepare('SELECT id FROM users WHERE username=?').get('Alice').id;
    const il=db.prepare('INSERT INTO lessons(id,course_id,title,section,sort_order,kind,active) VALUES(?,?,?,?,?,?,1)'),ip=db.prepare('INSERT INTO progress(user_id,lesson_id,position,duration,completed,updated_at) VALUES(?,?,?,?,?,?)');
    for(let i=0;i<205;i++){const id=crypto.createHash('sha256').update('completed'+i).digest('hex').slice(0,24);il.run(id,a.id,'完成'+i,'测试',1000+i,'document');ip.run(aliceId,id,0,0,1,Date.now()+i)}
    const page1=(await request('/api/history?completed=1',{cookie:alice})).data,page2=(await request('/api/history?completed=1&offset=100',{cookie:alice})).data;
    assert.equal(page1.lessons.length,100);assert.equal(page1.hasMore,true);assert.equal(page1.total,206);assert.equal(page2.lessons.length,100);
    assert.equal(new Set([...page1.lessons,...page2.lessons].map(l=>l.id)).size,200);
    assert.equal((await request('/api/history?completed=1',{cookie:bob})).data.total,0);
  });
  await t.test('数据库重开仍保留账号、进度、队列；原媒体未被改写',async()=>{
    await new Promise(r=>server.close(r));db.close();db=openStore(path.join(sandbox,'test.sqlite'));
    server=createApp(db,source);await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
    assert.equal((await request('/api/me',{cookie:alice})).data.user.username,'Alice');assert.equal((await request('/api/courses/'+a.id,{cookie:alice})).data.state.rate,1.5);
    assert.equal((await request('/api/courses/'+a.id,{cookie:alice})).data.lessons.find(l=>l.id===first.id).completed,1);
    const after=await fs.stat(path.join(section,'ab-0101丨01｜测试.mp3'));assert.equal(after.mtimeMs,before.mtimeMs);assert.equal((await fs.readFile(path.join(section,'ab-0101丨01｜测试.mp3'))).toString(),'0123456789abcdef');
    assert.equal((await request('/api/logout',{method:'POST',cookie:alice,body:{}})).status,200);assert.equal((await request('/media/'+first.primary_file,{cookie:alice})).status,401);
    assert.equal((await request('/api/progress',{method:'POST',cookie:bob,body:{},headers:{Origin:'https://example.invalid'}})).status,403);
  });
});
