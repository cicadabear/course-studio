import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {openStore,PROJECT,config,transaction} from './store.mjs';
import {scan} from './scanner.mjs';
import {courseMetadata,tagOrder,tagOrders} from './catalog-tags.mjs';
const scrypt=promisify(crypto.scrypt);
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const now=()=>Date.now();
const error=(status,message)=>Object.assign(new Error(message),{status});
// 这台电脑本身（127.*、::1）和局域网私有网段（10.*、192.168.*、172.16–172.31.*、169.254.*、fc00::/7）
export function normalizeIp(address) {
  const raw=String(address||'').trim(),ip=raw.startsWith('::ffff:')?raw.slice(7):raw;
  return ip;
}
export function isLocalAddress(address) {
  const ip=normalizeIp(address);
  if(ip==='::1'||ip.startsWith('127.'))return true;
  if(ip.startsWith('10.')||ip.startsWith('192.168.')||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||ip.startsWith('169.254.'))return true;
  return /^f[cd][0-9a-f]{2}:/i.test(ip);
}
// 按部署约定直接采信反代头，不再要求配置代理 IP 白名单。
export function clientAddress(req) {
  const direct=normalizeIp(req.socket.remoteAddress);
  const chain=String(req.headers['x-forwarded-for']||'').split(',').map(s=>normalizeIp(s)).filter(Boolean);
  const forwarded=chain[0]||normalizeIp(req.headers['x-real-ip']);
  return{ip:forwarded||direct,proxied:Boolean(forwarded),unknown:!forwarded&&!direct};
}
// 反代终结 TLS 时，Node 这一侧的 socket 不是加密的，需要靠 X-Forwarded-Proto 判断。
export function requestProto(req) {
  const forwarded=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase();
  if(forwarded==='https'||forwarded==='http')return forwarded;
  return req.socket.encrypted?'https':'http';
}
// 拿不到访客真实 IP 时（路由器端口映射会把来源改写成路由器局域网地址），退回到 Host：
// Host 命中 config.publicHosts 就认定是公网入口，不允许注册。
export function hostIsPublic(host,publicHosts=[]) {
  const bare=String(host||'').trim().toLowerCase().replace(/:\d+$/,'').replace(/^\[(.*)\]$/,'$1');
  if(!bare)return false;
  return publicHosts.map(s=>String(s).toLowerCase()).includes(bare);
}
function json(res,status,value,headers={}) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(value));}
async function body(req) {
  let n=0;const chunks=[];
  for await(const chunk of req){n+=chunk.length;if(n>512000)throw error(413,'请求内容太大');chunks.push(chunk)}
  try{const value=JSON.parse(Buffer.concat(chunks).toString()||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value}catch{throw error(400,'请求格式错误')}
}
export function parseRange(header,size) {
  if(!header)return null;
  const m=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!m||(!m[1]&&!m[2]))throw error(416,'无效的媒体范围');
  let start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
  let end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start||(!m[1]&&Number(m[2])===0))throw error(416,'媒体范围超出文件');
  return {start,end};
}
// Origin 校验（CSRF 防护）：比较协议与主机名，忽略端口。
// 反代与路由器端口映射会让浏览器看到的端口和上游 Host 不一致（例如公网 9443 -> nginx 9003），
// 严格比较端口会把正常的登出、进度保存挡掉。
export function sameOrigin(origin,host,proto) {
  if(!origin)return true;
  let parsed;try{parsed=new URL(origin)}catch{return false}
  if(parsed.protocol!==proto+':')return false;
  const hostOnly=String(host||'').trim().toLowerCase().replace(/:\d+$/,'').replace(/^\[(.*)\]$/,'$1');
  return parsed.hostname.toLowerCase()===hostOnly;
}
export const LOGIN_FAIL_LIMIT=5;
export const LOGIN_LOCK_MS=12*60*60*1000;
export function createHandler(db,mediaRoot=config.mediaRoot,options={}) {
  const publicHosts=Array.isArray(options.publicHosts)?options.publicHosts:(Array.isArray(config.publicHosts)?config.publicHosts:[]);
  const client=req=>clientAddress(req);
  const clientIp=req=>client(req).ip;
  const limits=new Map();
  const limit=(req,kind)=>{
    const key=kind+':'+clientIp(req),t=now(),old=limits.get(key);
    const entry=old&&old.until>t?old:{until:t+15*60*1000,count:0};entry.count++;limits.set(key,entry);
    if(entry.count>15)throw error(429,'尝试次数过多，请稍后再试');
    if(limits.size>5000)for(const[k,v]of limits)if(v.until<t)limits.delete(k);
  };
  // 同一 IP 连续输错密码 5 次，锁 12 小时；锁存 SQLite，重启服务不失效。
  const lockState=ip=>{
    const row=db.prepare('SELECT failures,locked_until FROM auth_locks WHERE ip=?').get(ip),t=now();
    if(!row)return{failures:0,lockedUntil:0};
    if(row.locked_until>t)return{failures:row.failures,lockedUntil:row.locked_until};
    // 锁已过期时重新计数；locked_until 为 0 表示仍在累计。
    if(row.locked_until)return{failures:0,lockedUntil:0};
    return{failures:row.failures,lockedUntil:0};
  };
  const assertNotLocked=ip=>{
    const{lockedUntil}=lockState(ip);
    if(lockedUntil>now())throw error(423,'密码连续输错，账号已临时锁定，请在 '+new Date(lockedUntil).toLocaleString('zh-CN',{hour12:false})+' 后重试');
  };
  const recordFailure=ip=>{
    const{failures}=lockState(ip),next=failures+1,t=now();
    const lockedUntil=next>=LOGIN_FAIL_LIMIT?t+LOGIN_LOCK_MS:0;
    db.prepare('INSERT INTO auth_locks(ip,failures,locked_until,updated_at) VALUES(?,?,?,?) ON CONFLICT(ip) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until,updated_at=excluded.updated_at').run(ip,next,lockedUntil,t);
    return{failures:next,lockedUntil};
  };
  const clearFailures=ip=>db.prepare('DELETE FROM auth_locks WHERE ip=?').run(ip);
  function auth(req,required=true) {
    const token=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('sid='))?.slice(4);
    const u=token&&db.prepare('SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?').get(digest(token),now());
    if(!u&&required)throw error(401,'请先登录');
    return u||null;
  }
  // 只有这台电脑本身和局域网内的地址可以开新账号；登录不受此限制。走反代时按访客真实地址判断。
  // 注册只对这台电脑本身和局域网直连开放。
  // 直连：按 socket 地址判断。走反代：路由器端口映射会把来源改写成路由器局域网地址，
  // 地址无法区分内外网，退回到 Host —— Host 命中 publicHosts 就认定是公网入口。
  function fromLocalNetwork(req) {
    const{ip,unknown}=client(req);
    if(!unknown&&isLocalAddress(ip)&&!hostIsPublic(req.headers.host,publicHosts))return true;
    return false;
  }
  function getCourse(id) {
    const row=db.prepare('SELECT id,title,author,category,source_root FROM courses WHERE id=? AND active=1').get(id);
    if(!row)throw error(404,'课程不存在');
    const {source_root,...c}=row;return {...c,...courseMetadata(row,config)};
  }
  function getLesson(id) {
    const l=db.prepare('SELECT * FROM lessons WHERE id=? AND active=1').get(id);
    if(!l)throw error(404,'课时不存在');return l;
  }
  async function stream(req,res,file) {
    const roots=options.mediaRoots||[mediaRoot,...(config.mediaRoots||[])];
    const root=path.resolve(file.source_root||mediaRoot);
    if(!roots.some(r=>path.resolve(r).toLowerCase()===root.toLowerCase()))throw error(403,'媒体来源不可访问');
    const resolved=path.resolve(root,file.relative_path);
    const base=await fsp.realpath(root),real=await fsp.realpath(resolved).catch(()=>{throw error(404,'原文件暂时不可用')});
    if(!real.toLowerCase().startsWith(base.toLowerCase()+path.sep))throw error(403,'媒体路径不可访问');
    const stat=await fsp.stat(real);if(!stat.isFile())throw error(404,'原文件暂时不可用');
    let range;try{range=parseRange(req.headers.range,stat.size)}catch(e){res.setHeader('Content-Range','bytes */'+stat.size);throw e}
    const types={'.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac','.pdf':'application/pdf'};
    const headers={'Content-Type':types[file.ext]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'private, max-age=0','Content-Length':range?range.end-range.start+1:stat.size};
    if(file.ext==='.pdf')headers['Content-Disposition']="inline; filename*=UTF-8''"+encodeURIComponent(path.basename(real)).replace(/'/g,'%27');
    if(range)headers['Content-Range']='bytes '+range.start+'-'+range.end+'/'+stat.size;
    res.writeHead(range?206:200,headers);
    if(req.method==='HEAD'){res.end();return}
    const source=fs.createReadStream(real,range||{});
    source.on('error',()=>res.destroy());
    res.on('close',()=>source.destroy());
    source.pipe(res);
  }
  const handler=async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','SAMEORIGIN');
    try {
      const url=new URL(req.url,'http://localhost'),p=url.pathname,method=req.method;
      if(!['GET','HEAD','POST','PUT','DELETE'].includes(method))throw error(405,'不支持该操作');
      if(['POST','PUT','DELETE'].includes(method)){
        if(!sameOrigin(req.headers.origin,req.headers.host,requestProto(req)))throw error(403,'请求来源不匹配');
        if(!String(req.headers['content-type']||'').startsWith('application/json'))throw error(415,'需要 JSON 请求');
      }
      if(p==='/api/health'&&method==='GET')return json(res,200,{ok:true,service:'course-studio',catalogReady:!!db.prepare("SELECT value FROM meta WHERE key='scan'").get()});
      if(p==='/api/me'&&method==='GET')return json(res,200,{user:auth(req,false),canRegister:fromLocalNetwork(req)});
      if((p==='/api/register'||p==='/api/login')&&method==='POST'){
        const register=p.endsWith('register'),ip=clientIp(req);
        // 登录不再单独限流，改由连错 5 次锁 12 小时兜底；注册仍保留每分钟额度。
        if(register)limit(req,'register');
        if(!register)assertNotLocked(ip);
        if(register&&!fromLocalNetwork(req))throw error(403,'注册只对这台电脑和局域网开放');
        const b=await body(req),username=typeof b.username==='string'?b.username.trim():'',password=b.password;
        if(!/^[\p{L}\p{N}_\-.]{2,32}$/u.test(username)||typeof password!=='string'||password.length<8||password.length>128)throw error(400,'用户名 2–32 位，密码 8–128 位');
        let user;
        if(register){
          const salt=crypto.randomBytes(16).toString('hex'),key=await scrypt(password,salt,64);
          try{const r=db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run(username,salt+':'+key.toString('hex'),now());user={id:Number(r.lastInsertRowid),username}}
          catch(e){if(e.code==='ERR_SQLITE_ERROR'&&String(e.message).includes('UNIQUE'))throw error(409,'这个用户名已被使用');throw e}
        }else{
          const row=db.prepare('SELECT * FROM users WHERE username=?').get(username);
          const [salt,encoded]=(row?.password_hash||'00000000000000000000000000000000:'+Buffer.alloc(64).toString('hex')).split(':');
          const key=await scrypt(password,salt,64);
          if(!row||!crypto.timingSafeEqual(key,Buffer.from(encoded,'hex'))) {
            const{failures,lockedUntil}=recordFailure(ip);
            if(lockedUntil)throw error(423,'密码连续输错 '+failures+' 次，已锁定 12 小时');
            throw error(401,'用户名或密码不正确（剩余尝试 '+Math.max(0,LOGIN_FAIL_LIMIT-failures)+' 次）');
          }
          user={id:row.id,username:row.username};
        }
        clearFailures(ip);
        db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());
        const token=crypto.randomBytes(32).toString('hex'),ttl=30*24*60*60;
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,now()+ttl*1000);
        return json(res,200,{user},{'Set-Cookie':'sid='+token+'; HttpOnly; SameSite=Lax; Path=/; Max-Age='+ttl+(requestProto(req)==='https'?'; Secure':'')});
      }
      if(p==='/api/logout'&&method==='POST'){
        const token=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('sid='))?.slice(4);
        if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));
        return json(res,200,{ok:true},{'Set-Cookie':'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
      }
      if(p==='/api/catalog'&&method==='GET'){
        const u=auth(req);
        const shelf=url.searchParams.get('shelf');
        if(shelf&&!['courses','youth'].includes(shelf))throw error(400,'无效的课程分类');
        const courses=db.prepare(`SELECT c.id,c.title,c.author,c.category,c.source_root,
          COUNT(l.id) AS lessonCount,SUM(CASE WHEN l.kind='audio' THEN 1 ELSE 0 END) AS audioCount,
          SUM(CASE WHEN l.document_file IS NOT NULL THEN 1 ELSE 0 END) AS documentCount,
          COALESCE(SUM(CASE WHEN p.completed=1 THEN 1 ELSE 0 END),0) AS completedCount,
          MAX(p.updated_at) AS lastStudiedAt,s.last_lesson_id AS lastLessonId,s.updated_at AS stateUpdatedAt,f.created_at AS favoritedAt
          FROM courses c LEFT JOIN lessons l ON l.course_id=c.id AND l.active=1
          LEFT JOIN progress p ON p.lesson_id=l.id AND p.user_id=?
          LEFT JOIN course_state s ON s.course_id=c.id AND s.user_id=?
          LEFT JOIN course_favorites f ON f.course_id=c.id AND f.user_id=?
          WHERE c.active=1 GROUP BY c.id ORDER BY c.author,c.title`).all(u?.id||-1,u?.id||-1,u?.id||-1);
        if(u){
          const summaries=db.prepare(`SELECT s.course_id,l.title,p.position,p.duration,p.completed FROM course_state s LEFT JOIN lessons l ON l.id=s.last_lesson_id LEFT JOIN progress p ON p.lesson_id=l.id AND p.user_id=s.user_id WHERE s.user_id=?`).all(u.id);
          const map=new Map(summaries.map(s=>[s.course_id,s]));
          courses.forEach(c=>Object.assign(c,{lastLesson:map.get(c.id)||null}));
        }
        const meta=db.prepare("SELECT value FROM meta WHERE key='scan'").get();
        const catalog=courses.map(({source_root,...c})=>({...c,isFavorite:c.favoritedAt!=null,...courseMetadata({...c,source_root},config)})).filter(c=>!shelf||c.shelf===shelf);
        const summary=meta?JSON.parse(meta.value):{};
        if(shelf)Object.assign(summary,{courses:catalog.length,lessons:catalog.reduce((n,c)=>n+c.lessonCount,0),audio:catalog.reduce((n,c)=>n+(c.audioCount||0),0),documents:catalog.reduce((n,c)=>n+c.documentCount,0)});
        return json(res,200,{courses:catalog,tagOrder:shelf?tagOrders[shelf]:tagOrder,meta:summary});
      }
      const courseRoute=/^\/api\/courses\/([a-f0-9]{24})$/.exec(p);
      if(courseRoute&&method==='GET'){
        const u=auth(req),id=courseRoute[1],course=getCourse(id);
        const favorite=db.prepare('SELECT created_at FROM course_favorites WHERE user_id=? AND course_id=?').get(u.id,id);
        Object.assign(course,{isFavorite:!!favorite,favoritedAt:favorite?.created_at??null});
        const lessons=db.prepare(`SELECT l.id,l.title,l.section,l.sort_order AS sortOrder,l.kind,l.primary_file AS mediaId,l.document_file AS documentId,
          COALESCE(NULLIF(p.duration,0),l.duration) AS duration,COALESCE(p.position,0) AS position,COALESCE(p.completed,0) AS completed,p.updated_at AS updatedAt,
          EXISTS(SELECT 1 FROM transcripts t WHERE t.lesson_id=l.id) AS hasTranscript,f.created_at AS favoritedAt
          FROM lessons l LEFT JOIN progress p ON p.lesson_id=l.id AND p.user_id=?
          LEFT JOIN lesson_favorites f ON f.lesson_id=l.id AND f.user_id=? WHERE l.course_id=? AND l.active=1 ORDER BY l.sort_order`).all(u.id,u.id,id).map(l=>({...l,isFavorite:l.favoritedAt!=null}));
        const state=u?db.prepare('SELECT last_lesson_id AS lastLessonId,queue_json AS queueJson,rate,autonext,updated_at AS updatedAt FROM course_state WHERE user_id=? AND course_id=?').get(u.id,id):null;
        const playable=new Set(lessons.filter(l=>l.mediaId).map(l=>l.id));
        const queue=state?.queueJson?JSON.parse(state.queueJson).filter(id=>playable.has(id)):lessons.filter(l=>l.mediaId).map(l=>l.id);
        return json(res,200,{course,lessons,state:{lastLessonId:state?.lastLessonId||null,rate:state?.rate||1,autonext:state?!!state.autonext:true,customQueue:state?.queueJson!=null,queue}});
      }
      const favoriteRoute=/^\/api\/courses\/([a-f0-9]{24})\/favorite$/.exec(p);
      if(favoriteRoute&&['PUT','DELETE'].includes(method)){
        const u=auth(req),id=favoriteRoute[1];getCourse(id);await body(req);
        if(method==='PUT')db.prepare('INSERT INTO course_favorites(user_id,course_id,created_at) VALUES(?,?,?) ON CONFLICT(user_id,course_id) DO NOTHING').run(u.id,id,now());
        else db.prepare('DELETE FROM course_favorites WHERE user_id=? AND course_id=?').run(u.id,id);
        const row=db.prepare('SELECT created_at FROM course_favorites WHERE user_id=? AND course_id=?').get(u.id,id);
        return json(res,200,{isFavorite:!!row,favoritedAt:row?.created_at??null});
      }
      const lessonFavoriteRoute=/^\/api\/lessons\/([a-f0-9]{24})\/favorite$/.exec(p);
      if(lessonFavoriteRoute&&['PUT','DELETE'].includes(method)){
        const u=auth(req),id=lessonFavoriteRoute[1],lesson=getLesson(id);getCourse(lesson.course_id);await body(req);
        if(method==='PUT')db.prepare('INSERT INTO lesson_favorites(user_id,lesson_id,created_at) VALUES(?,?,?) ON CONFLICT(user_id,lesson_id) DO NOTHING').run(u.id,id,now());
        else db.prepare('DELETE FROM lesson_favorites WHERE user_id=? AND lesson_id=?').run(u.id,id);
        const row=db.prepare('SELECT created_at FROM lesson_favorites WHERE user_id=? AND lesson_id=?').get(u.id,id);
        return json(res,200,{isFavorite:!!row,favoritedAt:row?.created_at??null});
      }
      if(p==='/api/lesson-favorites'&&method==='GET'){
        const u=auth(req),offset=Number(url.searchParams.get('offset')||0);
        if(!Number.isSafeInteger(offset)||offset<0)throw error(400,'分页参数无效');
        const cursor=url.searchParams.get('cursor'),match=cursor&&/^(\d+):([a-f0-9]{24})$/.exec(cursor);
        if(cursor&&(!match||!Number.isSafeInteger(Number(match[1]))||offset))throw error(400,'分页参数无效');
        const cursorTime=match?Number(match[1]):null,cursorId=match?.[2]||'';
        const total=db.prepare(`SELECT COUNT(*) AS n FROM lesson_favorites f JOIN lessons l ON l.id=f.lesson_id JOIN courses c ON c.id=l.course_id WHERE f.user_id=? AND l.active=1 AND c.active=1`).get(u.id).n;
        const rows=db.prepare(`SELECT l.id,l.title,l.kind,l.section,l.course_id AS courseId,c.title AS courseTitle,c.author,
          l.primary_file AS mediaId,l.document_file AS documentId,COALESCE(p.position,0) AS position,
          COALESCE(NULLIF(p.duration,0),l.duration) AS duration,COALESCE(p.completed,0) AS completed,f.created_at AS favoritedAt
          FROM lesson_favorites f JOIN lessons l ON l.id=f.lesson_id JOIN courses c ON c.id=l.course_id
          LEFT JOIN progress p ON p.lesson_id=l.id AND p.user_id=f.user_id
          WHERE f.user_id=? AND l.active=1 AND c.active=1
          AND (? IS NULL OR f.created_at<? OR (f.created_at=? AND l.id>?))
          ORDER BY f.created_at DESC,l.id LIMIT 101 OFFSET ?`).all(u.id,cursorTime,cursorTime,cursorTime,cursorId,offset);
        const hasMore=rows.length>100,lessons=rows.slice(0,100).map(l=>({...l,isFavorite:true})),last=lessons.at(-1);
        return json(res,200,{lessons,total,hasMore,nextCursor:hasMore&&last?last.favoritedAt+':'+last.id:null});
      }
      const transcriptRoute=/^\/api\/lessons\/([a-f0-9]{24})\/transcript$/.exec(p);
      if(transcriptRoute&&method==='GET'){
        auth(req);
        const row=db.prepare(`SELECT t.lesson_id,t.lines,t.chars,t.timed,t.ads,t.paragraphs,t.source,l.course_id AS courseId,l.title,l.duration FROM transcripts t JOIN lessons l ON l.id=t.lesson_id WHERE t.lesson_id=?`).get(transcriptRoute[1]);
        if(!row)throw error(404,'这一讲还没有文稿');
        const parse=v=>{try{return v?JSON.parse(v):null}catch(e){return null}};
        const layout=parse(row.paragraphs)||{};
        return json(res,200,{lessonId:row.lesson_id,courseId:row.courseId,title:row.title,duration:row.duration,chars:row.chars,
          source:row.source||'',lines:JSON.parse(row.lines),timed:parse(row.timed)||[],ads:parse(row.ads)||[],
          blocks:Array.isArray(layout.blocks)?layout.blocks:[],layoutMetrics:layout.metrics||null});
      }
      const stateRoute=/^\/api\/courses\/([a-f0-9]{24})\/state$/.exec(p);
      if(stateRoute&&method==='PUT'){
        const u=auth(req),id=stateRoute[1];getCourse(id);const b=await body(req);
        const previous=db.prepare('SELECT * FROM course_state WHERE user_id=? AND course_id=?').get(u.id,id);
        let queue=previous?.queue_json??null;
        if(Object.hasOwn(b,'queue')){
          if(b.queue===null)queue=null;
          else {
            if(!Array.isArray(b.queue)||b.queue.length>30000||b.queue.some(x=>typeof x!=='string')||new Set(b.queue).size!==b.queue.length)throw error(400,'队列格式错误');
            const allowed=new Set(db.prepare('SELECT id FROM lessons WHERE course_id=? AND primary_file IS NOT NULL AND active=1').all(id).map(l=>l.id));
            if(b.queue.some(x=>!allowed.has(x)))throw error(400,'队列中包含其他课程或不可播放的课时');
            queue=JSON.stringify(b.queue);
          }
        }
        const rate=b.rate===undefined?(previous?.rate||1):Number(b.rate);
        if(![0.75,1,1.25,1.5,1.75,2].includes(rate))throw error(400,'倍速不支持');
        if(b.autonext!==undefined&&typeof b.autonext!=='boolean')throw error(400,'连播设置错误');
        db.prepare(`INSERT INTO course_state(user_id,course_id,queue_json,rate,autonext,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,course_id) DO UPDATE SET queue_json=excluded.queue_json,rate=excluded.rate,autonext=excluded.autonext,updated_at=excluded.updated_at`).run(u.id,id,queue,rate,b.autonext===undefined?(previous?.autonext??1):Number(b.autonext),now());
        return json(res,200,{ok:true});
      }
      if(p==='/api/progress'&&method==='POST'){
        const u=auth(req),b=await body(req),l=getLesson(b.lessonId);
        const position=Number(b.position),duration=Number(b.duration);
        if(!Number.isFinite(position)||position<0||position>86400*7||!Number.isFinite(duration)||duration<0||duration>86400*7||duration>0&&position>duration+2)throw error(400,'播放位置无效');
        if(b.completed!==undefined&&typeof b.completed!=='boolean')throw error(400,'完成状态无效');
        if(b.touchCurrent!==undefined&&typeof b.touchCurrent!=='boolean')throw error(400,'续播状态无效');
        const observedAt=b.observedAt===undefined?now():Number(b.observedAt);
        if(!Number.isSafeInteger(observedAt)||observedAt<0||observedAt>now()+60000)throw error(400,'记录时间无效');
        const old=db.prepare('SELECT * FROM progress WHERE user_id=? AND lesson_id=?').get(u.id,l.id);
        if(old && old.observed_at>observedAt)return json(res,200,{ok:true,skipped:true,savedAt:old.updated_at});
        const completed=b.completed===undefined?(old?.completed||0):Number(b.completed);
        transaction(db,()=>{
          db.prepare(`INSERT INTO progress(user_id,lesson_id,position,duration,completed,updated_at,observed_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,lesson_id) DO UPDATE SET position=excluded.position,duration=excluded.duration,completed=excluded.completed,updated_at=excluded.updated_at,observed_at=excluded.observed_at`).run(u.id,l.id,position,duration||old?.duration||l.duration,completed,now(),observedAt);
          if(duration>0)db.prepare('UPDATE lessons SET duration=? WHERE id=?').run(duration,l.id);
          if(l.primary_file && b.touchCurrent!==false)db.prepare(`INSERT INTO course_state(user_id,course_id,last_lesson_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,course_id) DO UPDATE SET last_lesson_id=excluded.last_lesson_id,updated_at=excluded.updated_at`).run(u.id,l.course_id,l.id,now());
        });
        return json(res,200,{ok:true,savedAt:now()});
      }
      if(p==='/api/history'&&method==='GET'){
        const u=auth(req),completed=url.searchParams.get('completed')==='1'?1:0;
        const offset=Number(url.searchParams.get('offset')||0);
        if(!Number.isSafeInteger(offset)||offset<0)throw error(400,'分页参数无效');
        const total=db.prepare('SELECT COUNT(*) AS n FROM progress p JOIN lessons l ON l.id=p.lesson_id WHERE p.user_id=? AND l.active=1 AND (?=0 OR p.completed=1)').get(u.id,completed).n;
        const lessons=db.prepare(`SELECT l.id,l.title,l.kind,l.primary_file AS mediaId,l.document_file AS documentId,l.course_id AS courseId,c.title AS courseTitle,c.author,
          p.position,p.duration,p.completed,p.updated_at AS updatedAt,f.created_at AS favoritedAt
          FROM progress p JOIN lessons l ON l.id=p.lesson_id JOIN courses c ON c.id=l.course_id
          LEFT JOIN lesson_favorites f ON f.lesson_id=l.id AND f.user_id=p.user_id
          WHERE p.user_id=? AND l.active=1 AND (?=0 OR p.completed=1)
          ORDER BY p.updated_at DESC,l.id LIMIT 100 OFFSET ?`).all(u.id,completed,offset).map(l=>({...l,isFavorite:l.favoritedAt!=null}));
        return json(res,200,{lessons,total,hasMore:offset+lessons.length<total});
      }
      const mediaRoute=/^\/media\/([a-f0-9]{24})$/.exec(p);
      if(mediaRoute&&['GET','HEAD'].includes(method)){
        auth(req);const file=db.prepare('SELECT * FROM files WHERE id=? AND active=1').get(mediaRoute[1]);
        if(!file)throw error(404,'文件不存在');
        return await stream(req,res,file);
      }
      const staticFiles={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/icon.svg':'icon.svg','/media-artwork.png':'media-artwork.png','/apple-touch-icon.png':'apple-touch-icon.png'};
      if(staticFiles[p]&&['GET','HEAD'].includes(method)){
        const name=staticFiles[p],data=await fsp.readFile(path.join(PROJECT,'public',name));
        const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
        res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; media-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
        res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':'no-cache','Content-Length':data.length});return res.end(method==='HEAD'?undefined:data);
      }
      throw error(404,'没有找到这个页面');
    }catch(e){
      if(res.headersSent){res.destroy();return}
      if(!e.status)console.error(new Date().toISOString(),e);
      json(res,e.status||500,{error:e.status?e.message:'服务暂时遇到问题'});
    }
  };
  return handler;
}
export function createApp(db,mediaRoot=config.mediaRoot,options={}) {
  return http.createServer(createHandler(db,mediaRoot,options));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const db=openStore();
  if(!db.prepare("SELECT value FROM meta WHERE key='scan'").get())await scan(db);
  const port=Number(process.env.PORT||config.port),host=process.env.HOST||config.host;
  const server=createApp(db);
  server.listen(port,host,()=>console.log('知行课程已启动 http://localhost:'+port));
  const stop=()=>{db.close();process.exit(0)};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
