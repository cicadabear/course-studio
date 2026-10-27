import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
test('player initially focuses its title, not its favorite button; keyboard focus does not add a star box',async()=>{
  const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const css=await fs.readFile(new URL('../public/styles.css',import.meta.url),'utf8');
  const title=html.match(/<h2\b[^>]*id="player-title"[^>]*>/)?.[0];
  assert.ok(title);assert.match(title,/\btabindex="-1"/);assert.match(title,/\bautofocus\b/);
  assert.match(html,/<dialog\b[^>]*id="player-dialog"[^>]*aria-labelledby="player-title"/);
  assert.match(css,/\.player-favorite \.icon-button:focus-visible\{outline:none\}/);
  assert.match(css,/\.player-favorite \.icon-button:focus-visible svg\{[^}]*stroke-width:3/);
  const first=app.indexOf('function lessonFavoriteButton('),last=app.indexOf('async function toggleLessonFavorite(',first);
  const context={lessonFavoritePending:new Set(),esc:String,icon:()=>'<svg></svg>'};vm.createContext(context);
  vm.runInContext(app.slice(first,last),context);
  const button=vm.runInContext("lessonFavoriteButton({id:'lesson',title:'Lesson',isFavorite:false})",context);
  assert.match(button,/aria-pressed="false"/);assert.doesNotMatch(button,/autofocus/);
});
test('lesson unstar updates history/player/cache without rerendering or removing the saved row',async()=>{
  const first=app.indexOf('const lessonFavoritePending='),last=app.indexOf('function searchBox(',first);
  let redraws=0;
  const nodes=[{},{}],id='a'.repeat(24),lesson={id,title:'Saved lesson',isFavorite:true},history={...lesson};
  const context={user:{id:1},button:{dataset:{lessonFavorite:id,lessonTitle:lesson.title},getAttribute:()=> 'true'},
    detail:null,current:{data:{course:{id:'b'.repeat(24),title:'Course',author:'Teacher'},lessons:[lesson]}},queueData:null,
    document:{querySelectorAll:()=>nodes},requireUser:()=>false,api:async(url,method)=>{assert.equal(method,'DELETE');return{isFavorite:false,favoritedAt:null}},
    esc:String,icon:()=>'<svg></svg>',location:{hash:'#learning'},learningTab:'favorite-lessons',navVersion:7,
    renderLearning:()=>{redraws++},renderFavoriteLessons:()=>{redraws++},history};
  vm.createContext(context);vm.runInContext(app.slice(first,last),context);
  vm.runInContext('historyLessons=[history];favoriteLessonView={userId:1,lessons:[{...history}],loaded:true};',context);
  await vm.runInContext('toggleLessonFavorite(button)',context);
  assert.equal(lesson.isFavorite,false);assert.equal(history.isFavorite,false);assert.equal(redraws,0);
  assert.equal(context.navVersion,7);
  assert.equal(vm.runInContext('favoriteLessonView.lessons.length',context),1);
  assert.equal(vm.runInContext('favoriteLessonView.lessons[0].isFavorite',context),false);
  for(const node of nodes){assert.match(node.outerHTML,/aria-pressed="false"/);assert.equal(node.disabled,false)}
});

test('saved lesson view survives tab redraws and only manual refresh drops unstarred rows',async()=>{
  const first=app.indexOf('async function renderFavoriteLessons('),last=app.indexOf('async function renderDetail(',first);
  let requests=0;const content={innerHTML:''},refresh={},more={};
  const context={user:{id:1},favoriteLessonView:{userId:1,lessons:[{id:'a'.repeat(24),title:'Keep until refresh',courseId:'b'.repeat(24),courseTitle:'Course',author:'Teacher',isFavorite:false}],loaded:true,hasMore:false},
    navVersion:1,learningTab:'favorite-lessons',$:id=>id==='learning-content'?content:id==='favorite-lessons-refresh'?refresh:more,
    document:{querySelectorAll:()=>[]},esc:String,fmt:String,icon:()=>'',safe:fn=>fn,
    lessonFavoriteButton:l=>'<button aria-pressed="'+l.isFavorite+'"></button>',empty:title=>title,
    api:async()=>{requests++;return{lessons:[],hasMore:false,nextCursor:null}}};
  vm.createContext(context);vm.runInContext(app.slice(first,last),context);
  await vm.runInContext('renderFavoriteLessons(1)',context);
  assert.equal(requests,0);assert.match(content.innerHTML,/Keep until refresh/);assert.match(content.innerHTML,/aria-pressed="false"/);
  await vm.runInContext('renderFavoriteLessons(1,true)',context);
  assert.equal(requests,1);assert.doesNotMatch(content.innerHTML,/Keep until refresh/);
  assert.equal(context.favoriteLessonView.lessons.length,0);
});
