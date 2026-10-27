import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {openStore,PROJECT} from '../store.mjs';
import {createApp} from '../server.mjs';

test('iOS artwork is an opaque PNG with correct MIME, dimensions and public GET/HEAD access',async t=>{
  const temp=await fs.mkdtemp(path.join(PROJECT,'artifacts','artwork-test-')),db=openStore(path.join(temp,'test.sqlite'));
  const server=createApp(db,temp);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();assert.ok(temp.startsWith(path.join(PROJECT,'artifacts')+path.sep));await fs.rm(temp,{recursive:true,force:true})});
  const origin='http://127.0.0.1:'+server.address().port;
  for(const [file,size] of [['media-artwork.png',512],['apple-touch-icon.png',180]]){
    const response=await fetch(origin+'/'+file),png=Buffer.from(await response.arrayBuffer());
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
    assert.equal(response.headers.get('cache-control'),'no-cache');assert.equal(response.headers.get('set-cookie'),null);
    assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
    assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
    assert.equal(png[25],2,'RGB PNG must not have a transparent canvas');
    const head=await fetch(origin+'/'+file,{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),png.length);
    assert.equal((await head.arrayBuffer()).byteLength,0);
  }
  const html=await fetch(origin+'/').then(r=>r.text());
  assert.match(html,/<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png">/);
  assert.equal((await fetch(origin+'/unlisted.png')).status,404);
  assert.equal((await fetch(origin+'/api/catalog')).status,401);
});

test('Now Playing supplies one 512px PNG and optional metadata failures do not interrupt playback UI',async()=>{
  const app=await fs.readFile(path.join(PROJECT,'public','app.js'),'utf8');
  const start=app.indexOf('function updatePlayer(){'),end=app.indexOf('function updatePlayButtons()',start);
  assert.ok(start>=0&&end>start);
  const nodes=new Map(),$=id=>{
    if(!nodes.has(id))nodes.set(id,{classList:{toggle(){}},close(){}});
    return nodes.get(id);
  };
  const context={$,current:{data:{course:{title:'Course',author:'Teacher'},state:{rate:1,autonext:true}},lesson:{title:'Lesson',completed:false}},
    location:{origin:'https://example.test:9003',hash:'#course/test'},navigator:{mediaSession:{}},
    MediaMetadata:class{constructor(data){Object.assign(this,data)}},cover:()=>'',lessonFavoriteButton:()=>'<button>star</button>',renderSleep(){},updatePlayButtons(){},updateTimes(){}};
  vm.createContext(context);vm.runInContext(app.slice(start,end)+';updatePlayer();',context);
  const data=JSON.parse(JSON.stringify(context.navigator.mediaSession.metadata));
  assert.equal(data.title,'Lesson');assert.equal(data.artist,'Teacher');assert.equal(data.album,'Course');
  assert.equal(nodes.get('player-favorite').innerHTML,'<button>star</button>');
  assert.deepEqual(data.artwork,[{src:'https://example.test:9003/media-artwork.png',sizes:'512x512',type:'image/png'}]);
  context.MediaMetadata=class{constructor(){throw Error('Unsupported metadata')}};
  assert.doesNotThrow(()=>vm.runInContext('updatePlayer()',context));
  context.MediaMetadata=undefined;assert.doesNotThrow(()=>vm.runInContext('updatePlayer()',context));
});
