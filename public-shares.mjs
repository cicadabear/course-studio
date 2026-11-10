import crypto from 'node:crypto';
import {transaction} from './store.mjs';

export const SHARE_HOURS=48,SHARE_OPENS=10;
export const canShare=user=>user?.username?.toLowerCase()==='jack';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const secret=()=>crypto.randomBytes(32).toString('hex');
const error=(status,message)=>Object.assign(new Error(message),{status});
const cookie=(req,name='share_sid')=>String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);

// A link grants one lesson only. Raw link/session secrets are never persisted.
export function publicShareRoutes(db,{auth,body,json,stream,requestProto,clock=Date.now}){
  function owner(req){
    const user=auth(req);
    if(!canShare(user))throw error(403,'分享功能仅对 jack 开放');
    return user;
  }
  function active(id){
    const row=db.prepare(`SELECT s.*,l.title,l.primary_file,l.document_file AS current_document,l.duration,l.active AS lesson_active,c.title AS course_title,c.author,c.category,c.active AS course_active
      FROM public_shares s JOIN lessons l ON l.id=s.lesson_id JOIN courses c ON c.id=l.course_id WHERE s.id=?`).get(id);
    if(!row)throw error(404,'分享链接不存在');
    if(row.revoked_at!=null||row.expires_at<=clock())throw error(410,'分享链接已过期或已停用');
    if(!row.lesson_active||!row.course_active)throw error(410,'分享的课时已下架');
    return row;
  }
  function session(req,share){
    const token=cookie(req);
    return token&&/^[a-f0-9]{64}$/.test(token)&&db.prepare('SELECT 1 FROM share_sessions WHERE token_hash=? AND share_id=? AND expires_at>?').get(hash(token),share.id,clock());
  }
  function authorize(req,id){
    const share=active(id);
    if(!session(req,share))throw error(401,'请通过分享链接打开课时');
    return share;
  }
  function documentGrant(id,token){
    const share=active(id);
    if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token)||!crypto.timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(share.token_hash,'hex')))throw error(404,'分享链接无效');
    if(!share.document_file||share.document_file!==share.current_document)throw error(404,'分享的 PDF 不存在');
    return share;
  }
  function documentSession(req,share){
    const token=cookie(req,'share_pdf_sid');
    return token&&/^[a-f0-9]{64}$/.test(token)&&db.prepare('SELECT 1 FROM share_document_sessions WHERE token_hash=? AND share_id=? AND expires_at>?').get(hash(token),share.id,clock());
  }
  const sessionCookie=(req,name,token,path,expires)=>name+'='+token+'; HttpOnly; SameSite=Lax; Path='+path+'; Max-Age='+Math.max(1,Math.ceil((expires-clock())/1000))+(requestProto(req)==='https'?'; Secure':'');
  const summary=s=>({id:s.id,createdAt:s.created_at,expiresAt:s.expires_at,maxOpens:s.max_opens,openCount:s.open_count,revoked:s.revoked_at!=null});
  const payload=s=>({title:s.title,courseTitle:s.course_title,author:s.author,category:s.category,duration:s.duration,expiresAt:s.expires_at,
    audioUrl:s.audio_file&&s.audio_file===s.primary_file?'/api/public-shares/'+s.id+'/media/'+s.audio_file:null,
    documentUrl:s.document_file&&s.document_file===s.current_document?'/api/public-shares/'+s.id+'/media/'+s.document_file:null});
  return async(req,res,p,method,url)=>{
    if(p==='/api/shares'&&method==='POST'){
      const user=owner(req),b=await body(req),hours=b.hours??SHARE_HOURS,maxOpens=b.maxOpens??SHARE_OPENS;
      if(!Number.isInteger(hours)||hours<1||hours>168||!Number.isInteger(maxOpens)||maxOpens<1||maxOpens>100)throw error(400,'有效期为 1–168 小时，打开次数为 1–100 次');
      if(typeof b.lessonId!=='string'||! /^[a-f0-9]{24}$/.test(b.lessonId))throw error(400,'课时无效');
      const lesson=db.prepare('SELECT l.* FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=? AND l.active=1 AND c.active=1').get(b.lessonId);
      if(!lesson||!lesson.primary_file&&!lesson.document_file)throw error(404,'课时不存在或没有可分享的文件');
      const id=crypto.randomBytes(16).toString('hex'),token=secret(),created=clock();
      db.prepare('INSERT INTO public_shares(id,token_hash,owner_id,lesson_id,audio_file,document_file,created_at,expires_at,max_opens) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(id,hash(token),user.id,lesson.id,lesson.primary_file,lesson.document_file,created,created+hours*3600000,maxOpens);
      const row=db.prepare('SELECT * FROM public_shares WHERE id=?').get(id);
      const document=lesson.document_file&&db.prepare("SELECT 1 FROM files WHERE id=? AND lesson_id=? AND active=1 AND ext='.pdf'").get(lesson.document_file,lesson.id);
      json(res,201,{...summary(row),path:'/share#'+id+'.'+token,documentPath:document?'/api/public-shares/'+id+'/document.pdf?token='+token:null});return true;
    }
    if(p==='/api/shares'&&method==='GET'){
      const user=owner(req),id=url.searchParams.get('lessonId');
      if(!/^[a-f0-9]{24}$/.test(id||''))throw error(400,'课时无效');
      const shares=db.prepare('SELECT * FROM public_shares WHERE owner_id=? AND lesson_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30').all(user.id,id);
      json(res,200,{shares:shares.map(summary)});return true;
    }
    const owned=/^\/api\/shares\/([a-f0-9]{32})$/.exec(p);
    if(owned&&method==='DELETE'){
      const user=owner(req);await body(req);
      const changed=db.prepare('UPDATE public_shares SET revoked_at=? WHERE id=? AND owner_id=?').run(clock(),owned[1],user.id);
      if(!changed.changes)throw error(404,'分享链接不存在');
      db.prepare('DELETE FROM share_sessions WHERE share_id=?').run(owned[1]);
      db.prepare('DELETE FROM share_document_sessions WHERE share_id=?').run(owned[1]);
      json(res,200,{ok:true});return true;
    }
    const route=/^\/api\/public-shares\/([a-f0-9]{32})\/(open|lesson|document\.pdf|media\/([a-f0-9]{24}))$/.exec(p);
    if(!route)return false;
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
    const id=route[1];
    if(route[2]==='document.pdf'&&['GET','HEAD'].includes(method)){
      const token=url.searchParams.get('token'),share=documentGrant(id,token);
      const file=db.prepare("SELECT * FROM files WHERE id=? AND lesson_id=? AND active=1 AND ext='.pdf'").get(share.document_file,share.lesson_id);
      if(!file)throw error(404,'分享的 PDF 不存在');
      const validate=()=>{
        const current=documentGrant(id,token);
        if(current.document_file!==file.id)throw error(404,'分享的 PDF 不存在');
        return current;
      };
      await stream(req,res,file,{expiresAt:share.expires_at,authorize:validate,admit:()=>transaction(db,()=>{
        const current=validate();
        if(documentSession(req,current))return {};
        if(current.open_count>=current.max_opens)throw error(410,'分享链接的打开次数已用完');
        // HEAD only inspects the file. A successful GET admits one PDF reader;
        // later ranges and refreshes reuse its narrowly scoped cookie.
        if(method==='HEAD')return {};
        const newToken=secret();
        db.prepare('DELETE FROM share_document_sessions WHERE expires_at<=?').run(clock());
        db.prepare('UPDATE public_shares SET open_count=open_count+1 WHERE id=? AND open_count<max_opens').run(id);
        db.prepare('INSERT INTO share_document_sessions VALUES(?,?,?)').run(hash(newToken),id,current.expires_at);
        return {'Set-Cookie':sessionCookie(req,'share_pdf_sid',newToken,p,current.expires_at)};
      })});return true;
    }
    if(route[2]==='open'&&method==='POST'){
      const b=await body(req),token=b.token;
      if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))throw error(404,'分享链接无效');
      const newToken=secret();let created=false;
      const share=transaction(db,()=>{
        const s=active(id);
        if(!crypto.timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(s.token_hash,'hex')))throw error(404,'分享链接无效');
        if(session(req,s))return s;
        if(s.open_count>=s.max_opens)throw error(410,'分享链接的打开次数已用完');
        db.prepare('DELETE FROM share_sessions WHERE expires_at<=?').run(clock());
        db.prepare('UPDATE public_shares SET open_count=open_count+1 WHERE id=? AND open_count<max_opens').run(id);
        db.prepare('INSERT INTO share_sessions VALUES(?,?,?)').run(hash(newToken),id,s.expires_at);
        created=true;return s;
      });
      const headers=created?{'Set-Cookie':sessionCookie(req,'share_sid',newToken,'/api/public-shares/'+id+'/',share.expires_at)}:{};
      json(res,200,payload(share),headers);return true;
    }
    if(route[2]==='lesson'&&method==='GET'){
      json(res,200,payload(authorize(req,id)));return true;
    }
    if(route[3]&&['GET','HEAD'].includes(method)){
      const share=authorize(req,id),fileId=route[3];
      const current=db.prepare('SELECT primary_file,document_file FROM lessons WHERE id=?').get(share.lesson_id);
      if(!(fileId===share.audio_file&&fileId===current.primary_file||fileId===share.document_file&&fileId===current.document_file))throw error(404,'文件不在分享范围内');
      const file=db.prepare('SELECT * FROM files WHERE id=? AND lesson_id=? AND active=1').get(fileId,share.lesson_id);
      if(!file)throw error(404,'文件不存在');
      await stream(req,res,file,{expiresAt:share.expires_at,authorize:()=>authorize(req,id)});return true;
    }
    throw error(405,'不支持该操作');
  };
}
