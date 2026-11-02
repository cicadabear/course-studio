const $=id=>document.getElementById(id);
let grant=null,expiryTimer=null;
const match=/^#([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(location.hash);
const base=match?'/api/public-shares/'+match[1]+'/':null;
async function api(action,data){
  const res=await fetch(base+action,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
  const value=await res.json().catch(()=>({error:'暂时无法连接，请重试'}));
  if(!res.ok)throw Object.assign(new Error(value.error||'暂时无法打开'),{status:res.status});
  return value;
}
function stop(message){
  clearTimeout(expiryTimer);grant=null;
  const audio=$('guest-audio');audio.pause();audio.removeAttribute('src');audio.load();
  $('guest-document').hidden=true;$('guest-document').removeAttribute('href');
  $('guest-content').hidden=true;$('guest-status').textContent=message;
}
function render(data){
  grant=data;$('guest-entry').hidden=true;$('guest-content').hidden=false;$('guest-status').textContent='';
  $('guest-title').textContent=data.title;$('guest-course').textContent=data.courseTitle+' · '+data.author;
  document.title=data.title+' · 课时分享';
  const audio=$('guest-audio');audio.hidden=!data.audioUrl;
  if(data.audioUrl&&!audio.getAttribute('src'))audio.src=data.audioUrl;
  $('guest-document').hidden=!data.documentUrl;
  if(data.documentUrl)$('guest-document').href=data.documentUrl;
  $('guest-expiry').textContent=new Date(data.expiresAt).toLocaleString('zh-CN',{hour12:false})+' 到期';
  clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>stop('分享链接已到期'),Math.max(0,data.expiresAt-Date.now()));
  if(!data.audioUrl&&!data.documentUrl)$('guest-status').textContent='原文件已变更，请联系分享者重新生成链接。';
  if(data.audioUrl&&'mediaSession' in navigator){
    try{navigator.mediaSession.metadata=new MediaMetadata({title:data.title,artist:data.author,album:data.courseTitle,artwork:[{src:'/media-artwork.png',sizes:'512x512',type:'image/png'}]})}catch{}
  }
}
async function check(){
  if(!grant)return;
  try{const data=await api('lesson');if(data.expiresAt<=Date.now())stop('分享链接已到期')}
  catch(e){if([401,404,410].includes(e.status))stop(e.message)}
}
$('guest-open').onclick=async()=>{
  $('guest-open').disabled=true;$('guest-status').textContent='正在打开…';
  try{render(await api('open',{token:match[2]}))}
  catch(e){$('guest-status').textContent=e.message}
  finally{$('guest-open').disabled=false}
};
$('guest-audio').addEventListener('error',()=>{void check();$('guest-status').textContent='音频暂时无法播放，请检查链接是否到期后重试。'});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check()});
window.addEventListener('pageshow',()=>void check());
// Checking authorization never consumes an opening, including page refreshes.
setInterval(()=>void check(),30000);
if(!match){$('guest-open').disabled=true;$('guest-status').textContent='分享链接不完整，请重新复制完整链接。'}
else{
  $('guest-open').disabled=true;
  try{render(await api('lesson'))}catch(e){if(e.status!==401)$('guest-status').textContent=e.message}
  finally{$('guest-open').disabled=false}
}
