import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
const helpers=app.slice(app.indexOf('let lessonShare=null;'),app.indexOf('function requireUser('));
function fixture(){
  const nodes=new Map(),calls=[];
  const context={URL,user:{username:'jack'},location:{href:'https://courses.example.test:7443/?private-query=discard#learning',origin:'https://courses.example.test:7443'},
    current:{data:{course:{id:'a'.repeat(24),title:'Course'}},lesson:{id:'b'.repeat(24),title:'Lesson'}},
    navigator:{clipboard:{writeText:async text=>calls.push(['copy',text])}},
    document:{execCommand:()=>false},api:async()=>({shares:[]}),fail:()=>{},esc:String,toast:text=>calls.push(['toast',text]),openDialog:id=>calls.push(['dialog',id]),
    $:id=>{if(!nodes.has(id))nodes.set(id,{focus:()=>calls.push('focus'),select:()=>calls.push('select'),setSelectionRange:(...range)=>calls.push(['range',...range])});return nodes.get(id)}};
  vm.createContext(context);vm.runInContext(helpers,context);
  return{context,nodes,calls,run:code=>vm.runInContext(code,context)};
}

test('login sharing identifies the selected lesson without query parameters or playback changes',async()=>{
  const f=fixture();f.run("showLessonShare();$('share-mode').value='login';updateLessonShareMode()");
  const expected='https://courses.example.test:7443/#course/'+'a'.repeat(24)+'?lesson='+'b'.repeat(24);
  assert.equal(f.nodes.get('share-url').value,expected);
  assert.equal(f.nodes.get('share-title').textContent,'Lesson');assert.equal(f.nodes.get('share-native').hidden,true);
  await f.run('copyLessonShare()');assert.deepEqual(f.calls.find(c=>c[0]==='copy'),['copy',expected]);
  f.context.current.lesson={id:'c'.repeat(24),title:'Next lesson'};f.run("showLessonShare();$('share-mode').value='login';updateLessonShareMode()");
  assert.ok(f.nodes.get('share-url').value.endsWith('?lesson='+'c'.repeat(24)));
  assert.equal(f.context.current.data.course.id,'a'.repeat(24));
});

test('clipboard failure selects the full link and supports manual copying on HTTP or restricted browsers',async()=>{
  const f=fixture();f.context.navigator.clipboard.writeText=async()=>{throw Error('Not allowed')};
  f.run("showLessonShare();$('share-mode').value='login';updateLessonShareMode()");await f.run('copyLessonShare()');
  assert.ok(f.calls.includes('select'));assert.ok(f.calls.some(c=>c[0]==='range'&&c[1]===0&&c[2]===f.nodes.get('share-url').value.length));
  assert.deepEqual(f.calls.at(-1),['toast','请长按或选择链接复制']);
  delete f.context.navigator.clipboard;f.context.document.execCommand=()=>true;
  await f.run('copyLessonShare()');assert.deepEqual(f.calls.at(-1),['toast','链接已复制']);
});

test('system sharing runs in the click stack and cancellation leaves playback and messages alone',async()=>{
  const f=fixture();let submitted;
  f.context.navigator.share=payload=>{submitted=payload;return Promise.reject(Object.assign(Error('Cancelled'),{name:'AbortError'}))};
  f.run("showLessonShare();$('share-mode').value='login';updateLessonShareMode()");assert.equal(f.nodes.get('share-native').hidden,false);
  const result=f.run('nativeLessonShare()');assert.equal(submitted.title,'Lesson');
  await result;assert.ok(!f.calls.some(c=>c[0]==='toast'));
});

test('guest sharing defaults to 48 hours and 10 opens, generates explicitly, and rejects stale results',async()=>{
  const f=fixture(),requests=[];
  f.context.api=(url,method,data)=>{
    if(method==='POST')return new Promise(resolve=>requests.push({url,data,resolve}));
    return Promise.resolve({shares:[]});
  };
  f.run('showLessonShare()');assert.equal(f.nodes.get('share-copy').disabled,true);
  assert.equal(requests.length,0);assert.equal(f.nodes.get('share-hours').value,'48');assert.equal(f.nodes.get('share-opens').value,'10');
  const generated=f.run('generateLessonShare()');assert.equal(requests.length,1);
  assert.equal(requests[0].data.hours,48);assert.equal(requests[0].data.maxOpens,10);assert.equal(requests[0].data.lessonId,'b'.repeat(24));
  requests[0].resolve({path:'/share#opaque.token',expiresAt:Date.now()+172800000,maxOpens:10});await generated;
  assert.equal(f.nodes.get('share-url').value,'https://courses.example.test:7443/share#opaque.token');assert.equal(f.nodes.get('share-copy').disabled,false);
  const stale=f.run('generateLessonShare()');f.context.current.lesson={id:'d'.repeat(24),title:'Changed'};f.run('showLessonShare()');
  requests[1].resolve({path:'/share#stale.token',expiresAt:Date.now()+172800000,maxOpens:10});await stale;
  assert.equal(f.nodes.get('share-url').value,'');assert.equal(f.nodes.get('share-copy').disabled,true);
});

test('other accounts cannot open the share creator',()=>{
  const f=fixture();f.context.user={username:'OtherUser'};f.run('showLessonShare()');assert.equal(f.calls.length,0);assert.equal(f.nodes.size,0);
});

test('a shared route opens the requested lesson paused and stale navigation cannot open it',async()=>{
  const source=app.slice(app.indexOf('async function route(){'),app.indexOf('function outboxKey('));
  const calls=[],lesson={id:'b'.repeat(24),mediaId:'media'};
  const context={navVersion:0,navActive:()=>{},document:{body:{classList:{remove:()=>{}}}},location:{hash:'#course/'+'a'.repeat(24)+'?lesson='+lesson.id},
    window:{scrollTo:()=>{}},current:null,detail:null,routeName:()=> 'courses',renderCourses:()=>{},
    renderDetail:async()=>{context.detail={course:{shelf:'youth'},lessons:[lesson]}},
    playLesson:async(...args)=>calls.push(args),$:()=>({innerHTML:''})};
  vm.createContext(context);vm.runInContext(source,context);await vm.runInContext('route()',context);
  assert.equal(calls.length,1);assert.equal(calls[0][1],lesson.id);assert.equal(calls[0][4],false);assert.equal(context.listRoute,'youth');
  context.renderDetail=async()=>{context.navVersion++};calls.length=0;
  await vm.runInContext('route()',context);assert.equal(calls.length,0);
});
