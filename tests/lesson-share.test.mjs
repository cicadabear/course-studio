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

test('guest sharing defaults to 7 days and 10 opens, generates explicitly, and rejects stale results',async()=>{
  const f=fixture(),requests=[];
  f.context.api=(url,method,data)=>{
    if(method==='POST')return new Promise(resolve=>requests.push({url,data,resolve}));
    return Promise.resolve({shares:[]});
  };
  f.run('showLessonShare()');assert.equal(f.nodes.get('share-copy').disabled,true);
  assert.equal(requests.length,0);assert.equal(f.nodes.get('share-hours').value,'168');assert.equal(f.nodes.get('share-opens').value,'10');
  const generated=f.run('generateLessonShare()');assert.equal(requests.length,1);
  assert.equal(requests[0].data.hours,168);assert.equal(requests[0].data.maxOpens,10);assert.equal(requests[0].data.lessonId,'b'.repeat(24));
  requests[0].resolve({path:'/share#opaque.token',expiresAt:Date.now()+172800000,maxOpens:10});await generated;
  assert.equal(f.nodes.get('share-url').value,'https://courses.example.test:7443/share#opaque.token');assert.equal(f.nodes.get('share-copy').disabled,false);
  const stale=f.run('generateLessonShare()');f.context.current.lesson={id:'d'.repeat(24),title:'Changed'};f.run('showLessonShare()');
  requests[1].resolve({path:'/share#stale.token',expiresAt:Date.now()+172800000,maxOpens:10});await stale;
  assert.equal(f.nodes.get('share-url').value,'');assert.equal(f.nodes.get('share-copy').disabled,true);
});

test('other accounts cannot open the share creator',()=>{
  const f=fixture();f.context.user={username:'OtherUser'};f.run('showLessonShare()');assert.equal(f.calls.length,0);assert.equal(f.nodes.size,0);
});

test('guest sharing exposes an independently copyable PDF URL and clears it when switching mode or lesson',async()=>{
  const f=fixture(),path='/api/public-shares/'+'c'.repeat(32)+'/document.pdf?token='+'d'.repeat(64);
  f.context.api=async(_url,method)=>method==='POST'?{path:'/share#opaque.token',documentPath:path,expiresAt:Date.now()+172800000,maxOpens:10}:{shares:[]};
  f.run('showLessonShare()');assert.equal(f.nodes.get('share-document').hidden,true);
  await f.run('generateLessonShare()');assert.equal(f.nodes.get('share-document').hidden,false);
  assert.equal(f.nodes.get('share-document-url').value,f.context.location.origin+path);
  await f.run('copyDocumentShare()');assert.deepEqual(f.calls.find(c=>c[0]==='copy'),['copy',f.context.location.origin+path]);
  f.run("$('share-mode').value='login';updateLessonShareMode()");assert.equal(f.nodes.get('share-document').hidden,true);assert.equal(f.nodes.get('share-document-url').value,'');
  f.run('showLessonShare()');assert.equal(f.nodes.get('share-document').hidden,true);
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


test('named-user sharing records successful names, deduplicates case, limits history and keeps it across dialogs',async()=>{
  const f=fixture(),storage=new Map();f.context.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const requests=[];f.context.api=async(url,method,data)=>{if(method==='POST'){requests.push({url,data});return{path:'/share-login#opaque.token',targetUsername:data.targetUsername.toLowerCase()==='mary'?'Mary':data.targetUsername,expiresAt:Date.now()+7*86400000,maxOpens:10}}return{shares:[]}};
  f.run(`showLessonShare();$('share-mode').value='auto';updateLessonShareMode();$('share-username').value=' mary '`);await f.run('generateLessonShare()');
  assert.equal(requests[0].url,'/api/login-shares');assert.equal(requests[0].data.targetUsername,'mary');assert.equal(requests[0].data.hours,168);assert.equal(f.nodes.get('share-user-options').hidden,false);assert.equal(f.nodes.get('share-document').hidden,true);
  assert.equal(f.nodes.get('share-url').value,f.context.location.origin+'/share-login#opaque.token');assert.ok(f.nodes.get('share-user-history').innerHTML.includes('Mary'));
  assert.deepEqual(Array.from(f.run('shareUsernameHistory()')),['Mary']);
  f.run(`rememberShareUsername('MARY');rememberShareUsername('Bob')`);assert.deepEqual(Array.from(f.run('shareUsernameHistory()')),['Bob','MARY']);
  for(let i=0;i<10;i++)f.run('rememberShareUsername('+JSON.stringify('User'+i)+')');assert.equal(f.run('shareUsernameHistory().length'),8);
  f.run('showLessonShare()');assert.equal(f.nodes.get('share-username').value,'User9');assert.equal(f.nodes.get('share-url').value,'');
  const stored=f.run('shareUsernameHistory()');storage.set(f.run('shareHistoryKey()'),JSON.stringify(['<script>',null,'x','Mary','MARY',...Array.from(stored)]));assert.ok(!f.run('shareUsernameHistory()').includes('<script>'));assert.equal(f.run('shareUsernameHistory().filter(v=>v.toLowerCase()==="mary").length'),1);
});

test('failed or stale named-user creation never remembers an unverified name or displays a link for the wrong account',async()=>{
  const f=fixture(),storage=new Map();f.context.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  f.context.api=async(_url,method)=>{if(method==='POST')throw Error('指定用户不存在');return{shares:[]}};
  f.run(`showLessonShare();$('share-mode').value='auto';updateLessonShareMode();$('share-username').value='missing'`);await assert.rejects(f.run('generateLessonShare()'),/指定用户不存在/);assert.equal(storage.size,0);assert.equal(f.nodes.get('share-url').value,'');
  let resolve;f.context.api=(_url,method)=>method==='POST'?new Promise(r=>resolve=r):Promise.resolve({shares:[]});
  f.run(`$('share-username').value='Mary'`);const pending=f.run('generateLessonShare()');f.run(`$('share-username').value='Bob';updateLessonShareMode()`);
  resolve({path:'/share-login#old.token',targetUsername:'Mary',expiresAt:Date.now()+7*86400000,maxOpens:10});await pending;assert.equal(f.nodes.get('share-url').value,'');assert.equal(storage.size,0);
  f.context.localStorage={getItem:()=>{throw Error('Storage blocked')},setItem:()=>{throw Error('Storage blocked')}};f.run(`rememberShareUsername('Mary');showLessonShare()`);assert.equal(f.nodes.get('share-username').value,'');
});
