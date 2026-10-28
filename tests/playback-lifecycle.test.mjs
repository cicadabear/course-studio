import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
const playback=app.slice(app.indexOf('function prepareAudioSession(){'),app.indexOf('function updatePlayer(){'));
const next=app.slice(app.indexOf('async function nextLesson('),app.indexOf('function openDocument('));
const ended=app.slice(app.indexOf('async function onAudioEnded('),app.indexOf("audio.addEventListener('ended'"));
function fixture(){
  const calls=[],nodes=new Map(),lessons=[{id:'one',mediaId:'audio-one',completed:0,position:12},{id:'two',mediaId:'audio-two',completed:0,position:24}];
  const data={course:{id:'course'},lessons,state:{queue:lessons.map(l=>l.id),rate:1.25,autonext:true}};
  const audio={src:'/media/audio-one',currentSrc:'/media/audio-one',currentTime:12,paused:false,ended:false,muted:true,duration:120,
    pause(){calls.push('pause');this.paused=true},
    load(){calls.push('load');this.currentSrc=this.src;this.currentTime=0;this.paused=true;this.ended=false},
    play(){calls.push('play');this.paused=false;return Promise.resolve()}};
  const context={audio,navigator:{audioSession:{type:'auto'}},current:{data,lesson:lessons[0],ready:true,version:1,target:12},
    loopHandoff:false,loopBoundary:{version:1,last:12,played:true},fail:e=>{throw e},
    loadVersion:1,suppressPause:false,user:{id:1},sleep:{mode:'off'},data,
    $:id=>{if(!nodes.has(id))nodes.set(id,{classList:{remove:cls=>calls.push('show-'+id)},close:()=>calls.push('close-dialog')});return nodes.get(id)},
    snapshot:completed=>context.current.finished?null:({lessonId:context.current.lesson.id,position:audio.currentTime,duration:audio.duration,completed:completed??!!context.current.lesson.completed}),
    enqueueProgress:record=>{if(record)calls.push(['save',record])},flushProgress:()=>new Promise(()=>{}),
    requireUser:()=>false,openDialog:()=>calls.push('open-dialog'),setSaveStatus:(text,failed)=>calls.push(['status',text,failed]),
    toast:text=>calls.push(['toast',text]),updatePlayButtons:()=>calls.push('buttons'),
    updatePlayer:()=>calls.push('player'),renderLessons:()=>calls.push('lessons'),loadTranscript:async()=>{},
    persistSleep:()=>calls.push('persist-sleep'),renderSleep:()=>{},clearSleep:()=>calls.push('clear-sleep'),
    finishSleep:()=>{calls.push('finish-sleep');audio.pause()},location:{hash:'#courses'}};
  vm.createContext(context);vm.runInContext(playback+next+ended,context);
  return{context,calls,audio,data,run:code=>vm.runInContext(code,context)};
}

test('switch starts play synchronously without waiting for progress I/O, reloads the same audio element and sets playback session',async()=>{
  const f=fixture(),pending=f.run("playLesson(data,'two')");
  assert.ok(f.calls.includes('play'),'play() must run before returning to the event loop');
  assert.ok(f.calls.indexOf('load')<f.calls.indexOf('play'));
  assert.ok(f.calls.indexOf('play')<f.calls.indexOf('player'));
  assert.equal(f.context.navigator.audioSession.type,'playback');assert.equal(f.audio.muted,false);
  assert.equal(f.audio.playbackRate,1.25);assert.equal(f.context.current.target,24);assert.equal(f.context.current.ready,false);
  assert.equal(f.calls.find(c=>Array.isArray(c)&&c[0]==='save')[1].lessonId,'one');
  await pending;assert.equal(f.context.current.lesson.id,'two');
});

test('automatic end starts next track immediately, preserves completed progress and ignores duplicate old ended events',async()=>{
  const f=fixture();f.audio.currentTime=120;f.audio.ended=true;
  const result=f.run('onAudioEnded()');assert.equal(f.context.current.lesson.id,'two');assert.ok(f.calls.includes('play'));
  assert.equal(f.data.lessons[0].completed,1);assert.equal(f.calls[0][1].completed,true);
  assert.ok(!f.calls.includes('close-dialog')&&!f.calls.includes('open-dialog'));
  await result;const plays=f.calls.filter(c=>c==='play').length;
  await f.run('onAudioEnded()');assert.equal(f.calls.filter(c=>c==='play').length,plays);
});

test('autonext off and sleep-after-one do not start another track; sleep-after-two advances once',async()=>{
  const off=fixture();off.data.state.autonext=false;await off.run('onAudioEnded()');assert.ok(!off.calls.includes('play'));
  const one=fixture();one.context.sleep={mode:'lessons',count:1};await one.run('onAudioEnded()');assert.ok(!one.calls.includes('play'));assert.ok(one.calls.includes('finish-sleep'));
  const two=fixture();two.context.sleep={mode:'lessons',count:2};await two.run('onAudioEnded()');assert.equal(two.context.sleep.count,1);assert.equal(two.context.current.lesson.id,'two');
});

