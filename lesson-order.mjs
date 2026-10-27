// Only a leading lesson number is a sequence, never a year from a folder.
export function lessonNumber(title) {
  const text=String(title).normalize('NFKC').trim();
  const match=/^(?:[【\[(]\s*)?(?:第\s*)?(\d+)(?=$|[讲课节期章集回丨｜|.、:：\s_\-—)\]】])/.exec(text);
  return match?Number(match[1]):null;
}
export function compareLessonNumbers(a,b) {
  const an=lessonNumber(a.title),bn=lessonNumber(b.title);
  if(an===null)return bn===null?0:1;
  if(bn===null)return -1;
  return an-bn;
}
