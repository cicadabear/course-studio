const $=id=>document.getElementById(id);
const icons={
  play:'<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause:'<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  next:'<path d="m5 5 10 7-10 7Z" fill="currentColor" stroke="none"/><path d="M19 5v14" stroke-width="2.5"/>',
  previous:'<path d="m19 5-10 7 10 7Z" fill="currentColor" stroke="none"/><path d="M5 5v14" stroke-width="2.5"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
  book:'<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v14"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  star:'<path d="m12 3 2.8 5.7 6.3.9-4.55 4.45 1.07 6.28L12 17.36l-5.62 2.97 1.07-6.28L2.9 9.6l6.3-.9Z"/>',
  share:'<path d="M12 15V3m-4 4 4-4 4 4M5 11v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  check:'<path d="m5 12 4 4 10-10"/>',
  queue:'<path d="M4 5h16M4 11h10M4 17h7"/><path d="m17 15 5 3-5 3Z" fill="currentColor" stroke="none"/>',
  add:'<path d="M4 5h16M4 11h10M4 17h7M18 13v8M14 17h8"/>',
  pdf:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
  right:'<path d="m9 5 7 7-7 7"/>',left:'<path d="m15 5-7 7 7 7"/>',
  up:'<path d="m6 15 6-6 6 6"/>',down:'<path d="m6 9 6 6 6-6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
  audio:'<path d="M5 14v-3a7 7 0 0 1 14 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
  rewind15:'<path d="M9.03 5A7.6 7.6 0 1 0 14.97 5"/><path d="M9.45 2.66 17.4 2.34 14.75 8.6Z" fill="currentColor" stroke="none"/><text x="12" y="15.6" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor" stroke="none">15</text>',
  forward15:'<path d="M14.97 5A7.6 7.6 0 1 1 9.03 5"/><path d="M14.55 2.66 9.25 8.6 6.6 2.34Z" fill="currentColor" stroke="none"/><text x="12" y="15.6" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor" stroke="none">15</text>',
  clock:'<circle cx="12" cy="12.5" r="8"/><path d="M12 8.5v4l2.8 1.8"/>',
  youth:'<path d="M4 8.5 12 4l8 4.5-8 4.5Z"/><path d="M7 11.5V17c3 2 7 2 10 0v-5.5M20 8.5V16"/>'
};
const icon=n=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+(icons[n]||icons.book)+'</svg>';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=t=>{t=Math.max(0,Math.floor(Number(t)||0));return(t>=3600?Math.floor(t/3600)+':':'')+String(Math.floor(t/60)%60).padStart(2,'0')+':'+String(t%60).padStart(2,'0')};
const palette={'经济金融':'#485d6b','历史人文':'#a17e58','科学科技':'#547979','心理生活':'#af8177','思维成长':'#48556b','文化艺术':'#8b655f','商业管理':'#647760'};
function cover(c){return '<div class="cover" style="--cover-bg:'+(palette[c.category]||'#647760')+'"><span class="cover-label">'+esc(c.category)+'</span><span class="cover-title">'+esc(c.title)+'</span><span class="cover-author">'+esc(c.author)+'</span></div>'}
let user=null,catalog=[],meta=null,detail=null,current=null,queueData=null,navVersion=0;
let catalogLoadVersion=0;
let learningTab='lessons',lessonFilter='all',lessonQuery='',visibleLessons=100,queueVisible=100,authMode='login',authCallback=null,listRoute='courses',canRegister=true,tagOrder=[];
const browseFilters={courses:{searchText:'',category:'全部',sort:'default'},youth:{searchText:'',category:'全部',sort:'default'}};
const browseState=()=>browseFilters[routeName()==='youth'?'youth':'courses'];
const shelfCourses=()=>catalog.filter(c=>(c.shelf||'courses')===(routeName()==='youth'?'youth':'courses'));
const routeLabel=()=>routeName()==='youth'?'少年课程':routeName()==='learning'?'我的':'课程列表';
const authLabel=()=>canRegister?'登录 / 注册':'登录';
let toastTimer,seekDragging=false,suppressPause=false,loadVersion=0,pending=new Map(),saving=false,lastCheckpoint=0;
// 从首页播放区进详情时记下要定位的课时，渲染后滚动到它。
let focusLessonId=null;
const audio=$('audio');
const iosStandalone=(/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))&&(navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches);
const loopBoundary={version:0,last:0,played:false};
const loopHandoff=iosStandalone||new URLSearchParams(location.search).get('loopHandoff')==='1';
audio.loop=loopHandoff;
try{localStorage.removeItem('zhixing.playback-trace')}catch{}
async function api(url,method='GET',data){
  const response=await fetch(url,{method,credentials:'same-origin',headers:data!==undefined?{'Content-Type':'application/json'}:{},body:data!==undefined?JSON.stringify(data):undefined});
  const result=await response.json().catch(()=>({error:'服务连接异常'}));
  if(!response.ok)throw Object.assign(new Error(result.error||'操作失败'),{status:response.status});
  return result;
}
function toast(s){$('toast').textContent=s;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),3500)}
function fail(e){toast(e.message||'操作失败')}
function safe(fn){return(...args)=>{try{return Promise.resolve(fn(...args)).catch(fail)}catch(e){fail(e)}}}
function openDialog(id){const d=$(id);if(!d.open)d.showModal()}
let lessonShare=null;
function lessonShareUrl(d,l){
  const url=new URL(location.href);
  url.username='';url.password='';url.search='';
  url.hash='course/'+d.course.id+'?lesson='+l.id;
  return url.href;
}
function showLessonShare(){
  if(!current)return;
  const {data:d,lesson:l}=current;
  lessonShare={title:l.title,text:d.course.title+' · '+l.title,url:lessonShareUrl(d,l)};
  $('share-title').textContent=l.title;$('share-course').textContent=d.course.title;
  $('share-url').value=lessonShare.url;
  $('share-native').hidden=typeof navigator.share!=='function';
  openDialog('share-dialog');
}
async function copyLessonShare(){
  if(!lessonShare)return;
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(lessonShare.url);toast('链接已复制');return}}catch{}
  const input=$('share-url');input.focus();input.select();input.setSelectionRange(0,input.value.length);
  try{if(document.execCommand('copy')){toast('链接已复制');return}}catch{}
  toast('请长按或选择链接复制');
}
async function nativeLessonShare(){
  if(!lessonShare||typeof navigator.share!=='function')return;
  try{await navigator.share(lessonShare)}catch(e){if(e.name!=='AbortError')toast('暂时无法打开系统分享，请复制链接')}
}
function requireUser(callback){if(user)return false;authCallback=callback;showAuth('login');return true}
function showAuth(mode){authMode=canRegister?mode:'login';$('auth-title').textContent=authMode==='login'?'欢迎回来':'创建你的账号';$('auth-subtitle').textContent=authMode==='login'?'登录后，继续上次的学习':'每一门课，都有自己的学习记录';$('auth-submit').textContent=authMode==='login'?'登录':'注册并开始';$('auth-switch').textContent=authMode==='login'?'没有账号？注册一个':'已有账号？去登录';$('auth-switch').style.display=canRegister?'':'none';$('password').autocomplete=authMode==='login'?'current-password':'new-password';$('auth-error').textContent='';openDialog('auth-dialog')}
function updateAccount(){
  $('account').innerHTML=user?'<span class="avatar">'+esc(user.username[0].toUpperCase())+'</span>'+esc(user.username):authLabel();
  $('account-name').textContent=user?.username||'';
}
async function loadCatalog(){
  const version=++catalogLoadVersion,shelf=routeName();
  const data=await api('/api/catalog'+(['courses','youth'].includes(shelf)?'?shelf='+shelf:''));
  if(version!==catalogLoadVersion)return false;
  catalog=data.courses;meta=data.meta;tagOrder=data.tagOrder||[];return true;
}
function routeName(){if(location.hash.startsWith('#learning'))listRoute='learning';else if(location.hash.startsWith('#youth'))listRoute='youth';else if(location.hash.startsWith('#transcript/'))listRoute='transcript';else if(!location.hash.startsWith('#course/'))listRoute='courses';return listRoute}
function navActive(){const name=routeName();document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===name))}
const favoritePending=new Set();
function favoriteButton(c,inDetail=false){
  const label=c.isFavorite?'取消收藏':'收藏课程';
  return '<button class="favorite-button '+(inDetail?'favorite-detail':'favorite-card')+'" data-favorite="'+c.id+'" data-favorite-detail="'+inDetail+'" aria-label="'+label+'：'+esc(c.title)+'" title="'+label+'" aria-pressed="'+!!c.isFavorite+'"'+(favoritePending.has(c.id)?' disabled':'')+'>'+icon('star')+'</button>';
}
async function toggleFavorite(id){
  if(requireUser(()=>toggleFavorite(id))||favoritePending.has(id))return;
  const course=catalog.find(c=>c.id===id)||[detail?.course,current?.data.course,queueData?.course].find(c=>c?.id===id);
  if(!course)return;
  const uid=user.id;
  favoritePending.add(id);
  document.querySelectorAll('[data-favorite="'+id+'"]').forEach(b=>b.disabled=true);
  try{
    const result=await api('/api/courses/'+id+'/favorite',course.isFavorite?'DELETE':'PUT',{});
    if(user?.id!==uid)return;
    for(const c of [...catalog,detail?.course,current?.data.course,queueData?.course])if(c?.id===id)Object.assign(c,result);
    document.querySelectorAll('[data-favorite="'+id+'"]').forEach(b=>b.outerHTML=favoriteButton(course,b.dataset.favoriteDetail==='true'));
    if(location.hash.startsWith('#learning')&&learningTab==='favorites')await renderLearning(++navVersion);
  }finally{
    favoritePending.delete(id);
    document.querySelectorAll('[data-favorite="'+id+'"]').forEach(b=>b.disabled=false);
  }
}
function courseCard(c,learning=false){
  const pct=c.audioCount?Math.min(100,Math.round(c.completedCount/c.lessonCount*100)):0;
  const learned=c.lastLesson;
  return '<article class="course-card-shell"><a class="course-card" href="#course/'+c.id+'">'+cover(c)+'<div class="course-content"><h3>'+esc(c.title)+'</h3><p class="author">'+esc(c.author)+'</p>'+
    (learning&&learned?'<p class="muted" style="font-size:12px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:8px">'+esc(learned.title||'继续学习')+(learned.position?' · '+fmt(learned.position):'')+'</p>':'')+
    '<div class="course-meta"><span>'+c.audioCount+' 讲音频</span></div>'+
    '<div class="course-footer"><span class="'+(c.completedCount?'orange':'muted')+'">'+(c.completedCount?'已完成 '+c.completedCount+' / '+c.lessonCount:'尚未开始')+'</span><span class="go">'+(c.lastLessonId?'继续学习':'开始学习')+icon('right')+'</span></div>'+
    (c.lastLessonId?'<div class="small-progress"><span style="width:'+pct+'%"></span></div>':'')+'</div></a>'+favoriteButton(c)+'</article>';
}
const lessonFavoritePending=new Set();
let favoriteLessonView=null,historyLessons=[];
function lessonFavoriteButton(l){
  const label=l.isFavorite?'取消收藏课时':'收藏课时';
  return '<button class="icon-button lesson-favorite" data-lesson-favorite="'+l.id+'" data-lesson-title="'+esc(l.title)+'" aria-label="'+label+'：'+esc(l.title)+'" title="'+label+'" aria-pressed="'+!!l.isFavorite+'"'+(lessonFavoritePending.has(l.id)?' disabled':'')+'>'+icon('star')+'</button>';
}
async function toggleLessonFavorite(button){
  const id=button.dataset.lessonFavorite;
  if(requireUser(()=>toggleLessonFavorite(button))||lessonFavoritePending.has(id))return;
  const uid=user.id,selected=button.getAttribute('aria-pressed')==='true',title=button.dataset.lessonTitle;
  lessonFavoritePending.add(id);
  document.querySelectorAll('[data-lesson-favorite="'+id+'"]').forEach(b=>b.disabled=true);
  try{
    const result=await api('/api/lessons/'+id+'/favorite',selected?'DELETE':'PUT',{});
    if(user?.id!==uid)return;
    let saved=historyLessons.find(l=>l.id===id);
    for(const d of [detail,current?.data,queueData]){
      const lesson=d?.lessons.find(l=>l.id===id);
      if(lesson){Object.assign(lesson,result);saved={...lesson,courseId:d.course.id,courseTitle:d.course.title,author:d.course.author}}
    }
    for(const l of historyLessons)if(l.id===id)Object.assign(l,result);
    const view=favoriteLessonView?.userId===uid?favoriteLessonView:null,listed=view?.lessons.find(l=>l.id===id);
    if(listed)Object.assign(listed,result);
    else if(result.isFavorite&&saved&&view?.loaded)view.lessons.unshift({...saved,...result});
    document.querySelectorAll('[data-lesson-favorite="'+id+'"]').forEach(b=>b.outerHTML=lessonFavoriteButton({id,title,...result}));
    // Keep unstarred rows and their position until the user explicitly refreshes.
    if(result.isFavorite&&!listed&&view?.loaded&&location.hash.startsWith('#learning')&&learningTab==='favorite-lessons')await renderFavoriteLessons(++navVersion);
  }finally{
    lessonFavoritePending.delete(id);
    document.querySelectorAll('[data-lesson-favorite="'+id+'"]').forEach(b=>b.disabled=false);
  }
}
function searchBox(id,value,placeholder){return '<label class="search">'+icon('search')+'<input id="'+id+'" type="search" placeholder="'+placeholder+'" value="'+esc(value)+'" aria-label="'+placeholder+'"></label>'}
function empty(title,text,action=''){return '<div class="empty">'+icon('book')+'<h3>'+title+'</h3><p>'+text+'</p>'+action+'</div>'}
function continuePanel(){
  const c=(routeName()==='learning'?catalog:shelfCourses()).filter(c=>c.lastLessonId).sort((a,b)=>(b.lastStudiedAt||b.stateUpdatedAt||0)-(a.lastStudiedAt||a.stateUpdatedAt||0))[0];
  if(!c)return '';
  return '<section class="continue-panel" data-course="'+c.id+'" tabindex="0" role="link" aria-label="打开课程详情">'+cover(c)+'<div class="continue-copy"><p class="eyebrow">接着上次，继续学习</p><h3>'+esc(c.author)+' · '+esc(c.title)+'</h3><p>'+esc(c.lastLesson?.title||'上次的课时')+' · '+fmt(c.lastLesson?.position||0)+'</p></div><button class="primary" id="continue-course" data-course="'+c.id+'" aria-label="继续播放">'+icon('play')+'继续播放</button></section>';
}
// 卡片任意位置进入课程详情；只有播放按钮继续播放，所以按钮要阻止冒泡。
function bindContinuePanel(){
  const panel=document.querySelector('.continue-panel[data-course]');
  if(!panel)return;
  const open=()=>{
    const c=catalog.find(x=>x.id===panel.dataset.course);
    focusLessonId=current?.data?.course.id===panel.dataset.course?current.lesson.id:c?.lastLessonId||null;
    location.hash='#course/'+panel.dataset.course;
  };
  panel.onclick=e=>{if(!e.target.closest('#continue-course'))open()};
  panel.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}};
  $('continue-course')?.addEventListener('click',safe(async e=>{e.stopPropagation();const d=await api('/api/courses/'+e.target.closest('[data-course]').dataset.course);await resumeCourse(d)}));
}
function renderCourseResults(){
  const {searchText,category,sort}=browseState(),terms=searchText.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let list=shelfCourses().filter(c=>(category==='全部'||(c.tags||[c.category]).includes(category))&&terms.every(t=>(c.title+' '+c.author+' '+(c.tags||[]).join(' ')).toLowerCase().includes(t)));
  if(sort==='recent')list.sort((a,b)=>(b.lastStudiedAt||b.stateUpdatedAt||0)-(a.lastStudiedAt||a.stateUpdatedAt||0));
  if(sort==='count')list.sort((a,b)=>b.audioCount-a.audioCount);
  $('course-count').textContent=list.length+' 门课程';
  $('course-grid').innerHTML=list.length?list.map(c=>courseCard(c)).join(''):empty('没有找到课程','试试其他关键词或分类');
}
function renderCourses(){
  detail=null;
  const state=browseState(),courses=shelfCourses(),available=new Set(courses.flatMap(c=>c.tags||[c.category]));
  const ordered=tagOrder.filter(t=>available.has(t));
  const cats=['全部',...ordered,...[...available].filter(t=>!ordered.includes(t)).sort((a,b)=>a.localeCompare(b,'zh-CN'))];
  if(!cats.includes(state.category))state.category='全部';
  const {searchText,category,sort}=state;
  $('main').innerHTML='<div class="page-heading"><div><h1>'+routeLabel()+'</h1><p>'+courses.length+' 门课程 · '+courses.reduce((n,c)=>n+(c.audioCount||0),0).toLocaleString()+' 讲音频</p></div>'+searchBox('course-search',searchText,'搜索课程、老师、标签')+'</div>'+
    (user?continuePanel():'')+'<div class="filters" aria-label="课程标签">'+cats.map(c=>'<button class="filter '+(category===c?'active':'')+'" data-category="'+esc(c)+'" aria-pressed="'+(category===c)+'">'+esc(c)+'</button>').join('')+'</div>'+
    '<div class="results-bar"><span id="course-count"></span><select id="course-sort" aria-label="课程排序"><option value="default">按老师排序</option><option value="recent">最近学习</option><option value="count">课时最多</option></select></div><div class="course-grid" id="course-grid"></div>';
  $('course-search').oninput=e=>{state.searchText=e.target.value;renderCourseResults()};
  $('course-sort').value=sort;$('course-sort').onchange=e=>{state.sort=e.target.value;renderCourseResults()};
  document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{state.category=b.dataset.category;document.querySelectorAll('[data-category]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))});renderCourseResults()});
  bindContinuePanel();
  renderCourseResults();
}
async function renderLearning(version){
  detail=null;
  $('main').innerHTML='<div class="page-heading"><div><h1>我的</h1><p>每次回来，都从这里接着听</p></div></div>';
  if(!user){$('main').innerHTML+=empty('登录后，记录你的学习','课程进度、播放队列和完成记录随账号保存','<button id="learning-login" class="primary">'+authLabel()+'</button>');$('learning-login').onclick=()=>showAuth('login');return}
  $('main').innerHTML+=continuePanel()+'<div class="course-tabs learning-tabs"><button data-learning-tab="lessons" class="'+(learningTab==='lessons'?'active':'')+'">在学课时</button><button data-learning-tab="completed" class="'+(learningTab==='completed'?'active':'')+'">完成课时</button><button data-learning-tab="courses" class="'+(learningTab==='courses'?'active':'')+'">在学课程</button><button data-learning-tab="favorites" class="'+(learningTab==='favorites'?'active':'')+'">收藏课程</button><button data-learning-tab="favorite-lessons" class="'+(learningTab==='favorite-lessons'?'active':'')+'">收藏课时</button></div><div id="learning-content" style="margin-top:22px"></div>';
  document.querySelectorAll('[data-learning-tab]').forEach(b=>b.onclick=safe(async()=>{learningTab=b.dataset.learningTab;await renderLearning(++navVersion)}));
  bindContinuePanel();
  if(learningTab==='favorite-lessons'){
    await renderFavoriteLessons(version);
  }else if(learningTab==='favorites'){
    const list=catalog.filter(c=>c.isFavorite).sort((a,b)=>(b.favoritedAt||0)-(a.favoritedAt||0));
    $('learning-content').innerHTML=list.length?'<div class="course-grid">'+list.map(c=>courseCard(c,true)).join('')+'</div>':empty('还没有收藏课程','点击课程上的星标，把喜欢的课程留在这里','<a class="primary" href="#courses">浏览课程</a>');
  }else if(learningTab==='courses'){
    const list=catalog.filter(c=>c.lastLessonId||c.lastStudiedAt).sort((a,b)=>(b.lastStudiedAt||b.stateUpdatedAt||0)-(a.lastStudiedAt||a.stateUpdatedAt||0));
    $('learning-content').innerHTML=list.length?'<div class="course-grid">'+list.map(c=>courseCard(c,true)).join('')+'</div>':empty('还没有开始学习','去课程列表，挑一门喜欢的课','<a class="primary" href="#courses">浏览课程</a>');
  }else{
    const tab=learningTab,completed=tab==='completed',list=[];
    historyLessons=list;
    async function loadHistory(){
      const data=await api('/api/history'+(completed?'?completed=1&offset=':'?offset=')+list.length);
      if(version!==navVersion||!$('learning-content')||learningTab!==tab)return;
      list.push(...data.lessons);
      const row=l=>{
        const done=!!l.completed,duration=Number(l.duration)||0,position=Number(l.position)||0;
        const state=done?'已完成':duration>0&&position>0?'听到 '+fmt(position)+' / '+fmt(duration):'已打开';
        return '<div class="history-row"><span class="completed-label'+(done?'':' pending')+'">'+(done?icon('check'):icon('play'))+'</span><div class="history-content"><h3>'+esc(l.title)+'</h3><p>'+esc(l.courseTitle)+' · '+new Date(l.updatedAt).toLocaleDateString('zh-CN')+' · '+state+'</p></div>'+lessonFavoriteButton(l)+'<button class="icon-button" data-history-lesson="'+l.id+'" data-course="'+l.courseId+'" aria-label="'+(done?'重新学习':'继续学习')+'">'+icon(l.kind==='document'?'pdf':'play')+'</button></div>';
      };
      $('learning-content').innerHTML=list.length?'<div class="history-list">'+list.map(row).join('')+'</div>'+(data.hasMore?'<button id="history-more" class="show-more">显示更多学习记录</button>':''):empty(completed?'完成记录会出现在这里':'听过的每一讲都会列在这里',completed?'听完一讲后会自动记录，也可以手动标记完成':'播放任意一讲，这里就会出现这一讲的音频和进度');
      document.querySelectorAll('[data-history-lesson]').forEach(b=>b.onclick=safe(async()=>{const d=await api('/api/courses/'+b.dataset.course),l=d.lessons.find(l=>l.id===b.dataset.historyLesson);if(l.mediaId)await playLesson(d,l.id,true);else openDocument(d,l)}));
      if($('history-more'))$('history-more').onclick=safe(async()=>{const button=$('history-more');button.disabled=true;try{await loadHistory()}finally{button.disabled=false}});
    }
    await loadHistory();
  }
}
async function renderFavoriteLessons(version,refresh=false){
  if(refresh||favoriteLessonView?.userId!==user.id)favoriteLessonView={userId:user.id,lessons:[],loaded:false,loading:false,cursor:null,hasMore:false};
  const view=favoriteLessonView,list=view.lessons;
  function render(){
    if(version!==navVersion||learningTab!=='favorite-lessons'||!$('learning-content'))return;
    const row=l=>'<div class="history-row favorite-lesson-row"><div class="history-content"><h3><a href="#course/'+l.courseId+'" data-focus-lesson="'+l.id+'">'+esc(l.title)+'</a></h3><p>'+esc(l.courseTitle)+' · '+esc(l.author)+(l.completed?' · 已完成':l.position?' · 已听 '+fmt(l.position):'')+'</p></div>'+lessonFavoriteButton(l)+'<button class="icon-button" data-favorite-play="'+l.id+'" data-course="'+l.courseId+'" aria-label="'+(l.mediaId?'播放课时':'阅读文稿')+'：'+esc(l.title)+'">'+icon(l.mediaId?'play':'pdf')+'</button></div>';
    $('learning-content').innerHTML='<div class="favorite-list-tools"><span>取消收藏后，手动刷新才会移除</span><button id="favorite-lessons-refresh" class="text-button">刷新列表</button></div>'+(list.length?'<div class="history-list">'+list.map(row).join('')+'</div>'+(view.hasMore?'<button id="favorite-lessons-more" class="show-more">显示更多收藏课时</button>':''):empty('还没有收藏课时','点击课时旁的小星标，把想反复听的内容留在这里','<a class="primary" href="#courses">浏览课程</a>'));
    $('favorite-lessons-refresh').onclick=safe(()=>renderFavoriteLessons(++navVersion,true));
    document.querySelectorAll('[data-favorite-play]').forEach(b=>b.onclick=safe(async()=>{
      const d=await api('/api/courses/'+b.dataset.course),l=d.lessons.find(l=>l.id===b.dataset.favoritePlay);
      if(!l)throw new Error('课时暂时不可用');
      if(l.mediaId)await playLesson(d,l.id);else openDocument(d,l);
    }));
    if($('favorite-lessons-more'))$('favorite-lessons-more').onclick=safe(async()=>{const b=$('favorite-lessons-more');b.disabled=true;try{await load()}finally{b.disabled=false}});
  }
  async function load(){
    if(view.loading)return;
    view.loading=true;
    try{
      const data=await api('/api/lesson-favorites'+(view.loaded?'?cursor='+encodeURIComponent(view.cursor):''));
      if(user?.id!==view.userId||favoriteLessonView!==view)return;
      const known=new Set(list.map(l=>l.id));
      for(const l of data.lessons)if(!known.has(l.id)){list.push(l);known.add(l.id)}
      view.loaded=true;view.cursor=data.nextCursor;view.hasMore=data.hasMore;render();
    }finally{view.loading=false}
  }
  if(view.loaded)render();else await load();
}
async function renderDetail(id,version){
  const data=await api('/api/courses/'+id);
  if(version!==navVersion)return;
  detail=data;lessonFilter='all';lessonQuery='';visibleLessons=100;
  if(current?.data.course.id===id){
    detail=current.data;mergeProgress(data,current.data);Object.assign(detail.course,data.course);
    const fresh=new Map(data.lessons.map(l=>[l.id,l]));
    for(const l of detail.lessons){const saved=fresh.get(l.id);if(saved)Object.assign(l,{isFavorite:saved.isFavorite,favoritedAt:saved.favoritedAt})}
  }
  const d=detail,c=d.course,done=d.lessons.filter(l=>l.completed).length,audios=d.lessons.filter(l=>l.mediaId).length;
  $('main').innerHTML='<a class="back-link" href="#'+routeName()+'">'+icon('left')+'返回'+routeLabel()+'</a><section class="course-hero">'+cover(c)+'<div class="hero-copy"><p class="eyebrow">'+esc(c.category)+'</p><h1>'+esc(c.title)+'</h1><p class="author">'+esc(c.author)+'</p><p class="hero-details">'+audios+' 讲音频 · '+d.lessons.filter(l=>l.documentId).length+' 份文稿 · <span id="hero-completed">已完成 '+done+' 讲</span></p><div class="hero-actions"><button class="primary" id="resume-course">'+icon('play')+(d.state.lastLessonId?'继续学习':'开始学习')+'</button><button class="secondary" id="course-queue">播放队列</button></div></div>'+favoriteButton(c,true)+'</section>'+
    '<div class="course-tabs"><button data-lesson-filter="all" class="active">全部课时</button><button data-lesson-filter="unfinished">未完成</button><button data-lesson-filter="completed">已完成</button></div>'+
    '<div class="lesson-controls">'+searchBox('lesson-search','','搜索本课程课时')+'</div><div id="lesson-list" class="lesson-list"></div><button class="show-more hidden" id="lesson-more">显示更多课时</button>';
  $('resume-course').onclick=safe(()=>resumeCourse(detail));
  $('course-queue').onclick=()=>openQueue(detail);
  $('lesson-search').oninput=e=>{lessonQuery=e.target.value;visibleLessons=100;renderLessons()};
  document.querySelectorAll('[data-lesson-filter]').forEach(b=>b.onclick=()=>{lessonFilter=b.dataset.lessonFilter;visibleLessons=100;document.querySelectorAll('[data-lesson-filter]').forEach(x=>x.classList.toggle('active',x===b));renderLessons()});
  $('lesson-more').onclick=()=>{visibleLessons+=100;renderLessons()};
  renderLessons();
}
function mergeProgress(from,to){
  const byId=new Map(from.lessons.map(l=>[l.id,l]));
  for(const l of to.lessons){const r=byId.get(l.id);if(r&&(r.updatedAt||0)>(l.updatedAt||0))Object.assign(l,{position:r.position,duration:r.duration,completed:r.completed,updatedAt:r.updatedAt})}
}
function lessonStatus(l){
  if(l.completed)return '<span class="completed-label">'+icon('check')+'已完成</span>';
  if(l.position>0)return '<span class="orange">已听 '+fmt(l.position)+'</span>';
  return '<span>'+(l.mediaId?'未播放':'文稿')+'</span>';
}
function renderLessons(){
  if(!detail||!$('lesson-list'))return;
  const d=detail,queue=new Set(d.state.queue);
  const list=d.lessons.filter(l=>(lessonFilter==='all'||lessonFilter==='completed'&&l.completed||lessonFilter==='unfinished'&&!l.completed)&&(!lessonQuery||l.title.toLowerCase().includes(lessonQuery.toLowerCase())));
  // 要定位的课时可能在当前显示数量之外，先扩大显示范围保证它被渲染出来。
  if(focusLessonId){const at=list.findIndex(l=>l.id===focusLessonId);if(at>=visibleLessons)visibleLessons=Math.ceil((at+1)/100)*100}
  let html='';
  for(const l of list.slice(0,visibleLessons)){
    const active=current?.lesson.id===l.id;
    html+='<div class="lesson-row '+(active?'current':'')+(focusLessonId===l.id?' resume-target':'')+'" data-row="'+l.id+'"><span class="lesson-number">'+(active?icon('audio'):String(l.sortOrder+1).padStart(2,'0'))+'</span><button class="lesson-body" data-play="'+l.id+'"><span class="lesson-title">'+esc(l.title)+'</span><span class="lesson-sub">'+lessonStatus(l)+(l.duration?'<span>'+fmt(l.duration)+'</span>':'')+(l.documentId&&l.mediaId?'<span>含文稿</span>':'')+'</span></button><div class="lesson-actions">'+(l.documentId&&l.mediaId?'<button class="icon-button" data-pdf="'+l.id+'" aria-label="阅读文稿" title="阅读文稿">'+icon('pdf')+'</button>':'')+
      (l.mediaId?'<button class="icon-button '+(queue.has(l.id)?'in-queue':'')+'" data-enqueue="'+l.id+'" aria-label="'+(queue.has(l.id)?'从队列移除':'加入队列')+'" title="'+(queue.has(l.id)?'从队列移除':'加入队列')+'">'+icon(queue.has(l.id)?'queue':'add')+'</button>':'')+
      lessonFavoriteButton(l)+'<button class="icon-button '+(l.completed?'done':'')+'" data-complete="'+l.id+'" aria-label="'+(l.completed?'取消完成':'标记完成')+'" title="'+(l.completed?'取消完成':'标记完成')+'">'+icon('check')+'</button></div></div>';
  }
  $('lesson-list').innerHTML=html||empty('没有符合条件的课时','试试其他关键词或筛选');
  $('lesson-more').classList.toggle('hidden',list.length<=visibleLessons);
  $('hero-completed').textContent='已完成 '+d.lessons.filter(l=>l.completed).length+' 讲';
  document.querySelectorAll('[data-play]').forEach(b=>b.onclick=safe(()=>{const l=d.lessons.find(x=>x.id===b.dataset.play);return l.mediaId?playLesson(d,l.id):openDocument(d,l)}));
  document.querySelectorAll('[data-pdf]').forEach(b=>b.onclick=()=>openDocument(d,d.lessons.find(l=>l.id===b.dataset.pdf)));
  document.querySelectorAll('[data-complete]').forEach(b=>b.onclick=safe(()=>toggleComplete(d,d.lessons.find(l=>l.id===b.dataset.complete))));
  document.querySelectorAll('[data-enqueue]').forEach(b=>b.onclick=safe(()=>toggleQueue(d,b.dataset.enqueue)));
  // 定位到上次听到的那一讲：滚动过去并短暂高亮。
  if(focusLessonId){
    const target=$('lesson-list').querySelector('[data-row="'+focusLessonId+'"]');
    focusLessonId=null;
    if(target)requestAnimationFrame(()=>{
      target.scrollIntoView({block:'center'});
      setTimeout(()=>target.classList.remove('resume-target'),2600);
    });
  }
}
async function route(){
  const version=++navVersion;navActive();
  document.body.classList.remove('transcript-route');
  const m=/^#course\/([a-f0-9]{24})(?:\?lesson=([a-f0-9]{24}))?$/.exec(location.hash);
  const t=/^#transcript\/([a-f0-9]{24})$/.exec(location.hash);
  try{
    if(t)await renderTranscriptRoute(t[1],version);
    else if(m){
      if(m[2])focusLessonId=m[2];
      $('main').innerHTML='<div class="loading">正在打开课程…</div>';await renderDetail(m[1],version);
      if(m[2]&&version===navVersion){
        const lesson=detail.lessons.find(l=>l.id===m[2]);
        if(!lesson?.mediaId)throw new Error('分享的课时不存在或暂无音频');
        listRoute=detail.course.shelf==='youth'?'youth':'courses';navActive();
        await playLesson(detail,lesson.id,false,true,false);
      }
    }
    else if(routeName()==='learning')await renderLearning(version);
    else renderCourses();
    if(version===navVersion){window.scrollTo(0,0);if(current&&!t)$('mini-player').classList.remove('hidden')}
  }catch(e){if(version!==navVersion)return;$('main').innerHTML=empty('暂时无法打开',esc(e.message),'<button class="primary" id="retry-page">重试</button>');$('retry-page').onclick=safe(route)}
}
function outboxKey(){return 'zhixing.progress.'+(user?.id||0)}
function storePending(){try{if(user)localStorage.setItem(outboxKey(),JSON.stringify([...pending.entries()]))}catch{}}
function restorePending(){try{pending=new Map(JSON.parse(localStorage.getItem(outboxKey())||'[]'))}catch{pending=new Map()}}
function setSaveStatus(text,failed=false){$('save-status').textContent=text;$('save-status').classList.toggle('failed',failed)}
function snapshot(completed){
  if(!current||!user||!current.ready||current.finished)return null;
  const duration=Number.isFinite(audio.duration)?audio.duration:(current.lesson.duration||0),position=Math.min(audio.currentTime||0,duration||audio.currentTime||0);
  return {lessonId:current.lesson.id,position:Math.max(0,position),duration:Math.max(0,duration),completed:completed??!!current.lesson.completed,observedAt:Date.now(),touchCurrent:true};
}
function applyLocal(record){
  const pools=[detail,current?.data,queueData].filter(Boolean);
  for(const d of pools){const l=d.lessons.find(l=>l.id===record.lessonId);if(l){Object.assign(l,{position:record.position,duration:record.duration,completed:Number(record.completed),updatedAt:Date.now()});if(l.mediaId&&record.touchCurrent!==false)d.state.lastLessonId=l.id}}
}
function enqueueProgress(record){
  if(!user||!record)return;
  record={...record,observedAt:record.observedAt??Date.now()};
  pending.set(record.lessonId,record);storePending();applyLocal(record);void drainProgress();
}
async function drainProgress(){
  if(saving||!user||!pending.size)return;
  saving=true;const owner=user.id;
  try{
    // 保存途中同一课时的记录可能被更新（例如 pause 之后紧跟 ended），所以每轮都取当前第一条，直到队列清空。
    for(let guard=0;pending.size&&guard<24;guard++){
      if(!user||user.id!==owner)break;
      const[id,record]=pending.entries().next().value;
      await api('/api/progress','POST',record);
      if(pending.get(id)===record)pending.delete(id);
      storePending();setSaveStatus('进度已保存 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));
    }
  }catch(e){setSaveStatus(e.status===401?'登录已过期，请重新登录':'连接中断，进度已暂存，联网后重试',true)}
  finally{saving=false}
}
async function flushProgress(){
  enqueueProgress(snapshot());
  // Finish outstanding saves before switching identities; normal playback remains responsive.
  const until=Date.now()+8000;
  while(saving&&Date.now()<until)await new Promise(r=>setTimeout(r,30));
  if(pending.size)await drainProgress();
}
async function freshCourse(d){const n=await api('/api/courses/'+d.course.id);return n}
async function resumeCourse(d){
  if(requireUser(async()=>resumeCourse(await freshCourse(d))))return;
  if(current?.data.course.id===d.course.id){openDialog('player-dialog');if(audio.paused)await startAudio();return}
  let target=d.lessons.find(l=>l.id===d.state.lastLessonId&&l.mediaId);
  if(target?.completed){const index=d.state.queue.indexOf(target.id),next=d.state.queue.slice(index+1).find(id=>!d.lessons.find(l=>l.id===id)?.completed);if(next)target=d.lessons.find(l=>l.id===next)}
  target??=d.lessons.find(l=>d.state.queue.includes(l.id)&&!l.completed)||d.lessons.find(l=>l.mediaId);
  if(!target){toast('这门课程暂时只有文稿，可在目录中阅读');return}
  await playLesson(d,target.id);
}
function prepareAudioSession(){
  try{if(navigator.audioSession&&navigator.audioSession.type!=='playback')navigator.audioSession.type='playback'}catch{}
  audio.muted=false;
}
function resetLoopBoundary(){
  loopBoundary.version=current?.version||0;loopBoundary.last=0;loopBoundary.played=false;
}
function seekAudio(position){
  // Move our baseline before a manual seek so a seek to zero is not treated as a loop.
  const duration=Number.isFinite(audio.duration)?audio.duration:Infinity;
  const target=Math.max(0,Math.min(duration,Number(position)||0));
  loopBoundary.last=target;audio.currentTime=target;
}
function handleLoopBoundary(){
  if(!loopHandoff||!audio.loop||!current?.ready||current.finished||loopBoundary.version!==current.version)return false;
  const position=audio.currentTime,duration=audio.duration;
  const wrapped=loopBoundary.played&&Number.isFinite(duration)&&duration>0&&
    loopBoundary.last>Math.min(3,duration/2)&&position<Math.min(1.5,duration/4)&&
    loopBoundary.last-position>Math.min(2,duration/2);
  loopBoundary.last=position;
  if(!wrapped)return false;
  // Native looping keeps the iOS session alive; hand off synchronously, without a timer.
  void onAudioEnded(true).catch(fail);return true;
}
async function startAudio(){
  if(!current)return;
  const playing=current,version=playing.version;
  playing.finished=false;
  prepareAudioSession();
  try{
    await audio.play();
    if(current!==playing||current.version!==version)return;
    setSaveStatus('播放进度自动保存');
  }catch(e){
    if(current!==playing||current.version!==version)return;
    if(e.name==='NotAllowedError'){
      setSaveStatus('系统未允许自动播放，请点击播放继续',true);
      toast('系统未允许自动播放，请点击播放继续');
    }else if(e.name!=='AbortError')throw e;
    updatePlayButtons();
  }
}
async function playLesson(d,id,fromStart=false,openPlayer=true,autoplay=true){
  if(requireUser(async()=>playLesson(await freshCourse(d),id,fromStart,openPlayer,autoplay)))return;
  const l=d.lessons.find(x=>x.id===id);if(!l?.mediaId)return;
  if(current?.lesson.id===id&&!fromStart){if(openPlayer)openDialog('player-dialog');if(audio.paused&&autoplay)await startAudio();return}
  // Do not await a network save between tracks: iOS may suspend that await in the background.
  enqueueProgress(snapshot());
  const version=++loadVersion;
  suppressPause=true;audio.pause();suppressPause=false;
  current={data:d,lesson:l,ready:false,version,target:fromStart||l.completed?0:(l.position||0)};
  resetLoopBoundary();
  d.state.lastLessonId=id;
  audio.src='/media/'+l.mediaId;
  audio.load();audio.playbackRate=d.state.rate;
  const playing=autoplay?startAudio():null;
  updatePlayer();renderLessons();void loadTranscript(l);
  if(openPlayer)openDialog('player-dialog');
  await playing;
}
function updatePlayer(){
  if(!current)return;
  const {data:d,lesson:l}=current;
  $('mini-player').classList.toggle('hidden',location.hash.startsWith('#transcript/'));$('mini-cover').innerHTML=cover(d.course);$('mini-title').textContent=l.title;$('mini-course').textContent=d.course.author+' · '+d.course.title;
  $('player-cover').innerHTML=cover(d.course);$('player-course').textContent=d.course.author+' · '+d.course.title;$('player-title').textContent=l.title;
  $('player-favorite').innerHTML=lessonFavoriteButton(l);
  $('rate').value=String(d.state.rate);$('autonext').checked=d.state.autonext;$('player-pdf').classList.toggle('hidden',!l.documentId);
  $('open-transcript').classList.toggle('hidden',!l.hasTranscript);
  $('sleep-dialog').close();renderSleep();
  $('player-complete').textContent=l.completed?'取消已完成标记':'标记已完成';
  updatePlayButtons();updateTimes();
  if('mediaSession' in navigator&&typeof MediaMetadata!=='undefined'){
    // Use a full-size raster cover: iOS can mis-size the small SVG in Now Playing.
    try{navigator.mediaSession.metadata=new MediaMetadata({title:l.title,artist:d.course.author,album:d.course.title,artwork:[{src:location.origin+'/media-artwork.png',sizes:'512x512',type:'image/png'}]})}catch{}
  }
}
function updatePlayButtons(){
  const name=audio.paused?'play':'pause';$('mini-play').innerHTML=icon(name);$('play-toggle').innerHTML=icon(name);
  if($('t-play'))$('t-play').innerHTML=icon(name);
  $('mini-play').setAttribute('aria-label',audio.paused?'播放':'暂停');$('play-toggle').setAttribute('aria-label',audio.paused?'播放':'暂停');
  if($('t-play'))$('t-play').setAttribute('aria-label',audio.paused?'播放':'暂停');
  if('mediaSession' in navigator)navigator.mediaSession.playbackState=audio.paused?'paused':'playing';
}
function updateTimes(){
  const duration=Number.isFinite(audio.duration)?audio.duration:0,pos=current?.finished?duration:audio.currentTime||0;
  if(!seekDragging)$('seek').value=duration?String(pos/duration*1000):'0';
  $('time-current').textContent=fmt(pos);$('time-total').textContent=fmt(duration);$('mini-progress-fill').style.width=(duration?pos/duration*100:0)+'%';
  if($('t-seek')){if(!seekDragging)$('t-seek').value=duration?String(pos/duration*1000):'0';$('t-current').textContent=fmt(pos);$('t-total').textContent=fmt(duration)}
  if('mediaSession' in navigator&&duration>0){try{navigator.mediaSession.setPositionState({duration,playbackRate:audio.playbackRate,position:Math.min(pos,duration)})}catch{}}
}
function togglePlay(){if(!current)return;if(audio.paused)return startAudio();audio.pause()}
function hop(seconds){if(current&&current.ready){seekAudio(audio.currentTime+seconds);enqueueProgress(snapshot());updateTimes()}}
// 定时停止播放：按真实时间倒计时，或播完 N 讲后停止；与倍速无关，设置存在本机，刷新后继续。
let sleep={mode:'off',minutes:0,endsAt:0,count:0,interval:null};
const sleepKey=()=>'zhixing.sleep.'+(user?.id||0);
const fmtLeft=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
const sleepLeft=()=>Math.max(0,Math.ceil((sleep.endsAt-Date.now())/1000));
const sleepSummary=()=>sleep.mode==='minutes'?fmtLeft(sleepLeft()):sleep.mode==='lessons'?'播完 '+sleep.count+' 讲':'';
function renderSleep(){
  $('sleep-label').textContent=sleep.mode==='off'?'定时':sleepSummary();
  $('sleep').classList.toggle('on',sleep.mode!=='off');
  $('sleep').setAttribute('aria-label',sleep.mode==='minutes'?'定时停止播放，剩余 '+sleepSummary():sleep.mode==='lessons'?'定时停止播放，'+sleepSummary()+'后停止':'定时停止播放');
  $('sleep-heading').textContent=sleep.mode==='minutes'?'剩余 '+sleepSummary()+' 后停止':sleep.mode==='lessons'?sleepSummary()+'后停止':'选择停止播放的时间';
}
function upcomingLessons(n){
  if(!current)return[];
  const d=current.data,queue=d.state.queue,index=queue.indexOf(current.lesson.id);
  const ids=index<0?[current.lesson.id,...queue]:queue.slice(index,index+n);
  return ids.map(id=>d.lessons.find(l=>l.id===id)).filter(l=>l?.mediaId).slice(0,n);
}
function averageDuration(d){const known=d.lessons.filter(l=>l.mediaId&&Number(l.duration)>0).map(l=>Number(l.duration));return known.length?known.reduce((a,b)=>a+b,0)/known.length:0}
function estimateMinutes(n){
  const list=upcomingLessons(n);if(!list.length||!current)return 0;
  const fallback=averageDuration(current.data);let seconds=0;
  for(const l of list){
    const duration=Number(l.duration)>0?Number(l.duration):fallback;if(duration<=0)continue;
    seconds+=Math.max(0,duration-(l.id===current.lesson.id?Math.min(audio.currentTime||l.position||0,duration):0));
  }
  return seconds>0?Math.max(1,Math.round(seconds/(current.data.state.rate||1)/60)):0;
}
function renderSleepRows(){
  const minutes=[15,30,60].map(m=>{const on=sleep.mode==='minutes'&&sleep.minutes===m;return '<button class="sleep-row'+(on?' on':'')+'" data-sleep-minutes="'+m+'"><span>'+m+' 分钟后</span><em>'+(on?'剩余 '+fmtLeft(sleepLeft()):'')+'</em></button>'}).join('');
  const lessons=[1,2,3].map(n=>{const on=sleep.mode==='lessons'&&sleep.count===n,estimate=estimateMinutes(n);return '<button class="sleep-row'+(on?' on':'')+'" data-sleep-lessons="'+n+'"><span>'+(n===1?'播完当前':'播完 '+n+' 讲')+'</span><em>'+(on?'剩余 '+sleep.count+' 讲':estimate?'约 '+estimate+' 分钟后':'时长未知')+'</em></button>'}).join('');
  const off=sleep.mode==='off'?'':'<button class="sleep-row sleep-off" data-sleep-off><span>关闭倒计时</span><em>'+(sleep.mode==='minutes'?'剩余 '+sleepSummary():sleepSummary())+'</em></button>';
  $('sleep-rows').innerHTML=minutes+lessons+off;
  document.querySelectorAll('[data-sleep-minutes]').forEach(b=>b.onclick=safe(()=>startSleep('minutes',Number(b.dataset.sleepMinutes))));
  document.querySelectorAll('[data-sleep-lessons]').forEach(b=>b.onclick=safe(()=>startSleep('lessons',0,0,Number(b.dataset.sleepLessons))));
  document.querySelectorAll('[data-sleep-off]').forEach(b=>b.onclick=safe(()=>clearSleep(true)));
}
function openSleep(){renderSleepRows();openDialog('sleep-dialog');$('sleep').setAttribute('aria-expanded','true')}
function closeSleepDialog(){if($('sleep-dialog').open)$('sleep-dialog').close()}
function persistSleep(){try{if(!user)return;const key=sleepKey();if(sleep.mode==='off')localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify({mode:sleep.mode,minutes:sleep.minutes,endsAt:sleep.endsAt,count:sleep.count}))}catch{}}
function startSleep(mode,minutes=0,endsAt=0,count=0,announce=true){
  clearInterval(sleep.interval);
  const until=mode==='minutes'?(Number(endsAt)||Date.now()+minutes*60000):0;
  sleep={mode,minutes,endsAt:until,count,interval:mode==='minutes'?setInterval(tickSleep,1000):null};
  persistSleep();renderSleep();closeSleepDialog();
  if(announce)toast(mode==='minutes'?'定时已设置：'+minutes+' 分钟后停止播放':'定时已设置：播完 '+count+' 讲后停止播放');
}
function clearSleep(announce=false){
  clearInterval(sleep.interval);sleep={mode:'off',minutes:0,endsAt:0,count:0,interval:null};persistSleep();renderSleep();closeSleepDialog();
  if(announce)toast('已取消定时停止播放');
}
function tickSleep(){if(sleep.mode!=='minutes')return;if(Date.now()>=sleep.endsAt)finishSleep('定时结束，已停止播放');else renderSleep()}
function finishSleep(message){
  clearInterval(sleep.interval);sleep={mode:'off',minutes:0,endsAt:0,count:0,interval:null};persistSleep();renderSleep();closeSleepDialog();
  if(!audio.paused)audio.pause();toast(message);
}
function restoreSleep(){
  let saved=null;try{saved=JSON.parse(localStorage.getItem(sleepKey())||'null')}catch{}
  if(saved?.mode==='minutes'&&Number(saved.endsAt)>Date.now())return startSleep('minutes',Number(saved.minutes),Number(saved.endsAt),0,false);
  if(saved?.mode==='lessons'&&Number(saved.count)>0)return startSleep('lessons',0,0,Number(saved.count),false);
  if(saved){try{localStorage.removeItem(sleepKey())}catch{}}
  sleep={mode:'off',minutes:0,endsAt:0,count:0,interval:null};renderSleep();
}
// 文稿跟随页：整页逐句文稿，当前句高亮并自动跟随；滚出画面时出现「回到当前播放位置」。
const transcriptCache=new Map();
let transcript={lessonId:null,lines:[],times:[],blocks:[],timed:false,index:-1,holdUntil:0},autoScrolling=false;
function clearTranscript(){transcript={lessonId:null,lines:[],times:[],blocks:[],timed:false,index:-1,holdUntil:0}}
// 有真实时间戳（Align API 写进 transcripts.timed）就用秒；没有才退回按字数估算比例。
function sentenceTimes(data){
  const n=data.lines.length,timed=Array.isArray(data.timed)?data.timed:[];
  if(timed.length===n&&timed.some(x=>x&&x.t!=null)){
    const out=[];let last=0;
    for(let i=0;i<n;i++){const raw=timed[i],t=raw&&raw.t!=null?Number(raw.t):null;out.push(t==null?last:t);if(t!=null)last=t}
    return out;
  }
  const weights=data.lines.map(s=>Math.max(1,Array.from(s).length)),total=weights.reduce((a,b)=>a+b,0);
  let acc=0;return weights.map(w=>{const start=acc;acc+=w/total;return start});
}
async function loadTranscript(l){
  if(!l.hasTranscript){clearTranscript();return null}
  if(transcript.lessonId===l.id)return transcript;
  let data=transcriptCache.get(l.id);
  if(!data){try{data=await api('/api/lessons/'+l.id+'/transcript')}catch{clearTranscript();return null}transcriptCache.set(l.id,data)}
  const times=sentenceTimes(data),timed=Array.isArray(data.timed)&&data.timed.length===data.lines.length&&data.timed.some(x=>x&&x.t!=null);
  transcript={lessonId:l.id,lines:data.lines,times,blocks:Array.isArray(data.blocks)?data.blocks:[],timed,index:-1,holdUntil:0};
  return transcript;
}
// 版式：小标题 + 段落（段落里句子连排，和 PDF 一样），每句仍然是可点跳转的时间锚点
function transcriptBodyMarkup(){
  if(!transcript.blocks.length)return transcript.lines.map((s,i)=>'<p class="t-p"><span class="t-s" data-i="'+i+'">'+esc(s)+'</span></p>').join('');
  return transcript.blocks.map(b=>b.k==='h'
    ? '<h2 class="t-h" style="--hs:'+Math.min(1.5,Math.max(1.12,Number(b.size)||1.25))+'">'+esc(b.text)+'</h2>'
    : '<p class="t-p">'+(b.s||[]).map(i=>'<span class="t-s" data-i="'+i+'">'+esc(transcript.lines[i]||'')+'</span>').join('')+'</p>').join('');
}
function transcriptPageMarkup(d,l){
  const duration=Number(l.duration)||0;
  return '<div class="transcript-page"><div class="transcript-top"><button id="transcript-back" class="icon-button" aria-label="返回课程"></button><span class="transcript-top-text"><strong>'+esc(l.title)+'</strong><small>'+esc(d.course.author+' · '+d.course.title)+'</small></span><span class="transcript-count">'+transcript.lines.length+' 句</span></div><article class="article-body"><h1 class="article-title">'+esc(l.title)+'</h1><div class="article-meta">'+esc(d.course.author)+'　'+fmt(duration)+'　'+esc(d.course.title)+'</div><div id="transcript-lines" class="article-text">'+transcriptBodyMarkup()+'</div></article><button id="transcript-locate" class="locate-pill" hidden>↑ 回到当前播放位置</button><div class="transcript-bar"><div class="seek"><input id="t-seek" type="range" min="0" max="1000" value="0" aria-label="播放进度"><div class="times"><span id="t-current">00:00</span><span id="t-total">00:00</span></div></div><div class="transport"><button id="t-previous" class="icon-button" aria-label="上一讲"></button><button id="t-back" class="skip" aria-label="后退 15 秒"></button><button id="t-play" class="big-play" aria-label="播放 / 暂停"></button><button id="t-forward" class="skip" aria-label="前进 15 秒"></button><button id="t-next" class="icon-button" aria-label="下一讲"></button></div></div></div>';
}
function transcriptIndex(){
  if(!transcript.times.length)return -1;
  const now=Number(audio.currentTime)||0;
  if(!transcript.timed){
    const duration=Number.isFinite(audio.duration)?audio.duration:0;
    if(!duration)return -1;
    const fraction=Math.min(1,Math.max(0,now/duration));
    for(let i=transcript.times.length-1;i>=0;i--)if(fraction>=transcript.times[i])return i;
    return 0;
  }
  let lo=0,hi=transcript.times.length-1,res=0;
  while(lo<=hi){const mid=(lo+hi)>>1;if(transcript.times[mid]<=now+.25){res=mid;lo=mid+1}else hi=mid-1}
  return res;
}
function activeTranscriptLine(){
  const box=$('transcript-lines');
  if(!box||transcript.index<0)return null;
  return box.querySelector('.t-s[data-i="'+transcript.index+'"]');
}
function lineInView(line){if(!line)return true;const r=line.getBoundingClientRect();return r.top<innerHeight*.72&&r.bottom>96}
function updateLocatePill(){const pill=$('transcript-locate');if(pill)pill.hidden=lineInView(activeTranscriptLine())}
let pillTimer=null;
function settleLocatePill(){
  clearTimeout(pillTimer);
  const step=remaining=>{updateLocatePill();if(remaining>0)pillTimer=setTimeout(()=>step(remaining-1),200)};
  step(8);
}
function scrollToTranscript(){
  const line=activeTranscriptLine();if(!line)return;
  autoScrolling=true;
  window.scrollTo({top:Math.max(0,line.getBoundingClientRect().top+window.scrollY-innerHeight*.34),behavior:'smooth'});
  setTimeout(()=>{autoScrolling=false},500);
  settleLocatePill();
}
function highlightTranscript(force=false){
  if(!transcript.lines.length||!$('transcript-lines'))return;
  const index=transcriptIndex();
  if(index===transcript.index&&!force)return;
  const box=$('transcript-lines'),previous=box.querySelector('.t-s.on');
  if(previous)previous.classList.remove('on');
  transcript.index=index;
  const line=box.querySelector('.t-s[data-i="'+index+'"]');
  if(!line)return;
  line.classList.add('on');
  if(!force&&Date.now()<transcript.holdUntil){updateLocatePill();return}
  scrollToTranscript();
}
function onTranscriptScroll(){
  if(!$('transcript-lines')||!transcript.lines.length)return;
  if(!autoScrolling)transcript.holdUntil=Date.now()+8000;
  updateLocatePill();
}
function wireTranscriptPage(d,l){
  $('transcript-back').innerHTML=icon('close');
  $('transcript-back').onclick=()=>{location.hash='#course/'+d.course.id};
  $('t-previous').innerHTML=icon('previous');$('t-next').innerHTML=icon('next');
  $('t-back').innerHTML=icon('rewind15');$('t-forward').innerHTML=icon('forward15');
  $('t-play').onclick=safe(togglePlay);
  $('t-back').onclick=()=>hop(-15);$('t-forward').onclick=()=>hop(15);
  $('t-previous').onclick=safe(()=>nextLesson(-1));$('t-next').onclick=safe(()=>nextLesson(1));
  $('t-seek').addEventListener('input',()=>{
    seekDragging=true;const duration=Number.isFinite(audio.duration)?audio.duration:0;
    $('t-current').textContent=fmt(duration*Number($('t-seek').value)/1000);
  });
  $('t-seek').addEventListener('change',()=>{
    if(Number.isFinite(audio.duration))seekAudio(audio.duration*Number($('t-seek').value)/1000);
    seekDragging=false;enqueueProgress(snapshot());updateTimes();
  });
  $('transcript-locate').onclick=()=>{transcript.holdUntil=0;scrollToTranscript()};
  $('transcript-lines').onclick=e=>{
    const line=e.target.closest('.t-s');if(!line||!current)return;
    const value=transcript.times[Number(line.dataset.i)];if(value===undefined)return;
    const duration=Number.isFinite(audio.duration)?audio.duration:0;
    const target=transcript.timed?value+.05:duration?value*duration+.2:null;
    if(target===null)return;
    seekAudio(Math.min(duration||target,target));
    transcript.holdUntil=0;highlightTranscript(true);
  };
  window.addEventListener('scroll',onTranscriptScroll,{passive:true});
  updatePlayButtons();updateTimes();
}
async function renderTranscriptRoute(id,version){
  if(!user){$('main').innerHTML=empty('登录后可以跟随文稿','文稿跟随和播放进度都随账号保存','<button class="primary" id="transcript-login">'+authLabel()+'</button>');$('transcript-login').onclick=()=>showAuth('login');return}
  $('main').innerHTML='<div class="loading">正在打开文稿…</div>';
  let data;
  try{data=await api('/api/lessons/'+id+'/transcript')}
  catch(e){if(version!==navVersion)return;$('main').innerHTML=empty('这一讲还没有文稿',esc(e.message),'<a class="primary" href="#courses">返回课程列表</a>');return}
  transcriptCache.set(id,data);
  const d=await api('/api/courses/'+data.courseId),l=d.lessons.find(x=>x.id===id);
  if(version!==navVersion)return;
  if(!l){$('main').innerHTML=empty('课时不存在','可能已经下架或改名','<a class="primary" href="#course/'+data.courseId+'">返回课程</a>');return}
  if(!l.mediaId){$('main').innerHTML=empty('这一讲没有音频','可以直接阅读配套 PDF','<a class="primary" href="#course/'+data.courseId+'">返回课程</a>');return}
  if(current?.lesson.id!==id)await playLesson(d,id,false,false);
  await loadTranscript(l);
  if(version!==navVersion)return;
  document.body.classList.add('transcript-route');
  $('mini-player').classList.add('hidden');$('player-dialog').close();
  $('main').innerHTML=transcriptPageMarkup(d,l);
  wireTranscriptPage(d,l);
  window.scrollTo(0,0);
  highlightTranscript(true);
}
async function nextLesson(direction=1,automatic=false){
  if(!current)return;
  const {data:d,lesson:l}=current,queue=d.state.queue;
  let index=queue.indexOf(l.id);
  if(index<0){if(automatic){toast('本讲已完成，不在当前队列中');return}index=direction>0?-1:queue.length}
  const next=queue[index+direction];
  if(!next){if(automatic)toast('本课程队列已播放完');return}
  const onTranscript=location.hash.startsWith('#transcript/');
  await playLesson(d,next,false,!automatic&&!onTranscript);
  if(onTranscript)location.hash='#transcript/'+next;
}
function openDocument(d,l){
  if(requireUser(async()=>openDocument(await freshCourse(d),l)))return;
  if(!l.documentId){toast('这讲暂时没有配套文稿');return}
  window.open('/media/'+l.documentId,'_blank','noopener');
  if(!l.mediaId){enqueueProgress({lessonId:l.id,position:0,duration:0,completed:!!l.completed});renderLessons()}
}
async function toggleComplete(d,l){
  if(requireUser(async()=>toggleComplete(await freshCourse(d),l)))return;
  const completed=!l.completed;
  const record=current?.lesson.id===l.id?snapshot(completed):{lessonId:l.id,position:l.position||0,duration:l.duration||0,completed,touchCurrent:false};
  if(!record)return;
  enqueueProgress(record);renderLessons();renderQueue();
  if(current?.lesson.id===l.id)$('player-complete').textContent=completed?'取消已完成标记':'标记已完成';
  toast(completed?'已记录为完成':'已取消完成标记');
}
async function saveQueue(d,queue){
  if(requireUser(async()=>{const n=await freshCourse(d);await saveQueue(n,queue)}))return;
  await api('/api/courses/'+d.course.id+'/state','PUT',{queue});
  d.state.queue=queue===null?d.lessons.filter(l=>l.mediaId).map(l=>l.id):queue;d.state.customQueue=queue!==null;
  if(current?.data.course.id===d.course.id)current.data.state=d.state;
  if(detail?.course.id===d.course.id)detail.state=d.state;
  if(queueData?.course.id===d.course.id)queueData.state=d.state;
  renderLessons();renderQueue();
}
async function toggleQueue(d,id){
  if(requireUser(async()=>toggleQueue(await freshCourse(d),id)))return;
  const has=d.state.queue.includes(id),queue=has?d.state.queue.filter(x=>x!==id):[...d.state.queue,id];
  await saveQueue(d,queue);toast(has?'已从本课程队列移除':'已加入本课程队列');
}
function openQueue(d){
  if(!d){toast('先打开一门课程');return}
  queueData=d;queueVisible=100;renderQueue();openDialog('queue-dialog');
}
function renderQueue(){
  if(!queueData)return;
  const d=queueData,byId=new Map(d.lessons.map(l=>[l.id,l])),list=d.state.queue.map(id=>byId.get(id)).filter(Boolean);
  $('queue-count').textContent=list.length+' 讲';$('queue-description').textContent=d.course.author+' · '+d.course.title+(d.state.customQueue?' · 自定义顺序':' · 课程默认顺序');
  $('queue-items').innerHTML=list.length?list.slice(0,queueVisible).map((l,i)=>'<div class="queue-row '+(current?.lesson.id===l.id?'current':'')+'"><span class="queue-index">'+(i+1)+'</span><button class="queue-title" data-queue-play="'+l.id+'">'+esc(l.title)+'<small>'+(l.completed?'已完成':l.position?'已听 '+fmt(l.position):'未播放')+'</small></button><button class="icon-button" data-queue-move="'+l.id+'" data-direction="-1" aria-label="向上移动" '+(i===0?'disabled':'')+'>'+icon('up')+'</button><button class="icon-button" data-queue-move="'+l.id+'" data-direction="1" aria-label="向下移动" '+(i===list.length-1?'disabled':'')+'>'+icon('down')+'</button><button class="icon-button" data-queue-remove="'+l.id+'" aria-label="从队列移除">'+icon('close')+'</button></div>').join(''):'<div class="empty"><p>队列是空的，可以从课时目录添加</p></div>';
  $('queue-more').classList.toggle('hidden',list.length<=queueVisible);
  document.querySelectorAll('[data-queue-play]').forEach(b=>b.onclick=safe(async()=>{$('queue-dialog').close();await playLesson(d,b.dataset.queuePlay)}));
  document.querySelectorAll('[data-queue-move]').forEach(b=>b.onclick=safe(async()=>{const queue=[...d.state.queue],i=queue.indexOf(b.dataset.queueMove),j=i+Number(b.dataset.direction);if(j<0||j>=queue.length)return;[queue[i],queue[j]]=[queue[j],queue[i]];await saveQueue(d,queue)}));
  document.querySelectorAll('[data-queue-remove]').forEach(b=>b.onclick=safe(()=>saveQueue(d,d.state.queue.filter(id=>id!==b.dataset.queueRemove))));
}
audio.addEventListener('loadedmetadata',()=>{
  if(!current||!audio.currentSrc.endsWith('/media/'+current.lesson.mediaId))return;
  if(Number.isFinite(audio.duration)&&audio.duration>0)seekAudio(Math.min(current.target,Math.max(0,audio.duration-.3)));
  current.ready=true;enqueueProgress(snapshot());updateTimes();
});
audio.addEventListener('timeupdate',()=>{
  if(handleLoopBoundary())return;
  updateTimes();highlightTranscript();
  if(current?.ready&&!audio.paused&&Date.now()-lastCheckpoint>5000){lastCheckpoint=Date.now();enqueueProgress(snapshot())}
});
audio.addEventListener('play',updatePlayButtons);
audio.addEventListener('playing',()=>{if(current&&loopBoundary.version===current.version)loopBoundary.played=true});
audio.addEventListener('seeking',()=>{handleLoopBoundary()});
audio.addEventListener('pause',()=>{updatePlayButtons();if(!suppressPause){enqueueProgress(snapshot());renderLessons()}});
audio.addEventListener('seeked',()=>{enqueueProgress(snapshot());updateTimes()});
async function onAudioEnded(wrapped=false){
  if(!current||!current.ready||current.finished||!audio.currentSrc.endsWith('/media/'+current.lesson.mediaId))return;
  const finished=current,record=snapshot(true);finished.finished=true;
  if(wrapped===true){if(record)record.position=record.duration;audio.pause()}
  enqueueProgress(record);finished.lesson.completed=1;
  if(sleep.mode==='lessons'){
    sleep.count=Math.max(0,sleep.count-1);persistSleep();renderSleep();
    if(sleep.count>0&&current.data.state.autonext)await nextLesson(1,true);
    else if(sleep.count>0)clearSleep();
    else finishSleep('定时结束，已停止播放');
  }else if(current.data.state.autonext)await nextLesson(1,true);
  if(current===finished){renderLessons();updatePlayer()}
}
audio.addEventListener('ended',safe(onAudioEnded));
audio.addEventListener('error',()=>{if(current){setSaveStatus('音频暂时无法播放，可稍后重试',true);toast(audio.error?.code===2?'媒体连接中断，请重新点击播放':'这个音频暂时无法播放');updatePlayButtons()}});
$('seek').addEventListener('input',()=>{seekDragging=true;const duration=Number.isFinite(audio.duration)?audio.duration:0;$('time-current').textContent=fmt(duration*Number($('seek').value)/1000)});
$('seek').addEventListener('change',()=>{if(Number.isFinite(audio.duration))seekAudio(audio.duration*Number($('seek').value)/1000);seekDragging=false;enqueueProgress(snapshot());updateTimes()});
$('mini-info').onclick=()=>current&&openDialog('player-dialog');
$('mini-play').onclick=safe(togglePlay);$('play-toggle').onclick=safe(togglePlay);
$('mini-queue').innerHTML=icon('queue');$('mini-queue').onclick=()=>openQueue(current?.data);
$('previous').innerHTML=icon('previous');$('next').innerHTML=icon('next');
$('backward').innerHTML=icon('rewind15');$('forward').innerHTML=icon('forward15');
document.querySelector('#player-dialog .close-dialog').innerHTML=icon('down');
$('previous').onclick=safe(()=>nextLesson(-1));$('next').onclick=safe(()=>nextLesson(1));
$('backward').onclick=()=>hop(-15);$('forward').onclick=()=>hop(15);
$('open-queue').onclick=()=>openQueue(current?.data);
$('sleep').onclick=openSleep;
document.querySelector('#sleep .sleep-icon').innerHTML=icon('clock');
$('sleep-dialog').addEventListener('close',()=>$('sleep').setAttribute('aria-expanded','false'));
$('player-pdf').onclick=()=>current&&openDocument(current.data,current.lesson);
$('player-share').innerHTML=icon('share')+'<span>分享链接</span>';
$('player-share').onclick=showLessonShare;
$('share-copy').onclick=safe(copyLessonShare);
$('share-native').onclick=safe(nativeLessonShare);
$('player-complete').onclick=safe(()=>current&&toggleComplete(current.data,current.lesson));
$('player-favorite').addEventListener('click',e=>{const button=e.target.closest('[data-lesson-favorite]');if(button){e.preventDefault();e.stopPropagation();void toggleLessonFavorite(button).catch(fail)}});
$('open-transcript').onclick=()=>{if(current)location.hash='#transcript/'+current.lesson.id};
$('rate').onchange=safe(async()=>{
  if(!current)return;const value=Number($('rate').value),d=current.data;
  await api('/api/courses/'+d.course.id+'/state','PUT',{rate:value});d.state.rate=value;audio.playbackRate=value;updateTimes();
});
$('autonext').onchange=safe(async()=>{
  if(!current)return;const value=$('autonext').checked,d=current.data;
  await api('/api/courses/'+d.course.id+'/state','PUT',{autonext:value});d.state.autonext=value;
});
$('queue-reset').onclick=safe(()=>queueData&&saveQueue(queueData,null));
$('queue-unfinished').onclick=safe(()=>queueData&&saveQueue(queueData,queueData.lessons.filter(l=>l.mediaId&&!l.completed).map(l=>l.id)));
$('queue-more').onclick=()=>{queueVisible+=100;renderQueue()};
$('main').addEventListener('click',e=>{const button=e.target.closest('[data-favorite]');if(button){e.preventDefault();e.stopPropagation();void toggleFavorite(button.dataset.favorite).catch(fail)}});
$('main').addEventListener('click',e=>{const button=e.target.closest('[data-lesson-favorite]');if(button){e.preventDefault();e.stopPropagation();void toggleLessonFavorite(button).catch(fail)}const link=e.target.closest('[data-focus-lesson]');if(link)focusLessonId=link.dataset.focusLesson});
$('account').onclick=()=>user?openDialog('account-dialog'):showAuth('login');
$('auth-switch').onclick=()=>showAuth(authMode==='login'?'register':'login');
$('auth-form').onsubmit=async e=>{
  e.preventDefault();$('auth-submit').disabled=true;$('auth-error').textContent='';
  try{
    const result=await api('/api/'+authMode,'POST',{username:$('username').value,password:$('password').value});
    user=result.user;favoriteLessonView=null;historyLessons=[];updateAccount();$('auth-dialog').close();$('password').value='';restorePending();restoreSleep();void drainProgress();
    await loadCatalog();await route();const callback=authCallback;authCallback=null;if(callback)await callback();
  }catch(e){$('auth-error').textContent=e.message}
  finally{$('auth-submit').disabled=false}
};
$('logout').onclick=safe(async()=>{
  await flushProgress();suppressPause=true;audio.pause();audio.removeAttribute('src');audio.load();suppressPause=false;
  current=null;clearSleep();$('mini-player').classList.add('hidden');await api('/api/logout','POST',{});user=null;pending=new Map();detail=null;queueData=null;favoriteLessonView=null;historyLessons=[];updateAccount();$('account-dialog').close();await boot();
});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}}));
document.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));
window.addEventListener('hashchange',safe(async()=>{enqueueProgress(snapshot());if(await loadCatalog())await route()}));
window.addEventListener('online',()=>{void drainProgress()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){const r=snapshot();if(r){pending.set(r.lessonId,r);storePending();fetch('/api/progress',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(r),keepalive:true}).catch(()=>{})}}else{tickSleep();void drainProgress()}});
window.addEventListener('pagehide',()=>{const r=snapshot();if(r){pending.set(r.lessonId,r);storePending();navigator.sendBeacon('/api/progress',new Blob([JSON.stringify(r)],{type:'application/json'}))}});
setInterval(()=>{if(pending.size)void drainProgress()},10000);
if('mediaSession' in navigator){
  for(const[action,fn]of Object.entries({play:startAudio,pause:()=>audio.pause(),previoustrack:()=>nextLesson(-1),nexttrack:()=>nextLesson(1),seekbackward:()=>hop(-15),seekforward:()=>hop(15),seekto:d=>{if(Number.isFinite(d.seekTime)){seekAudio(d.seekTime);enqueueProgress(snapshot())}}})){try{navigator.mediaSession.setActionHandler(action,safe(fn))}catch{}}
}
async function boot(){
  try{
    const me=await api('/api/me');user=me.user;canRegister=me.canRegister!==false;updateAccount();
    if(!user){$('main').innerHTML=empty('请先登录','登录后才能查看课程和播放','<button class="primary" id="boot-login">'+authLabel()+'</button>');$('boot-login').onclick=()=>showAuth('login');showAuth('login');return}
    restorePending();restoreSleep();await drainProgress();await loadCatalog();await route();
  }
  catch(e){$('main').innerHTML=empty('暂时无法连接',esc(e.message),'<button class="primary" id="boot-retry">重试</button>');$('boot-retry').onclick=boot}
}
void boot();
