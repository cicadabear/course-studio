import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {openStore,PROJECT} from '../store.mjs';
import {createApp} from '../server.mjs';
import {scan} from '../scanner.mjs';

test('anonymous lesson shares enforce scoped sessions, quotas, expiry and owner revocation without learning writes',async t=>{
  const temp=await fs.mkdtemp(path.join(PROJECT,'artifacts','public-shares-')),source=path.join(temp,'media');
  await fs.mkdir(path.join(source,'老师《分享测试》'),{recursive:true});
  for(const [name,data] of [['01 分享.mp3','0123456789abcdef'],['01 分享.pdf','%PDF-1.4\ntest'],['02 其他.mp3','other'],['03 只有文稿.pdf','%PDF-1.4\nonly']])await fs.writeFile(path.join(source,'老师《分享测试》',name),data);
  let db=openStore(path.join(temp,'test.sqlite')),clock=Date.now(),server,origin;
  await scan(db,source,()=>{});
  const lessons=db.prepare('SELECT * FROM lessons ORDER BY sort_order').all(),lesson=lessons.find(l=>l.primary_file&&l.document_file),other=lessons.find(l=>l.primary_file&&!l.document_file),document=lessons.find(l=>!l.primary_file);
  const owners=[];
  for(const username of ['Jack','ShareBob']){
    const user=Number(db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run(username,'unused',clock).lastInsertRowid),token=crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),user,clock+30*86400000);
    owners.push({user,cookie:'sid='+token});
  }
  const start=async()=>{server=createApp(db,source,{clock:()=>clock});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port};
  await start();
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();assert.ok(temp.startsWith(path.join(PROJECT,'artifacts')+path.sep));await fs.rm(temp,{recursive:true,force:true})});
  const request=async(url,{method='GET',data,cookie,headers={}}={})=>{
    const res=await fetch(origin+url,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:data?JSON.stringify(data):undefined});
    return {status:res.status,headers:res.headers,data:method!=='HEAD'&&res.headers.get('content-type')?.includes('json')?await res.json():Buffer.from(await res.arrayBuffer())};
  };
  const create=async(data={})=>{const result=await request('/api/shares',{method:'POST',cookie:owners[0].cookie,data:{lessonId:lesson.id,...data}});assert.equal(result.status,201);return{...result.data,token:result.data.path.split('.')[1],base:'/api/public-shares/'+result.data.id+'/'}};
  const open=(share,cookie,headers)=>request(share.base+'open',{method:'POST',data:{token:share.token},cookie,headers});
  const count=share=>db.prepare('SELECT open_count FROM public_shares WHERE id=?').get(share.id).open_count;
  const unchanged=()=>JSON.stringify(['progress','course_state','course_favorites','lesson_favorites'].map(table=>db.prepare('SELECT * FROM '+table).all()));
  const before=unchanged();let share,guestCookie;
  await t.test('creation requires login, validates inputs and keeps secrets out of persisted/listed data',async()=>{
    assert.equal((await request('/api/shares',{method:'POST',data:{lessonId:lesson.id}})).status,401);
    assert.equal((await request('/api/shares',{method:'POST',data:{lessonId:lesson.id},cookie:owners[1].cookie})).status,403);
    for(const values of [{hours:0},{hours:169},{hours:1.2},{hours:'48'},{maxOpens:0},{maxOpens:101},{lessonId:'invalid'}])assert.equal((await request('/api/shares',{method:'POST',cookie:owners[0].cookie,data:{lessonId:lesson.id,...values}})).status,400);
    assert.equal((await request('/api/shares',{method:'POST',cookie:owners[0].cookie,data:{lessonId:lesson.id},headers:{Origin:'https://evil.example'}})).status,403);
    share=await create();assert.equal(share.expiresAt-clock,48*3600000);assert.equal(share.maxOpens,10);
    const raw=JSON.stringify(db.prepare('SELECT * FROM public_shares WHERE id=?').get(share.id));assert.ok(!raw.includes(share.token));
    const list=await request('/api/shares?lessonId='+lesson.id,{cookie:owners[0].cookie});assert.equal(list.data.shares.length,1);assert.ok(!JSON.stringify(list.data).includes(share.token));
    assert.equal((await request('/api/shares?lessonId='+lesson.id,{cookie:owners[1].cookie})).status,403);
  });
  await t.test('GET previews do not redeem; one browser can refresh, seek, read PDF and resume without extra openings',async()=>{
    for(const method of ['GET','HEAD']){const page=await request('/share',{method});assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.ok(page.headers.get('x-robots-tag').includes('noindex'))}
    assert.equal(count(share),0);assert.equal((await request(share.base+'lesson')).status,401);
    const bad=await request(share.base+'open',{method:'POST',data:{token:'0'.repeat(64)}});assert.equal(bad.status,404);assert.equal(count(share),0);
    const opened=await open(share);assert.equal(opened.status,200);assert.equal(count(share),1);
    const cookie=opened.headers.get('set-cookie');assert.match(cookie,/HttpOnly; SameSite=Lax/);assert.match(cookie,new RegExp('Path='+share.base));
    guestCookie=cookie.split(';')[0];assert.ok(!JSON.stringify(db.prepare('SELECT * FROM share_sessions').all()).includes(guestCookie.split('=')[1]));
    assert.equal(opened.data.audioUrl,share.base+'media/'+lesson.primary_file);assert.equal(opened.data.documentUrl,share.base+'media/'+lesson.document_file);assert.ok(!JSON.stringify(opened.data).includes(source));
    for(let i=0;i<3;i++){assert.equal((await open(share,guestCookie)).status,200);assert.equal((await request(share.base+'lesson',{cookie:guestCookie})).status,200)}
    const media=share.base+'media/'+lesson.primary_file;
    for(const [range,expected] of [['bytes=3-6','3456'],['bytes=-4','cdef']]){const r=await request(media,{cookie:guestCookie,headers:{Range:range}});assert.equal(r.status,206);assert.equal(r.data.toString(),expected);assert.equal(r.headers.get('cache-control'),'private, no-store')}
    assert.equal((await request(media,{method:'HEAD',cookie:guestCookie})).headers.get('content-length'),'16');
    assert.equal((await request(media,{cookie:guestCookie,headers:{Range:'bytes=100-'}})).status,416);
    const pdf=await request(opened.data.documentUrl,{cookie:guestCookie});assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.ok(pdf.data.toString().startsWith('%PDF'));
    assert.equal(count(share),1);
    const secure=await open(await create(),undefined,{'X-Forwarded-Proto':'https'});assert.match(secure.headers.get('set-cookie'),/; Secure$/);
  });
  await t.test('media URLs need the corresponding share session and cannot expose other files or account APIs',async()=>{
    const media=share.base+'media/'+lesson.primary_file;
    for(const cookie of [undefined,owners[0].cookie,'share_sid='+'f'.repeat(64)])assert.equal((await request(media,{cookie})).status,401);
    assert.equal((await request(share.base+'media/'+other.primary_file,{cookie:guestCookie})).status,404);
    const second=await create({lessonId:other.id});assert.equal((await request(second.base+'media/'+other.primary_file,{cookie:guestCookie})).status,401);
    for(const url of ['/media/'+lesson.primary_file,'/api/catalog','/api/courses/'+lesson.course_id,'/api/history'])assert.equal((await request(url,{cookie:guestCookie})).status,401);
    assert.equal((await request('/api/progress',{method:'POST',data:{lessonId:lesson.id,position:30},cookie:guestCookie})).status,401);
    assert.equal((await request('/api/shares/'+share.id,{method:'DELETE',data:{},cookie:owners[1].cookie})).status,403);
  });
  await t.test('concurrent new sessions cannot overspend the quota; admitted browsers remain usable after quota exhaustion',async()=>{
    const limited=await create(),results=await Promise.all(Array.from({length:20},()=>open(limited)));
    assert.equal(results.filter(r=>r.status===200).length,10);assert.equal(results.filter(r=>r.status===410).length,10);assert.equal(count(limited),10);
    const cookie=results.find(r=>r.status===200).headers.get('set-cookie').split(';')[0];
    assert.equal((await open(limited,cookie)).status,200);assert.equal((await request(limited.base+'lesson',{cookie})).status,200);assert.equal(count(limited),10);
  });
  await t.test('PDF links return the PDF directly without login, JavaScript or a player session',async()=>{
    const pdf=await create();assert.equal(pdf.documentPath,pdf.base+'document.pdf?token='+pdf.token);
    const result=await request(pdf.documentPath);assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'application/pdf');assert.ok(result.data.toString().startsWith('%PDF'));
    assert.match(result.headers.get('content-disposition'),/^inline;/);assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal(result.headers.get('referrer-policy'),'no-referrer');
    const setCookie=result.headers.get('set-cookie'),cookie=setCookie.split(';')[0];
    assert.match(setCookie,/^share_pdf_sid=/);assert.match(setCookie,/HttpOnly; SameSite=Lax/);assert.ok(setCookie.includes('Path='+pdf.base+'document.pdf;'));
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM share_document_sessions').all()).includes(cookie.split('=')[1]));
    assert.equal(count(pdf),1);
    assert.equal((await request(pdf.base+'lesson',{cookie})).status,401);assert.equal((await request(pdf.base+'media/'+lesson.primary_file,{cookie})).status,401);
    for(const range of ['bytes=0-3','bytes=-4'])assert.equal((await request(pdf.documentPath,{cookie,headers:{Range:range}})).status,206);
    assert.equal((await request(pdf.documentPath,{cookie})).status,200);assert.equal(count(pdf),1);
    // Without a cookie each independent GET is a new reader.
    assert.equal((await request(pdf.documentPath)).status,200);assert.equal(count(pdf),2);
    const played=await open(pdf,cookie);assert.equal(played.status,200);assert.equal(count(pdf),3);
    const fresh=await create(),freshOpened=await open(fresh),playerCookie=freshOpened.headers.get('set-cookie').split(';')[0];
    assert.equal((await request(fresh.documentPath,{cookie:playerCookie})).status,200);assert.equal(count(fresh),2);
    const secure=await request((await create()).documentPath,{headers:{'X-Forwarded-Proto':'https'}});assert.match(secure.headers.get('set-cookie'),/; Secure$/);
    assert.equal((await create({lessonId:other.id})).documentPath,null);
  });
  await t.test('PDF HEAD, bad links, missing documents and invalid ranges do not spend an opening',async()=>{
    const pdf=await create();
    const head=await request(pdf.documentPath,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('set-cookie'),null);assert.equal(head.data.length,0);assert.equal(count(pdf),0);
    for(const url of [pdf.base+'document.pdf',pdf.documentPath.replace(pdf.token,'0'.repeat(64)),pdf.documentPath.replace(pdf.token,'invalid')])assert.equal((await request(url)).status,404);
    assert.equal((await request(pdf.documentPath,{headers:{Range:'bytes=99999-'}})).status,416);assert.equal(count(pdf),0);
    const noPdf=await create({lessonId:other.id});assert.equal((await request(noPdf.base+'document.pdf?token='+noPdf.token)).status,404);assert.equal(count(noPdf),0);
    const file=db.prepare('SELECT relative_path FROM files WHERE id=?').get(lesson.document_file),original=path.join(source,file.relative_path),moved=original+'.test-missing';
    await fs.rename(original,moved);
    try{assert.equal((await request(pdf.documentPath)).status,404);assert.equal(count(pdf),0)}finally{await fs.rename(moved,original)}
  });
  await t.test('PDF and playback share one atomic quota while admitted PDF ranges remain available',async()=>{
    const pdf=await create({maxOpens:2}),results=await Promise.all(Array.from({length:8},()=>request(pdf.documentPath)));
    assert.equal(results.filter(r=>r.status===200).length,2);assert.equal(results.filter(r=>r.status===410).length,6);assert.equal(count(pdf),2);
    const cookie=results.find(r=>r.status===200).headers.get('set-cookie').split(';')[0];
    assert.equal((await request(pdf.documentPath,{cookie,headers:{Range:'bytes=0-3'}})).status,206);assert.equal((await request(pdf.documentPath,{method:'HEAD',cookie})).status,200);
    assert.equal((await request(pdf.documentPath,{method:'HEAD'})).status,410);assert.equal((await open(pdf,cookie)).status,410);
    const mixed=await create({maxOpens:1}),both=await Promise.all([open(mixed),request(mixed.documentPath)]);
    assert.deepEqual(both.map(r=>r.status).sort(),[200,410]);assert.equal(count(mixed),1);
    const second=await create();assert.equal((await request(second.documentPath,{cookie})).status,200);assert.equal(count(second),1);assert.equal(count(pdf),2);
  });
  await t.test('PDF sessions persist across restart and stop on revocation or file replacement',async()=>{
    const pdf=await create(),opened=await request(pdf.documentPath),cookie=opened.headers.get('set-cookie').split(';')[0];
    server.closeAllConnections();await new Promise(r=>server.close(r));db.close();db=openStore(path.join(temp,'test.sqlite'));await start();
    assert.equal((await request(pdf.documentPath,{cookie})).status,200);assert.equal(count(pdf),1);
    db.prepare('UPDATE lessons SET document_file=? WHERE id=?').run(document.document_file,lesson.id);
    try{assert.equal((await request(pdf.documentPath,{cookie})).status,404);assert.equal(count(pdf),1)}finally{db.prepare('UPDATE lessons SET document_file=? WHERE id=?').run(lesson.document_file,lesson.id)}
    assert.equal((await request('/api/shares/'+pdf.id,{method:'DELETE',data:{},cookie:owners[0].cookie})).status,200);
    assert.equal((await request(pdf.documentPath,{cookie})).status,410);assert.equal(db.prepare('SELECT COUNT(*) n FROM share_document_sessions WHERE share_id=?').get(pdf.id).n,0);
  });
  await t.test('database and sessions survive restart; document-only lessons work and file replacement does not expand a grant',async()=>{
    await new Promise(r=>server.close(r));db.close();db=openStore(path.join(temp,'test.sqlite'));await start();
    assert.equal((await request(share.base+'lesson',{cookie:guestCookie})).status,200);assert.equal(count(share),1);
    const doc=await create({lessonId:document.id}),opened=await open(doc);assert.equal(opened.status,200);assert.equal(opened.data.audioUrl,null);assert.ok(opened.data.documentUrl);
    db.prepare('UPDATE lessons SET primary_file=? WHERE id=?').run(other.primary_file,lesson.id);
    assert.equal((await request(share.base+'lesson',{cookie:guestCookie})).data.audioUrl,null);
    assert.equal((await request(share.base+'media/'+other.primary_file,{cookie:guestCookie})).status,404);
    assert.equal((await request(share.base+'media/'+lesson.primary_file,{cookie:guestCookie})).status,404);
    db.prepare('UPDATE lessons SET primary_file=? WHERE id=?').run(lesson.primary_file,lesson.id);
  });
  await t.test('revocation and expiry invalidate existing sessions and media, including after restart',async()=>{
    const revoked=await request('/api/shares/'+share.id,{method:'DELETE',cookie:owners[0].cookie,data:{}});assert.equal(revoked.status,200);
    for(const url of [share.base+'lesson',share.base+'media/'+lesson.primary_file])assert.equal((await request(url,{cookie:guestCookie})).status,410);
    assert.equal((await open(share,guestCookie)).status,410);
    const expired=await create({hours:1}),opened=await open(expired),cookie=opened.headers.get('set-cookie').split(';')[0];
    const pdfOpened=await request(expired.documentPath),pdfCookie=pdfOpened.headers.get('set-cookie').split(';')[0];assert.equal(pdfOpened.status,200);
    clock=expired.expiresAt;
    assert.equal((await open(expired)).status,410);assert.equal((await request(expired.base+'lesson',{cookie})).status,410);assert.equal((await request(expired.base+'media/'+lesson.document_file,{cookie})).status,410);
    assert.equal((await request(expired.documentPath,{cookie:pdfCookie})).status,410);
    await new Promise(r=>server.close(r));db.close();db=openStore(path.join(temp,'test.sqlite'));await start();
    assert.equal((await request(expired.base+'lesson',{cookie})).status,410);assert.equal((await open(share,guestCookie)).status,410);
    const inactive=await create();db.prepare('UPDATE courses SET active=0 WHERE id=?').run(lesson.course_id);assert.equal((await open(inactive)).status,410);
  });
  assert.equal(unchanged(),before);
});
