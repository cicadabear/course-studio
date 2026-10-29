import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {openStore,config,PROJECT} from '../store.mjs';
import {createApp} from '../server.mjs';

test('lesson title search is authenticated, shelf-scoped, literal, paginated and account-specific without changing learning data',async t=>{
  const temp=await fs.mkdtemp(path.join(PROJECT,'artifacts','lesson-search-'));
  const db=openStore(path.join(temp,'test.sqlite')),collections=config.collections;
  const adult=path.join(temp,'adult'),youth=path.join(temp,'youth');
  config.collections=[...(collections||[]),{root:adult,label:'课程',shelf:'courses'},{root:youth,label:'少年课程',shelf:'youth'}];
  const id=n=>n.toString(16).padStart(24,'0');
  const course=db.prepare('INSERT INTO courses(id,title,author,folder,category,status,active,source_root) VALUES(?,?,?,?,?,?,?,?)');
  course.run(id(1),'课程名独有词','作者名独有词','adult','历史人文','',1,adult);
  course.run(id(2),'少年课程','少年老师','youth','历史人文','',1,youth);
  course.run(id(3),'已下架课程','老师','inactive','历史人文','',0,adult);
  const insert=db.prepare('INSERT INTO lessons(id,course_id,title,section,sort_order,kind,primary_file,document_file,duration,active) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<17;i++)insert.run(id(100+i),id(1),'沟通 方法 第'+i+'讲','章节',i,'audio',id(500+i),null,90,1);
  insert.run(id(200),id(1),'沟通 文稿','',20,'document',null,id(600),0,1);
  insert.run(id(201),id(1),'完成 100%_目标\\复盘','',21,'audio',id(601),null,90,1);
  insert.run(id(202),id(1),'Communication Skills','',22,'audio',id(602),null,90,1);
  insert.run(id(203),id(1),'沟通 不显示','',23,'audio',id(603),null,90,0);
  insert.run(id(300),id(2),'沟通 少年','',1,'audio',id(700),null,90,1);
  insert.run(id(301),id(3),'沟通 下架','',1,'audio',id(701),null,90,1);
  const users=[],cookies=[];
  for(const name of ['SearchAlice','SearchBob']){
    const uid=Number(db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run(name,'unused',Date.now()).lastInsertRowid),token=crypto.randomBytes(32).toString('hex');
    users.push(uid);cookies.push('sid='+token);
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),uid,Date.now()+60000);
  }
  db.prepare('INSERT INTO progress(user_id,lesson_id,position,duration,completed,updated_at) VALUES(?,?,?,?,?,?)').run(users[0],id(100),42,125,1,Date.now());
  db.prepare('INSERT INTO lesson_favorites VALUES(?,?,?)').run(users[0],id(100),1234);
  const unchanged=()=>JSON.stringify(['progress','course_state','lesson_favorites'].map(table=>db.prepare('SELECT * FROM '+table).all()));
  const before=unchanged(),server=createApp(db,adult);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));config.collections=collections;db.close();await fs.rm(temp,{recursive:true,force:true})});
  const origin='http://127.0.0.1:'+server.address().port;
  async function search(params={},cookie=cookies[0]){
    const response=await fetch(origin+'/api/lessons/search?'+new URLSearchParams(params),{headers:cookie?{Cookie:cookie}:{}});
    return{status:response.status,data:await response.json()};
  }
  assert.equal((await search({q:'沟通'},null)).status,401);
  assert.equal((await search({q:'   '})).data.total,0);
  const first=await search({q:'沟通',limit:5});assert.equal(first.status,200);assert.equal(first.data.total,18);assert.equal(first.data.lessons.length,5);
  const alice=first.data.lessons.find(l=>l.id===id(100));assert.equal(alice.position,42);assert.equal(alice.duration,125);assert.equal(alice.isFavorite,true);assert.equal(alice.completed,1);
  const bob=(await search({q:'沟通'},cookies[1])).data.lessons.find(l=>l.id===id(100));assert.equal(bob.position,0);assert.equal(bob.isFavorite,false);assert.equal(bob.completed,0);
  const seen=[];let offset=0;
  while(true){const page=(await search({q:'沟通',offset,limit:5})).data;seen.push(...page.lessons.map(l=>l.id));if(!page.hasMore)break;assert.ok(page.nextOffset>offset);offset=page.nextOffset}
  assert.equal(seen.length,18);assert.equal(new Set(seen).size,18);assert.ok(seen.includes(id(200)));assert.ok(!seen.includes(id(203)));
  const junior=(await search({q:'沟通',shelf:'youth'})).data;assert.equal(junior.total,1);assert.equal(junior.lessons[0].courseId,id(2));
  assert.equal((await search({q:'方法   沟通'})).data.total,17);
  for(const q of ['%','_','\\'])assert.equal((await search({q})).data.total,1,q);
  assert.equal((await search({q:'communication'})).data.total,1);
  for(const q of ['课程名独有词','作者名独有词',"%' OR 1=1 --"]){const result=await search({q});assert.equal(result.status,200);assert.equal(result.data.total,0)}
  for(const params of [{q:'沟通',offset:-1},{q:'沟通',offset:1.5},{q:'沟通',limit:0},{q:'沟通',limit:51},{q:'沟通',shelf:'invalid'},{q:'x'.repeat(101)},{q:'a b c d e f g h i'}])assert.equal((await search(params)).status,400);
  assert.ok(!JSON.stringify(first.data).includes(temp));assert.ok(first.data.lessons.every(l=>!('source_root' in l)&&!('folder' in l)&&!('primary_file' in l)));
  assert.equal(unchanged(),before);
});

