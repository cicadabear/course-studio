import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore,config,transaction,PROJECT } from './store.mjs';
import { compareLessonNumbers,lessonNumber } from './lesson-order.mjs';
import {youthCourseInfo,courseMetadata} from './catalog-tags.mjs';
const media = new Set(['.mp3','.m4a','.wav','.ogg','.flac']);
const docs = new Set(['.pdf']);
const collator = new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
export const hash = s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,24);
export function cleanTitle(stem) {
  return stem.replace(/^(?:[a-z]{1,10}-\d{4,8}|\d{2}\.\d{4}|\d{4}[.-]\d{2}[.-]\d{2})[丨｜|\s_-]*/i,'').trim();
}
export const normalized = s=>cleanTitle(s).normalize('NFKC').replace(/[\p{P}\p{S}\s丨]+/gu,'').toLowerCase();
function category(s) {
  if(/投资|金融|经济|财经|财富|政经|保险|财政|贸易/.test(s)) return '经济金融';
  if(/历史|国学|孔子|通鉴|史纲|日本简史|水浒|文明/.test(s)) return '历史人文';
  if(/科技|科学|博物|进化|脑科学|创新/.test(s)) return '科学科技';
  if(/心理|情绪|健康|营养|家庭|教育|孩子|青春期/.test(s)) return '心理生活';
  if(/哲学|认知|思维|精英|决策|大学·问|修炼/.test(s)) return '思维成长';
  if(/艺术|美术|音乐|阅读|读书|文学|文化|识字|好书|名刊/.test(s)) return '文化艺术';
  return '商业管理';
}
export function courseInfo(name) {
  const stripped=name.replace(/^[￥¥]?\d+(?:\.\d+)?元[-－\s]*/,'');
  const opening=stripped.indexOf('《'),closing=stripped.lastIndexOf('》');
  let title=(opening>=0?(closing>opening?stripped.slice(opening+1,closing):stripped.slice(opening+1).replace(/[（(]?\s*(?:完结|更新中)[）)]*$/,'').replace(/[）)]$/,'')):stripped.replace(/（[^）]*）$/,'')).replace(/^《+/,'').trim();
  const author=stripped.includes('《')?stripped.slice(0,stripped.indexOf('《')).replace(/[·\s]+$/,''):'';
  if(author && title.startsWith(author+'·'))title=title.slice(author.length+1);
  const price=Number(name.match(/^[￥¥]?(\d+(?:\.\d+)?)元/)?.[1])||null;
  return {title,price,author:author||'专题课程',status:/更新中/.test(name)?'更新中':'已完结',category:category(title)};
}
async function walk(dir,base,out,diagnostics) {
  const entries=await fs.readdir(dir,{withFileTypes:true});
  for(const e of entries) {
    if(e.isSymbolicLink()) continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory()) await walk(p,base,out,diagnostics);
    else if(e.isFile() && (media.has(path.extname(e.name).toLowerCase()) || docs.has(path.extname(e.name).toLowerCase()))) {
      const stat=await fs.stat(p);
      if(stat.size>0) out.push({relative:path.relative(base,p),ext:path.extname(e.name).toLowerCase(),size:stat.size,folder:path.relative(base,dir),stem:path.basename(e.name,path.extname(e.name))});
      else diagnostics.zeroBytes.push(path.relative(base,p));
    }else if(e.isFile()) {
      const ext=path.extname(e.name).toLowerCase();
      diagnostics.ignored[ext]=(diagnostics.ignored[ext]||0)+1;
    }
  }
}
function sortLessons(a,b) {
  const sequence=compareLessonNumbers({title:a.sortTitle||a.title||cleanTitle(a.stem)},{title:b.sortTitle||b.title||cleanTitle(b.stem)});
  if(sequence)return sequence;
  const section=collator.compare(a.folder,b.folder);
  if(section) return section;
  return collator.compare(a.stem,b.stem);
}
export function importTitle(stem){
  return cleanTitle(stem).replace(/^(?:[a-z]{1,10}-)?(?:\d{2}\.\d{4}|[01]\d[0-3]\d)[丨｜|\s_-]+/i,'').replace(/_\d{8}_\d{6}$/,'').replace(/^\[\d+(?:\.\d+)?倍速\]/,'').trim();
}
function textSimilarity(a,b){
  if(!a.length||!b.length)return 0;
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const next=[i];
    for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));
    row=next;
  }
  return 1-row[b.length]/Math.max(a.length,b.length);
}
function pairDocuments(lessons,identify,repairs){
  const audio=lessons.filter(l=>l.primary),documents=lessons.filter(l=>l.kind==='document');
  const key=l=>normalized(importTitle(l.stem)).replace(/^0+(?=\D)/,'');
  const number=l=>lessonNumber(importTitle(l.stem));
  const date=l=>l.stem.replace(/^[a-z]{1,10}-/i,'').match(/^(?:(\d{2})\.)?(\d{4})(?=[丨｜|\s_-])/);
  const sameRelease=(a,b)=>{const x=date(a),y=date(b);return x&&y&&x[2]===y[2]&&(!x[1]||!y[1]||x[1]===y[1])};
  const matches=(a,b)=>key(a)===key(b)||a.folder===b.folder&&number(a)!==null&&number(a)===number(b)&&(sameRelease(a,b)||textSimilarity(key(a),key(b))>=0.72);
  const consumed=new Set();
  for(const target of audio){
    if(audio.filter(l=>key(l)===key(target)).length!==1)continue;
    const variants=documents.filter(d=>!consumed.has(d)&&key(d)===key(target));
    variants.sort((a,b)=>Number(b.folder===target.folder)-Number(a.folder===target.folder)||collator.compare(a.relative,b.relative));
    for(const doc of variants){
      const primary=!target.document;
      if(primary)target.document=identify(doc.group.find(f=>docs.has(f.ext)).relative);
      target.group.push(...doc.group);consumed.add(doc);
      repairs.push({code:primary?'PAIRED_DOCUMENT':'DOCUMENT_VARIANT',audio:target.relative,document:doc.relative});
    }
  }
  for(const doc of documents){
    if(consumed.has(doc))continue;
    const candidates=audio.filter(l=>!l.document&&matches(l,doc));
    if(candidates.length!==1)continue;
    const target=candidates[0];
    // A unique match in both directions avoids silently assigning one transcript to two releases.
    const competing=documents.filter(d=>!consumed.has(d)&&matches(target,d));
    if(competing.length!==1)continue;
    target.document=identify(doc.group.find(f=>docs.has(f.ext)).relative);
    target.group.push(...doc.group);
    consumed.add(doc);
    repairs.push({code:'PAIRED_DOCUMENT',audio:target.relative,document:doc.relative,rule:sameRelease(target,doc)?'unique-section-number-date':'unique-title'});
  }
  return lessons.filter(l=>!consumed.has(l));
}
export async function inspectSource(root,log=console.log) {
  root=path.resolve(root);
  const dirs=(await fs.readdir(root,{withFileTypes:true})).filter(x=>x.isDirectory()&&!x.isSymbolicLink()).sort((a,b)=>collator.compare(a.name,b.name));
  // Preserve the existing IDs in the original library; additional roots get a namespace.
  const namespace=root.toLowerCase()===path.resolve(config.mediaRoot).toLowerCase()?'':root.toLowerCase()+'\0';
  const youth=courseMetadata({source_root:root,title:''},config).shelf==='youth';
  const identify=value=>hash(namespace+value);
  const rules=config.scanRulesFile?JSON.parse(await fs.readFile(path.resolve(PROJECT,config.scanRulesFile),'utf8')):{exclude:[]};
  const all=[];
  const report={root,folders:dirs.length,courses:[],issues:[]};
  for(const [index,dir] of dirs.entries()) {
    let files=[];
    const diagnostics={zeroBytes:[],ignored:{}};
    await walk(path.join(root,dir.name),root,files,diagnostics);
    const issues=[];
    const warn=(code,paths=[],detail='')=>issues.push({code,count:paths.length,paths,detail});
    const repairs=[];
    files=files.filter(f=>{
      const rule=(rules.exclude||[]).find(r=>path.resolve(r.root).toLowerCase()===root.toLowerCase()&&r.path===f.relative);
      if(!rule)return true;
      warn('EXCLUDED_FILE',[f.relative],rule.reason);
      return false;
    });
    if(namespace){
      const candidates=new Map(),duplicates=new Set();
      for(const f of files){
        const key=normalized(importTitle(f.stem))+'\0'+f.ext+'\0'+f.size;
        if(!candidates.has(key))candidates.set(key,[]);
        candidates.get(key).push(f);
      }
      for(const group of candidates.values()){
        if(group.length<2)continue;
        group.sort((a,b)=>b.folder.split(path.sep).length-a.folder.split(path.sep).length||collator.compare(a.relative,b.relative));
        const seen=new Map();
        for(const f of group){
          const digest=crypto.createHash('sha256');
          for await(const chunk of createReadStream(path.join(root,f.relative)))digest.update(chunk);
          const checksum=digest.digest('hex');
          if(seen.has(checksum)){
            duplicates.add(f);
            repairs.push({code:media.has(f.ext)?'IDENTICAL_AUDIO_COPY':'IDENTICAL_DOCUMENT_COPY',kept:seen.get(checksum),ignored:f.relative});
          }else seen.set(checksum,f.relative);
        }
      }
      files=files.filter(f=>!duplicates.has(f));
    }
    if(diagnostics.zeroBytes.length)warn('ZERO_BYTE_FILE',diagnostics.zeroBytes);
    if(!youth&&(!/《[^《》]+》/.test(dir.name)||/[《》]/.test(dir.name.replace(/《[^《》]+》/,''))))warn('COURSE_NAME_FORMAT',[],dir.name);
    if(/^.[\d.]+元/.test(dir.name)&&!/^.[0-9]+元/.test(dir.name))warn('PRICE_FORMAT',[],dir.name);
    const grouped=new Map();
    for(const f of files) {
      const release=f.stem.match(/^(?:[a-z]{1,10}-(\d{4,8})|(\d{2}\.\d{4})|(\d{4}[.-]\d{2}[.-]\d{2}))/i)?.[0]||'';
      const k=f.folder+'\0'+release+'\0'+normalized(f.stem);
      if(!grouped.has(k)) grouped.set(k,[]);
      grouped.get(k).push(f);
    }
    let lessons=[];
    for(const [key,group] of grouped) {
      const priority=['.mp3','.m4a','.wav','.ogg','.flac'];
      const ms=group.filter(x=>media.has(x.ext)).sort((a,b)=>priority.indexOf(a.ext)-priority.indexOf(b.ext));
      const ds=group.filter(x=>docs.has(x.ext));
      const primary=ms[0]||ds[0]; if(!primary) continue;
      if(ms.length>1||ds.length>1)warn('MULTIPLE_VARIANTS',group.map(f=>f.relative));
      const id=identify(key);
      lessons.push({...primary,id,title:namespace?importTitle(primary.stem):cleanTitle(primary.stem),group,primary:ms[0]?identify(ms[0].relative):null,document:ds[0]?identify(ds[0].relative):null,kind:!ms.length?'document':'audio'});
    }
    if(namespace)lessons=pairDocuments(lessons,identify,repairs);
    if(youth)for(const l of lessons)l.sortTitle=l.title.replace(/^[丨｜|\s]*(\d{1,3})(?=\D|$)/,'$1丨');
    lessons.sort(sortLessons);
    const audio=lessons.filter(l=>l.kind==='audio'),docOnly=lessons.filter(l=>l.kind==='document');
    if(!lessons.length)warn('NO_SUPPORTED_CONTENT',[],JSON.stringify(diagnostics.ignored));
    else if(!audio.length)warn('NO_AUDIO',docOnly.map(l=>l.relative));
    if(audio.length&&docOnly.length)warn('UNPAIRED_DOCUMENT',docOnly.map(l=>l.relative));
    const unpaired=audio.filter(l=>!l.document);
    if(unpaired.length&&files.some(f=>docs.has(f.ext)))warn('UNPAIRED_AUDIO',unpaired.map(l=>l.relative));
    const course={id:identify(dir.name),folder:dir.name,sourceRoot:root,...(youth?youthCourseInfo(dir.name):courseInfo(dir.name)),lessons};
    if(lessons.length)all.push(course);
    report.courses.push({id:course.id,folder:dir.name,title:course.title,author:course.author,price:course.price,lessons:lessons.length,audio:audio.length,documentOnly:docOnly.length,files:files.length,ignored:diagnostics.ignored,repairs,issueCodes:[...new Set(issues.map(i=>i.code))]});
    for(const issue of issues)report.issues.push({courseId:course.id,folder:dir.name,...issue});
    if((index+1)%20===0) log('已读取 '+(index+1)+' / '+dirs.length+' 门课程');
  }
  return {all,report};
}
export async function scan(db,root=[config.mediaRoot,...(config.mediaRoots||[])],log=console.log,options={}) {
  const started=Date.now(),roots=[...new Set((Array.isArray(root)?root:[root]).map(r=>path.resolve(r)))];
  const sources=[];
  for(const source of roots)sources.push(await inspectSource(source,log));
  const report={scannedAt:new Date().toISOString(),dryRun:!!options.dryRun,applied:false,sources:sources.map(s=>s.report)};
  const reportPath=path.resolve(options.reportPath||path.join(PROJECT,'artifacts','scan-'+Date.now()+'.json'));
  await fs.mkdir(path.dirname(reportPath),{recursive:true});
  const saveReport=async()=>{
    await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
    const lines=['# 课程扫描报告','',`扫描时间：${report.scannedAt}`,`状态：${report.dryRun?'仅检查':report.applied?'已写入数据库':'扫描完成，尚未写入数据库'}`,''];
    for(const source of sources){
      const r=source.report,repairs=r.courses.flatMap(c=>c.repairs);
      lines.push('## '+r.root,'',`目录 ${r.folders} 个；有效课程 ${source.all.length} 门；音频 ${r.courses.reduce((n,c)=>n+c.audio,0)} 讲。`,`自动配对 ${repairs.filter(r=>r.code==='PAIRED_DOCUMENT').length} 处；多版本文稿 ${repairs.filter(r=>r.code==='DOCUMENT_VARIANT').length} 处；经内容校验的重复文件 ${repairs.filter(r=>r.code.startsWith('IDENTICAL_')).length} 份。`,'','名称、价格格式由解析器修正；无支持内容的目录跳过；已确认的误放文件仅排除索引。未配对文件保留：其中包含独立文稿、加餐、直播或确实缺失的配套资料，程序不会凭编号强行配对。视频继续按原规则忽略，磁盘原文件不变。','','| 课程 | 音频 | 独立文稿 | 处理或待检查项 |','| --- | ---: | ---: | --- |');
      for(const c of r.courses.filter(c=>c.issueCodes.length||c.repairs.length)){
        const labels=c.issueCodes.map(code=>({COURSE_NAME_FORMAT:'名称已规范',PRICE_FORMAT:'价格已规范',NO_SUPPORTED_CONTENT:'跳过：无课程内容',EXCLUDED_FILE:'误放文件已排除',UNPAIRED_AUDIO:'部分音频没有可确认的配套 PDF',UNPAIRED_DOCUMENT:'保留独立文稿',NO_AUDIO:'仅文稿',ZERO_BYTE_FILE:'零字节文件已跳过',MULTIPLE_VARIANTS:'多文件版本需检查'})[code]||code);
        if(c.repairs.length)labels.push('自动处理 '+c.repairs.length+' 处');
        lines.push(`| ${c.title.replace(/\|/g,' / ')} | ${c.audio} | ${c.documentOnly} | ${labels.join('；')} |`);
      }
      lines.push('','各异常文件路径、排除原因和自动配对明细见同名 JSON 报告。','');
    }
    await fs.writeFile(reportPath.replace(/\.json$/,'')+'.md',lines.join('\n'));
  };
  await saveReport();
  for(const source of sources)for(const course of source.report.courses.filter(c=>c.issueCodes.length))log('异常 '+course.folder+' : '+course.issueCodes.join(', '));
  log('扫描报告 '+reportPath);
  if(options.dryRun)return report;
  const insertCourse=db.prepare('INSERT INTO courses(id,title,author,folder,category,status,price_yuan,source_root,active) VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET title=excluded.title,author=excluded.author,folder=excluded.folder,category=excluded.category,status=excluded.status,price_yuan=excluded.price_yuan,source_root=excluded.source_root,active=1');
  const insertLesson=db.prepare('INSERT INTO lessons(id,course_id,title,section,sort_order,kind,primary_file,document_file,active) VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET title=excluded.title,section=excluded.section,sort_order=excluded.sort_order,kind=excluded.kind,primary_file=excluded.primary_file,document_file=excluded.document_file,active=1');
  const insertFile=db.prepare('INSERT INTO files(id,lesson_id,relative_path,ext,size,source_root,active) VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET lesson_id=excluded.lesson_id,size=excluded.size,source_root=excluded.source_root,active=1');
  let counts;
  transaction(db,()=>{
    // Scope invalidation to the scanned source; do not take other libraries offline.
    const scope="lower(COALESCE(NULLIF(source_root,''),?))=lower(?)";
    for(const sourceRoot of roots){
      const affected=db.prepare('SELECT id FROM courses WHERE '+scope).all(config.mediaRoot,sourceRoot);
      for(const {id} of affected){
        db.prepare('UPDATE files SET active=0 WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id=?)').run(id);
        db.prepare('UPDATE lessons SET active=0 WHERE course_id=?').run(id);
        db.prepare('UPDATE courses SET active=0 WHERE id=?').run(id);
      }
    }
    for(const course of sources.flatMap(s=>s.all)) {
      insertCourse.run(course.id,course.title,course.author,course.folder,course.category,course.status,course.price,course.sourceRoot);
      course.lessons.forEach((l,i)=>{
        const section=l.folder.slice(course.folder.length).replace(/^[\\/]/,'').replace(/\\/g,' / ')||'全部内容';
        insertLesson.run(l.id,course.id,l.title,section,i,l.kind,l.primary,l.document);
        for(const f of l.group) {
          const prefix=course.sourceRoot.toLowerCase()===path.resolve(config.mediaRoot).toLowerCase()?'':course.sourceRoot.toLowerCase()+'\0';
          insertFile.run(hash(prefix+f.relative),l.id,f.relative,f.ext,f.size,course.sourceRoot);
        }
      });
    }
    counts={courses:db.prepare('SELECT COUNT(*) n FROM courses WHERE active=1').get().n,lessons:db.prepare('SELECT COUNT(*) n FROM lessons WHERE active=1').get().n,audio:db.prepare("SELECT COUNT(*) n FROM lessons WHERE active=1 AND kind='audio'").get().n,video:0,documents:db.prepare("SELECT COUNT(*) n FROM files WHERE active=1 AND ext='.pdf'").get().n,mediaFiles:db.prepare("SELECT COUNT(*) n FROM files WHERE active=1 AND ext!='.pdf'").get().n,scannedAt:Date.now()};
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('scan',JSON.stringify(counts));
  });
  log('索引完成 '+JSON.stringify(counts)+' 耗时 '+((Date.now()-started)/1000).toFixed(1)+'s');
  report.applied=true;report.counts=counts;
  await saveReport();
  return counts;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),roots=[],options={};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--root'&&args[i+1])roots.push(args[++i]);
    else if(args[i]==='--report'&&args[i+1])options.reportPath=args[++i];
    else if(args[i]==='--dry-run')options.dryRun=true;
    else throw new Error('Unknown scan argument: '+args[i]);
  }
  const db=options.dryRun?null:openStore();
  try {await scan(db,roots.length?roots:undefined,console.log,options);} finally {db?.close();}
}
