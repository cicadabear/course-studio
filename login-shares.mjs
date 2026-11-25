import crypto from 'node:crypto';
import {transaction} from './store.mjs';
import {canShare,SHARE_HOURS,SHARE_OPENS} from './public-shares.mjs';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const secret=()=>crypto.randomBytes(32).toString('hex');
const error=(status,message)=>Object.assign(new Error(message),{status});
const sid=req=>String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('sid='))?.slice(4);

export function loginShareRoutes(db,{auth,body,json,requestProto,clock=Date.now}){
  function owner(req){const user=auth(req);if(!canShare(user))throw error(403,'分享功能仅对 jack 开放');return user;}
  const summary=s=>({id:s.id,kind:'auto',targetUsername:s.username,createdAt:s.created_at,expiresAt:s.expires_at,maxOpens:s.max_opens,openCount:s.open_count,revoked:s.revoked_at!=null});
  function active(id){
    const row=db.prepare(`SELECT s.*,u.username,l.course_id,l.active AS lesson_active,c.active AS course_active
      FROM login_shares s JOIN users u ON u.id=s.target_user_id JOIN lessons l ON l.id=s.lesson_id JOIN courses c ON c.id=l.course_id WHERE s.id=?`).get(id);
    if(!row)throw error(404,'分享链接不存在');
    if(row.revoked_at!=null||row.expires_at<=clock())throw error(410,'分享链接已过期或已停用');
    if(!row.lesson_active||!row.course_active)throw error(410,'分享的课时已下架');
    return row;
  }
  return async(req,res,p,method,url)=>{
    if(p==='/api/login-shares'&&method==='POST'){
      const user=owner(req),b=await body(req),hours=b.hours??SHARE_HOURS,maxOpens=b.maxOpens??SHARE_OPENS;
      if(!Number.isInteger(hours)||hours<1||hours>168||!Number.isInteger(maxOpens)||maxOpens<1||maxOpens>100)throw error(400,'有效期为 1–168 小时，打开次数为 1–100 次');
      if(typeof b.lessonId!=='string'||! /^[a-f0-9]{24}$/.test(b.lessonId))throw error(400,'课时无效');
      const username=typeof b.targetUsername==='string'?b.targetUsername.trim():'';
      if(!/^[\p{L}\p{N}_\-.]{2,32}$/u.test(username))throw error(400,'请输入有效的用户名');
      const target=db.prepare('SELECT id,username FROM users WHERE username=?').get(username);
      if(!target)throw error(404,'指定用户不存在，请先创建账号');
      const lesson=db.prepare('SELECT l.id FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=? AND l.active=1 AND c.active=1').get(b.lessonId);
      if(!lesson)throw error(404,'课时不存在');
      const id=crypto.randomBytes(16).toString('hex'),token=secret(),created=clock();
      db.prepare('INSERT INTO login_shares(id,token_hash,owner_id,target_user_id,lesson_id,created_at,expires_at,max_opens) VALUES(?,?,?,?,?,?,?,?)')
        .run(id,hash(token),user.id,target.id,lesson.id,created,created+hours*3600000,maxOpens);
      json(res,201,{...summary(active(id)),path:'/share-login#'+id+'.'+token});return true;
    }
    if(p==='/api/login-shares'&&method==='GET'){
      const user=owner(req),id=url.searchParams.get('lessonId');
      if(!/^[a-f0-9]{24}$/.test(id||''))throw error(400,'课时无效');
      const rows=db.prepare('SELECT s.*,u.username FROM login_shares s JOIN users u ON u.id=s.target_user_id WHERE s.owner_id=? AND s.lesson_id=? ORDER BY s.created_at DESC,s.rowid DESC LIMIT 30').all(user.id,id);
      json(res,200,{shares:rows.map(summary)});return true;
    }
    const owned=/^\/api\/login-shares\/([a-f0-9]{32})$/.exec(p);
    if(owned&&method==='DELETE'){
      const user=owner(req);await body(req);
      transaction(db,()=>{
        const changed=db.prepare('UPDATE login_shares SET revoked_at=? WHERE id=? AND owner_id=?').run(clock(),owned[1],user.id);
        if(!changed.changes)throw error(404,'分享链接不存在');
        db.prepare('DELETE FROM sessions WHERE token IN (SELECT session_token FROM login_share_sessions WHERE share_id=?)').run(owned[1]);
      });
      json(res,200,{ok:true});return true;
    }
    const opened=/^\/api\/login-shares\/([a-f0-9]{32})\/open$/.exec(p);
    if(!opened)return false;
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
    if(method!=='POST')throw error(405,'不支持该操作');
    const b=await body(req),token=b.token;
    if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))throw error(404,'分享链接无效');
    const newToken=secret();let created=false;
    const share=transaction(db,()=>{
      const s=active(opened[1]);
      if(!crypto.timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(s.token_hash,'hex')))throw error(404,'分享链接无效');
      const previous=sid(req);
      if(previous&&/^[a-f0-9]{64}$/.test(previous)&&db.prepare('SELECT 1 FROM login_share_sessions ls JOIN sessions se ON se.token=ls.session_token WHERE ls.share_id=? AND ls.session_token=? AND se.user_id=? AND se.expires_at>?').get(s.id,hash(previous),s.target_user_id,clock()))return s;
      if(s.open_count>=s.max_opens)throw error(410,'分享链接的打开次数已用完');
      db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(clock());
      db.prepare('UPDATE login_shares SET open_count=open_count+1 WHERE id=? AND open_count<max_opens').run(s.id);
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(newToken),s.target_user_id,s.expires_at);
      db.prepare('INSERT INTO login_share_sessions VALUES(?,?)').run(hash(newToken),s.id);
      created=true;return s;
    });
    const headers=created?{'Set-Cookie':'sid='+newToken+'; HttpOnly; SameSite=Lax; Path=/; Max-Age='+Math.max(1,Math.ceil((share.expires_at-clock())/1000))+(requestProto(req)==='https'?'; Secure':'')}:{};
    json(res,200,{user:{id:share.target_user_id,username:share.username},expiresAt:share.expires_at,path:'/#course/'+share.course_id+'?lesson='+share.lesson_id},headers);return true;
  };
}