test('blocked autoplay is visible and can be retried manually instead of reporting success',async()=>{
  const f=fixture();f.audio.play=()=>Promise.reject(Object.assign(new Error('Denied'),{name:'NotAllowedError'}));
  await f.run('startAudio()');
  assert.ok(f.calls.some(c=>Array.isArray(c)&&c[0]==='status'&&c[2]===true));
  assert.ok(!f.calls.some(c=>Array.isArray(c)&&c[0]==='status'&&c[1]==='播放进度自动保存'));
  f.audio.play=()=>{f.calls.push('retry');return Promise.resolve()};await f.run('startAudio()');assert.ok(f.calls.includes('retry'));
});

test('a superseded play request cannot change status or surface an error over the new lesson',async()=>{
  const f=fixture();let rejectFirst;
  f.audio.play=()=>new Promise((_,reject)=>{rejectFirst=reject});const first=f.run('startAudio()');
  f.audio.play=()=>Promise.resolve();await f.run("playLesson(data,'two')");
  const count=f.calls.length;rejectFirst(Object.assign(new Error('Old failure'),{name:'NotAllowedError'}));await first;
  assert.equal(f.calls.length,count);
});

test('ordinary play tolerates unsupported Audio Session APIs',async()=>{
  const f=fixture();Object.defineProperty(f.context.navigator.audioSession,'type',{get:()=> 'auto',set(){throw Error('Unsupported')}});
  await f.run('startAudio()');assert.ok(f.calls.includes('play'));
  delete f.context.navigator.audioSession;await f.run('startAudio()');
});

test('a shared lesson prepares the player paused, and a later manual play starts the same audio',async()=>{
  const f=fixture();
  await f.run("playLesson(data,'two',false,true,false)");
  assert.equal(f.context.current.lesson.id,'two');assert.equal(f.audio.paused,true);
  assert.ok(!f.calls.includes('play'));assert.ok(f.calls.includes('open-dialog'));
  await f.run('startAudio()');
  assert.equal(f.audio.paused,false);assert.equal(f.calls.filter(c=>c==='play').length,1);
});

test('safe event wrapper invokes playback in the event call stack and catches both error types',async()=>{
  const source=app.slice(app.indexOf('function safe(fn){'),app.indexOf('function openDialog('));
  const errors=[],context={fail:e=>errors.push(e.message),called:false};vm.createContext(context);vm.runInContext(source,context);
  vm.runInContext('safe(()=>{called=true})()',context);assert.equal(context.called,true);
  vm.runInContext('safe(()=>{throw Error("sync")})()',context);
  await vm.runInContext('safe(()=>Promise.reject(Error("async")))()',context);assert.deepEqual(errors,['sync','async']);
});

test('iOS native loop wrap hands off immediately and records the full ending, not position zero',async()=>{
  const f=fixture();f.context.loopHandoff=true;f.audio.loop=true;f.context.loopBoundary.last=119.5;f.audio.currentTime=0;
  assert.equal(f.run('handleLoopBoundary()'),true);
  assert.equal(f.context.current.lesson.id,'two');assert.equal(f.audio.paused,false);
  assert.equal(f.calls.filter(c=>c==='play').length,1);assert.equal(f.data.lessons[0].completed,1);
  const record=f.calls.find(c=>Array.isArray(c)&&c[0]==='save')[1];assert.equal(record.position,120);assert.equal(record.completed,true);
  assert.equal(f.run('handleLoopBoundary()'),false);await Promise.resolve();
});

test('manual seek to start and a newly loaded source cannot be mistaken for a native loop',()=>{
  const f=fixture();f.context.loopHandoff=true;f.audio.loop=true;f.context.loopBoundary.last=119;
  f.run('seekAudio(0)');assert.equal(f.run('handleLoopBoundary()'),false);assert.equal(f.context.current.lesson.id,'one');
  f.context.loopBoundary.last=119;f.context.loopBoundary.played=false;assert.equal(f.run('handleLoopBoundary()'),false);
  f.context.loopBoundary.played=true;f.context.loopBoundary.last=119;f.context.loopBoundary.version=0;
  assert.equal(f.run('handleLoopBoundary()'),false);assert.ok(!f.calls.includes('play'));
});

test('loop fallback pauses at queue end or sleep cutoff, never repeats or skips a lesson',async()=>{
  for(const stop of ['queue','sleep','autonext']){
    const f=fixture();f.context.loopHandoff=true;f.audio.loop=true;f.context.loopBoundary.last=119;f.audio.currentTime=0;
    if(stop==='queue')f.data.state.queue=['one'];
    if(stop==='sleep')f.context.sleep={mode:'lessons',count:1};
    if(stop==='autonext')f.data.state.autonext=false;
    assert.equal(f.run('handleLoopBoundary()'),true);assert.equal(f.audio.paused,true);assert.equal(f.context.current.lesson.id,'one');
    assert.ok(!f.calls.includes('play'));assert.equal(f.run('handleLoopBoundary()'),false);assert.equal(f.run('snapshot()'),null);
    await Promise.resolve();
  }
});

test('normal browsers do not take the native-loop workaround; short clips still wrap correctly when enabled',()=>{
  const browser=fixture();browser.audio.loop=true;browser.context.loopBoundary.last=119;browser.audio.currentTime=0;
  assert.equal(browser.run('handleLoopBoundary()'),false);
  const short=fixture();short.context.loopHandoff=true;short.audio.loop=true;short.audio.duration=2;short.context.loopBoundary.last=1.8;short.audio.currentTime=0;
  assert.equal(short.run('handleLoopBoundary()'),true);assert.equal(short.context.current.lesson.id,'two');
});
