import path from 'node:path';

const youthTopics=[
  ['语文',/语文|古诗|唐诗|宋词|汉字|成语|文言|古文|三字经|百家姓/],
  ['写作',/写作|作文|日记|周记|读后感/],
  ['阅读',/阅读|精读|精讲|读书|名著|文学/],
  ['数学',/数学|奥数|数独|几何|算术|概率|统计/],
  ['英语',/英语|英文|双语|自然拼读|单词/],
  ['历史',/历史|史纲|简史|世界史|中国史|三国|史记|五千年|五干年/],
  ['中国史',/中国历史|中国史|三国|史记|水浒|儒林|论语|唐朝|宋朝|清朝/],
  ['世界史',/世界史|世界五|全球史|俄罗斯|英国|美国|德国|罗马史/],
  ['地理',/地理|地球|环球|环游|探险|博物馆/],
  ['科学',/科学|科普|物理|化学|生物|细胞|天文|宇宙|太空|恐龙|气象|黑洞|相对论/],
  ['宇宙与天文',/宇宙|天文|星座|太阳系|黑洞|太空|时间简史|相对论/],
  ['自然与动物',/动物|恐龙|博物|植物|自然|生态|饲养/],
  ['编程与科技',/编程|科技|人工智能|算法|AI|计算机|机器人/],
  ['思维训练',/思维|逻辑|脑力|聪明|认知|推理|记忆|数独|魔方/],
  ['学习方法',/学习|记忆|考试|训练营|培优|高效|学霸/],
  ['情绪与成长',/情绪|成长|心理|情商|烦恼|自我|自信|习惯|青春/],
  ['安全与健康',/安全|保护|健康|医学|营养|疾病|临床|众病之王/],
  ['文学',/文学|名著|诗|小说|武侠|聊斋|红楼|老舍|青鸟|小王子|儒林/],
  ['科幻',/科幻|三体|外星|沙丘|神秘岛|地心游记/],
  ['侦探与推理',/侦探|推理|神探|柯南|福尔摩斯|狄仁杰|断案|悬疑|悬案/],
  ['广播剧',/广播剧|名著剧|历史剧|侦探剧|科普剧|有声绘本|故事剧/],
  ['故事',/故事|童话|寓言|绘本|民间|一千零一夜|神话/],
  ['国学',/国学|论语|诸子|儒家|道德经|三字经|百家姓|古代文学/],
  ['艺术与音乐',/艺术|音乐|美术|绘画|书法|戏剧|莎士比亚|魔术/],
  ['人物传记',/传记|名人|科学家故事|影响世界100人|人物|李白|苏轼/],
  ['财商启蒙',/经济|金融|财富|财商|理财/]
];

const courseTopics=[
  ['经济金融',/经济|金融|财务|财政|贸易/],
  ['投资理财',/投资|理财|财富|保险/],
  ['商业管理',/商业|管理|创业|组织|公司|领导力|经营/],
  ['产品与营销',/产品|营销|品牌|流量|增长|销售|销冠|用户/],
  ['历史人文',/历史|史纲|简史|通鉴|三国|史记|孔子|国学/],
  ['世界文明',/世界|文明|罗马|英国|德国|俄罗斯|美国|全球史/],
  ['哲学',/哲学|思想|伦理|存在主义|道德经|佛学/],
  ['心理学',/心理|情绪|情商|认知/],
  ['家庭与关系',/家庭|关系|亲密|爱情|沟通|亲子|婚姻/],
  ['教育',/教育|孩子|青春期/],
  ['文学阅读',/文学|阅读|读书|好书|名著|武侠|聊斋|红楼|老舍|唐诗|千古文章|水浒/],
  ['写作表达',/写作|文案|表达|传播|演讲/],
  ['科学科技',/科学|物理|化学|生物|天文|宇宙|进化|科技/],
  ['科技前沿',/科技|创新|算法|AI|人工智能|制造|能源|互联网|数字化/],
  ['数学与统计',/数学|统计|概率|博弈论|数据思维/],
  ['法律',/法律|法学|劳动法|宪法|法典|法治/],
  ['医学与健康',/医学|健康|营养|临床|疾病|众病之王/],
  ['艺术与音乐',/艺术|音乐|美术|书法|戏剧|莎士比亚/],
  ['思维成长',/思维|逻辑|认知|决策|算法|修炼|精英|人生/],
  ['学习方法',/学习|记忆|高效|大学·问/],
  ['人物传记',/传记|人物|苏轼|孔子评传/],
  ['社会与政治',/社会|政治|政经|国际|人类学|文明/],
  ['自然与博物',/自然|博物|动物|植物|进化|生命/]
];

export const tagOrders={courses:['专栏','大师课',...courseTopics.map(([tag])=>tag)],youth:youthTopics.map(([tag])=>tag)};
export const tagOrder=[...new Set([...tagOrders.courses,...tagOrders.youth])];

export function courseMetadata(course,settings={}){
  const root=path.resolve(course.source_root||settings.mediaRoot||'.').toLowerCase();
  const source=(settings.collections||[]).find(s=>path.resolve(s.root).toLowerCase()===root);
  const library=source?.label||(/少年课程/.test(root)?'少年课程':/大师课/.test(root)?'大师课':'专栏');
  const shelf=source?.shelf||(library==='少年课程'?'youth':'courses');
  const topics=shelf==='youth'?youthTopics:courseTopics;
  const tags=[...(shelf==='youth'?[]:[library]),...topics.filter(([,pattern])=>pattern.test(course.title)).map(([tag])=>tag)];
  if(shelf!=='youth'&&course.category)tags.push(course.category);
  return {library,shelf,tags:[...new Set(tags)]};
}

export function youthCourseInfo(name){
  let title=name.replace(/^\d+[.、．\s]*/,'').replace(/[【\[]\s*(?:已?完结|更新中|连载中|更新)\s*[】\]]/g,'').replace(/[（(]\s*(?:已?完结|更新中|连载中)\s*[）)]/g,'').trim();
  let author='少年课程';
  const teacher=/^([^《》·•]{1,16})[·•]\s*《/.exec(title);
  if(teacher){author=teacher[1].trim();title=title.slice(teacher[0].length-1)}
  if(/^《[^《》]+》$/.test(title))title=title.slice(1,-1);
  const tags=courseMetadata({title,source_root:'少年课程'}).tags;
  const category=tags.some(t=>['科学','数学','宇宙与天文','自然与动物','编程与科技'].includes(t))?'科学科技':tags.includes('历史')||tags.includes('国学')?'历史人文':tags.includes('情绪与成长')||tags.includes('安全与健康')?'心理生活':tags.includes('思维训练')?'思维成长':'文化艺术';
  return {title,author,price:null,status:/更新|连载/.test(name)?'更新中':'已完结',category};
}
