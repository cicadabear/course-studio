const status=document.getElementById('login-share-status'),retry=document.getElementById('login-share-retry');
const match=/^#([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(location.hash);
let busy=false;
async function open(){
  if(!match||busy)return;
  busy=true;retry.hidden=true;status.textContent='正在自动登录并打开课时…';
  try{
    const response=await fetch('/api/login-shares/'+match[1]+'/open',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:match[2]})});
    const result=await response.json().catch(()=>({error:'暂时无法打开，请重试'}));
    if(!response.ok)throw Object.assign(new Error(result.error||'暂时无法打开'),{status:response.status});
    location.replace(result.path);
  }catch(e){status.textContent=e.message;retry.hidden=[404,410].includes(e.status)}
  finally{busy=false}
}
retry.onclick=()=>void open();
if(match)void open();else status.textContent='分享链接不完整，请重新复制完整链接。';