const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
const helpers=app.slice(app.indexOf('let lessonSearchTimer='),app.indexOf('async function renderLearning('));
function browserFixture(){
  const nodes=new Map(),requests=[],timers=[];let shelf='courses';
  const state={searchText:'one',searchKind:'lessons'};
  const context={URLSearchParams,Set,clearTimeout:()=>{},setTimeout:fn=>{timers.push(fn);return timers.length},navVersion:1,user:{id:1},
    browseState:()=>state,routeName:()=>shelf,esc:text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    icon:()=>'<svg></svg>',fmt:String,lessonFavoriteButton:()=>'<button></button>',empty:()=>'<div>empty</div>',fail:()=>{},
    api:url=>new Promise(resolve=>requests.push({url,resolve})),
    $:id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',setAttribute:()=>{},classList:{toggle:()=>{}},insertAdjacentHTML:(_where,html)=>{nodes.get(id).innerHTML+=html}});return nodes.get(id)}};
  vm.createContext(context);vm.runInContext(helpers,context);
  return{context,nodes,requests,timers,state,setShelf:value=>{shelf=value},run:code=>vm.runInContext(code,context)};
}
test('search highlights literal terms and escapes title HTML',()=>{
  const f=browserFixture();f.context.title='<img src=x onerror=alert(1)> 100% [方法]';
  const html=f.run("highlightLessonTitle(title,'[方法] 100%')");
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('<mark>[方法]</mark>'));assert.ok(html.includes('<mark>100%</mark>'));
});
test('a late response cannot replace a new query or another shelf',async()=>{
  const f=browserFixture();f.run('scheduleLessonSearch()');const old=f.timers.at(-1)();
  assert.ok(f.requests[0].url.includes('shelf=courses'));
  f.state.searchText='two';f.run('scheduleLessonSearch()');const fresh=f.timers.at(-1)();
  f.requests[0].resolve({lessons:[],total:99,nextOffset:0,hasMore:false});await old;
  assert.ok(!f.nodes.get('lesson-search-results').innerHTML.includes('99'));
  f.setShelf('youth');f.requests[1].resolve({lessons:[],total:88,nextOffset:0,hasMore:false});await fresh;
  assert.ok(!f.nodes.get('lesson-search-results').innerHTML.includes('88'));
});
