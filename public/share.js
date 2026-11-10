const $=id=>document.getElementById(id);
const icons={
  play:'<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause:'<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  rewind15:'<path d="M9.03 5A7.6 7.6 0 1 0 14.97 5"/><path d="M9.45 2.66 17.4 2.34 14.75 8.6Z" fill="currentColor" stroke="none"/><text x="12" y="15.6" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor" stroke="none">15</text>',
  forward15:'<path d="M14.97 5A7.6 7.6 0 1 1 9.03 5"/><path d="M14.55 2.66 9.25 8.6 6.6 2.34Z" fill="currentColor" stroke="none"/><text x="12" y="15.6" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor" stroke="none">15</text>'
};
const icon=name=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[name]+'</svg>';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=t=>{t=Math.max(0,Math.floor(Number(t)||0));return(t>=3600?Math.floor(t/3600)+':':'')+String(Math.floor(t/60)%60).padStart(2,'0')+':'+String(t%60).padStart(2,'0')};
const palette={'经济金融':'#485d6b','历史人文':'#a17e58','科学科技':'#547979','心理生活':'#af8177','思维成长':'#48556b','文化艺术':'#8b655f','商业管理':'#647760'};
// Keep this small player copy independent of account, progress and queue code.
function cover(c){return '<div class="cover" style="--cover-bg:'+(palette[c.category]||'#647760')+'"><span class="cover-label">'+esc(c.category)+'</span><span class="cover-title">'+esc(c.title)+'</span><span class="cover-author">'+esc(c.author)+'</span></div>'}
const audio=$('guest-audio');
let grant=null,expiryTimer=null,seekDragging=false;
const match=/^#([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(location.hash);
const base=match?'/api/public-shares/'+match[1]+'/':null;
async function api(action,data){
  const res=await fetch(base+action,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
  const value=await res.json().catch(()=>({error:'暂时无法连接，请重试'}));
  if(!res.ok)throw Object.assign(new Error(value.error||'暂时无法打开'),{status:res.status});
  return value;
}
function updatePlay(){
  $('guest-play').innerHTML=icon(audio.paused?'play':'pause');
  $('guest-play').setAttribute('aria-label',audio.paused?'播放':'暂停');
  if('mediaSession' in navigator){try{navigator.mediaSession.playbackState=grant?(audio.paused?'paused':'playing'):'none'}catch{}}
}
function updateTimes(){
  const duration=Number.isFinite(audio.duration)?audio.duration:Number(grant?.duration)||0;
  const position=Math.max(0,audio.currentTime||0),seekable=!!grant?.audioUrl&&Number.isFinite(audio.duration)&&audio.duration>0;
  if(!seekDragging)$('guest-seek').value=duration?String(position/duration*1000):'0';
  $('guest-current').textContent=fmt(position);$('guest-total').textContent=fmt(duration);
  for(const id of ['guest-seek','guest-backward','guest-forward'])$(id).disabled=!seekable;
  if('mediaSession' in navigator&&seekable){try{navigator.mediaSession.setPositionState({duration:audio.duration,playbackRate:audio.playbackRate,position:Math.min(position,audio.duration)})}catch{}}
}
function seek(seconds){
  if(!grant?.audioUrl||!Number.isFinite(audio.duration)||audio.duration<=0)return;
  audio.currentTime=Math.max(0,Math.min(seconds,audio.duration));updateTimes();
}
async function play(){
  if(!grant?.audioUrl)return;
  const playing=grant;$('guest-status').textContent='';
  try{if(navigator.audioSession)navigator.audioSession.type='playback'}catch{}
  try{await audio.play()}
  catch(e){if(grant===playing&&e.name!=='AbortError')$('guest-status').textContent=e.name==='NotAllowedError'?'请点击播放继续':'音频暂时无法播放，请重试。'}
  updatePlay();
}
function stop(message){
  clearTimeout(expiryTimer);grant=null;seekDragging=false;
  audio.pause();audio.removeAttribute('src');audio.load();
  $('guest-document').hidden=true;$('guest-document').removeAttribute('href');
  $('guest-content').hidden=true;$('guest-status').textContent=message;
  if('mediaSession' in navigator){try{navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none'}catch{}}
}
function render(data){
  grant=data;$('guest-entry').hidden=true;$('guest-content').hidden=false;$('guest-status').textContent='';
  $('guest-cover').innerHTML=cover({title:data.courseTitle,author:data.author,category:data.category});
  $('guest-title').textContent=data.title;$('guest-course').textContent=data.author+' · '+data.courseTitle;
  document.title=data.title+' · 知行';
  $('guest-audio-controls').hidden=$('guest-rate-label').hidden=!data.audioUrl;
  if(data.audioUrl&&!audio.getAttribute('src')){audio.src=data.audioUrl;audio.load()}
  $('guest-document').hidden=!data.documentUrl;
  if(data.documentUrl)$('guest-document').href=base+'document.pdf?token='+match[2];
  clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>stop('分享链接已到期'),Math.max(0,data.expiresAt-Date.now()));
  if(!data.audioUrl&&!data.documentUrl)$('guest-status').textContent='原文件暂时不可用。';
  if(data.audioUrl&&'mediaSession' in navigator){
    try{navigator.mediaSession.metadata=new MediaMetadata({title:data.title,artist:data.author,album:data.courseTitle,artwork:[{src:location.origin+'/media-artwork.png',sizes:'512x512',type:'image/png'}]})}catch{}
  }
  updatePlay();updateTimes();
}
async function check(){
  if(!grant)return;
  const checking=grant;
  try{const data=await api('lesson');if(grant===checking&&data.expiresAt<=Date.now())stop('分享链接已到期')}
  catch(e){if(grant===checking&&[401,404,410].includes(e.status))stop(e.message)}
}
$('guest-open').onclick=async()=>{
  if(!match)return;
  $('guest-open').disabled=true;$('guest-status').textContent='正在打开…';
  try{render(await api('open',{token:match[2]}))}
  catch(e){$('guest-status').textContent=e.message}
  finally{$('guest-open').disabled=false}
};
$('guest-play').onclick=()=>audio.paused?void play():audio.pause();
$('guest-backward').innerHTML=icon('rewind15');$('guest-forward').innerHTML=icon('forward15');
$('guest-backward').onclick=()=>seek(audio.currentTime-15);$('guest-forward').onclick=()=>seek(audio.currentTime+15);
$('guest-rate').onchange=()=>{audio.playbackRate=Number($('guest-rate').value);updateTimes()};
$('guest-seek').oninput=()=>{seekDragging=true;const duration=Number.isFinite(audio.duration)?audio.duration:0;$('guest-current').textContent=fmt(duration*Number($('guest-seek').value)/1000)};
$('guest-seek').onchange=()=>{seekDragging=false;seek(audio.duration*Number($('guest-seek').value)/1000)};
$('guest-seek').addEventListener('pointercancel',()=>{seekDragging=false;updateTimes()});
for(const event of ['play','pause','ended'])audio.addEventListener(event,updatePlay);
for(const event of ['loadedmetadata','durationchange','timeupdate','seeked','ratechange'])audio.addEventListener(event,updateTimes);
audio.addEventListener('error',()=>{if(grant){$('guest-status').textContent='音频暂时无法播放，请重试。';void check()}});
if('mediaSession' in navigator){
  for(const [action,handler] of Object.entries({play:()=>void play(),pause:()=>audio.pause(),seekbackward:d=>seek(audio.currentTime-(d.seekOffset||15)),seekforward:d=>seek(audio.currentTime+(d.seekOffset||15)),seekto:d=>seek(d.seekTime)})){
    try{navigator.mediaSession.setActionHandler(action,handler)}catch{}
  }
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check()});
window.addEventListener('pageshow',()=>void check());
// Authorization checks and media reads never consume another opening.
setInterval(()=>void check(),30000);
$('guest-cover').innerHTML=cover({title:'课时分享',author:'',category:''});updatePlay();
if(!match){$('guest-open').disabled=true;$('guest-status').textContent='分享链接不完整，请重新复制完整链接。'}
else{
  $('guest-open').disabled=true;
  try{render(await api('lesson'))}catch(e){if(e.status!==401)$('guest-status').textContent=e.message}
  finally{$('guest-open').disabled=false}
}
