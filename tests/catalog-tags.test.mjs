import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {courseMetadata,youthCourseInfo,tagOrders} from '../catalog-tags.mjs';
import {createApp} from '../server.mjs';
import {openStore,PROJECT} from '../store.mjs';
import {scan} from '../scanner.mjs';

test('youth titles preserve series numbers, teacher names and status',()=>{
  assert.equal(youthCourseInfo('003.【完结】《济公传》1').title,'《济公传》1');
  assert.equal(youthCourseInfo('006.【完结】卓克·《巧学物理40讲》').author,'卓克');
  assert.equal(youthCourseInfo('006.【完结】卓克·《巧学物理40讲》').title,'巧学物理40讲');
  assert.equal(youthCourseInfo('515. 少年读李白【完结】').title,'少年读李白');
  assert.equal(youthCourseInfo('516【更新中】《福尔摩斯与华生·千里追凶》').status,'更新中');
});

test('tags include libraries and semantic topics without age category labels',()=>{
  const settings={mediaRoot:'library',collections:[{root:'master',label:'大师课',shelf:'courses'},{root:'junior',label:'少年课程',shelf:'youth'}]};
  const master=courseMetadata({source_root:'master',title:'数学与概率',category:'科学科技'},settings);
  assert.equal(master.library,'大师课');assert.equal(master.shelf,'courses');assert.ok(master.tags.includes('数学与统计'));assert.ok(!master.tags.includes('数学'));
  const junior=courseMetadata({source_root:'junior',title:'英语单词大冒险',category:'文化艺术'},settings);
  assert.equal(junior.shelf,'youth');assert.ok(junior.tags.includes('英语'));assert.ok(!junior.tags.includes('少年课程'));assert.equal(junior.library,'少年课程');
  assert.ok(!junior.tags.includes('大人')&&!junior.tags.includes('小孩'));
  assert.ok(!tagOrders.courses.includes('语文')&&!tagOrders.courses.includes('少年课程'));
  assert.ok(!tagOrders.youth.includes('专栏')&&!tagOrders.youth.includes('投资理财')&&!tagOrders.youth.includes('少年课程'));
  assert.ok(!courseMetadata({source_root:'junior',title:'少年财商与金融启蒙'},settings).tags.includes('经济金融'));
});

test('youth scan and catalog expose searchable tags but do not expose disk paths',async t=>{
  const temp=await fs.mkdtemp(path.join(PROJECT,'artifacts','youth-test-'));
  const source=path.join(temp,'少年课程'),folder=path.join(source,'001.【完结】作文有意思');
  await fs.mkdir(folder,{recursive:true});
  for(const name of ['丨03丨第三讲','01第一讲','02丨第二讲'])await fs.writeFile(path.join(folder,name+'.mp3'),'audio');
  const db=openStore(path.join(temp,'test.sqlite'));
  let server;
  t.after(async()=>{if(server)await new Promise(r=>server.close(r));db.close();await fs.rm(temp,{recursive:true,force:true})});
  await scan(db,source,()=>{},{reportPath:path.join(temp,'scan.json')});
  const course=db.prepare('SELECT * FROM courses WHERE active=1').get();
  assert.equal(course.title,'作文有意思');assert.equal(course.author,'少年课程');
  const adultId='a'.repeat(24);
  db.prepare('INSERT INTO courses(id,title,author,folder,category,status) VALUES(?,?,?,?,?,?)').run(adultId,'投资理财与公司管理','Teacher','Investment','商业管理','已完结');
  assert.deepEqual(db.prepare('SELECT title FROM lessons WHERE course_id=? ORDER BY sort_order').all(course.id).map(l=>l.title),['01第一讲','02丨第二讲','丨03丨第三讲']);
  const uid=Number(db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run('YouthQA','unused',0).lastInsertRowid);
  const token=crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),uid,Date.now()+60000);
  server=createApp(db,source);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port,headers={Cookie:'sid='+token};
  const catalog=await fetch(origin+'/api/catalog',{headers}).then(r=>r.json());
  const young=catalog.courses.find(c=>c.id===course.id);
  assert.equal(young.shelf,'youth');assert.ok(young.tags.includes('写作'));assert.ok(catalog.tagOrder.includes('专栏'));
  assert.equal(young.source_root,undefined);
  const youth=await fetch(origin+'/api/catalog?shelf=youth',{headers}).then(r=>r.json());
  assert.deepEqual(youth.courses.map(c=>c.id),[course.id]);assert.equal(youth.meta.courses,1);assert.equal(youth.meta.audio,3);
  assert.ok(!youth.tagOrder.includes('少年课程'));assert.ok(youth.courses.every(c=>!c.tags.includes('少年课程')));
  assert.ok(!youth.tagOrder.includes('专栏')&&!youth.tagOrder.includes('投资理财'));
  const adult=await fetch(origin+'/api/catalog?shelf=courses',{headers}).then(r=>r.json());
  assert.deepEqual(adult.courses.map(c=>c.id),[adultId]);assert.equal(adult.meta.courses,1);
  assert.ok(!adult.tagOrder.includes('少年课程')&&!adult.tagOrder.includes('语文'));
  assert.equal((await fetch(origin+'/api/catalog?shelf=invalid',{headers})).status,400);
  const detail=await fetch(origin+'/api/courses/'+course.id,{headers}).then(r=>r.json());
  assert.equal(detail.course.shelf,'youth');assert.equal(detail.course.source_root,undefined);
});
