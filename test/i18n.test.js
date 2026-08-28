// 화면 말 — 한국어 / English.
//
// 여기서 재는 것은 번역이 잘 됐나가 아니다. 그건 못 잰다. 잴 수 있는 것은
// **반쯤 옮겨진 상태에서 화면이 망가지지 않는가** 이고, 그게 이 기능에서
// 실제로 나는 사고다.
//
//   빈칸이 나오면 사람은 고장으로 읽는다. 열쇠 이름이 나오면 알아채기라도 한다.
//   한국어가 나오면 "아직 안 옮겼구나" 로 읽는다 — 그게 사실이고 제일 낫다.
//
// 그래서 세 겹으로 받친다: 영어 → 한국어 → 열쇠. 어느 자리에서도 빈칸이
// 안 나오는지, 얼마나 옮겼는지를 숨기지 않는지를 잰다.
import {
  말, 언어, 언어정하기, 언어고르기, 언어잡기, 옮겨졌나, 옮긴만큼, 짝없는열쇠,
  조사붙이기,
  언어들, 기본언어,
} from '../src/i18n/index.js';
import { ko } from '../src/i18n/ko.js';
import { en } from '../src/i18n/en.js';
import { COMMANDS } from '../src/commands.js';
import { SEGMENTS } from '../src/ui/status.js';
import { 기본곁말 } from '../src/ui/intro.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 적어둘것 = [];

const 원래언어 = 언어();
const 원래env = process.env.DEEL_LANG;
delete process.env.DEEL_LANG;

trace('1-빈칸이안나온다');

// ── 어느 자리에서도 빈칸이 안 나온다 ────────────────────────────────────
{
  for (const l of 언어들) {
    언어정하기(l);
    const 빈것 = Object.keys(ko).filter((k) => !String(말(k)).trim());
    check(`${l}: 빈칸으로 나오는 말이 없다`, 빈것.length === 0, 빈것.slice(0, 5).join(', '));
  }
  언어정하기('en');
  // 영어에 없는 열쇠는 한국어가 나온다 — 빈칸도, 열쇠 이름도 아니다.
  const 없는것 = Object.keys(ko).find((k) => !옮겨졌나(k, 'en'));
  if (없는것) {
    check('영어에 없으면 한국어가 나온다', 말(없는것) === ko[없는것], `${없는것} → ${말(없는것)}`);
  } else {
    check('영어가 전부 채워져 있다 — 되돌아갈 자리가 아직 없다', true, '');
  }
  // 아예 없는 열쇠는 열쇠 이름 그대로. 프로그램이 안 죽는 것이 먼저다.
  check('모르는 열쇠는 열쇠 이름', 말('없.는.열쇠') === '없.는.열쇠');
  check('빈 열쇠도 안 죽는다', 말('') === '' && 말(null) === '' && 말(undefined) === '');
}

trace('2-자리끼우기');

// ── {자리} 끼우기 ───────────────────────────────────────────────────────
{
  언어정하기('ko');
  check('숫자를 끼운다', 말('head.skills', { n: 7 }) === '스킬 7', 말('head.skills', { n: 7 }));
  check('여러 자리도', 말('undo.done', { turns: 2, files: 5 }).includes('2') && 말('undo.done', { turns: 2, files: 5 }).includes('5'),
    말('undo.done', { turns: 2, files: 5 }));
  // 안 준 자리는 **그대로 둔다.** 지워 버리면 "0개 턴" 처럼 틀린 말이 되고,
  // 틀린 숫자는 안 적힌 것보다 나쁘다.
  check('안 준 자리는 그대로 둔다', 말('head.skills').includes('{n}'), 말('head.skills'));
  /*
   * 자리 이름이 한글이어도 끼워진다.
   *
   * 이걸 따로 재는 이유가 있다. 처음에 자리 규칙을 \w 로 잡았는데 한글은 \w 가
   * 아니라, `{안}` 이 영영 안 맞아 화면에 중괄호째로 찍혔다. 영어 화면에서만
   * 눈에 띄는 종류의 사고라 검사가 없으면 오래 안 들킨다.
   */
  const 끼운것 = 말('head.glyphHint', { 안: '⌂', 밖: '↗' });
  check('한글 자리 이름도 끼워진다', !끼운것.includes('{') && 끼운것.includes('⌂') && 끼운것.includes('↗'), 끼운것);
  언어정하기('en');
  check('영어에서도 한글 자리 이름이 끼워진다',
    !말('head.glyphHint', { 안: '⌂', 밖: '↗' }).includes('{'),
    말('head.glyphHint', { 안: '⌂', 밖: '↗' }));
  언어정하기('ko');
  check('채움을 안 주면 원문 그대로', 말('undo.nothing') === ko['undo.nothing']);
  check('이상한 채움에도 안 죽는다', typeof 말('head.skills', { 딴것: 1 }) === 'string');
}

trace('3-언어고르기');

// ── 무엇을 언어 이름으로 받나 ───────────────────────────────────────────
{
  for (const v of ['ko', 'KO', '한국어', '한글', 'korean', 'ko_KR.UTF-8', 'ko-KR']) {
    check(`'${v}' → ko`, 언어고르기(v) === 'ko', String(언어고르기(v)));
  }
  for (const v of ['en', 'EN', 'english', '영어', 'en_US.UTF-8', 'en-GB']) {
    check(`'${v}' → en`, 언어고르기(v) === 'en', String(언어고르기(v)));
  }
  for (const v of ['fr', '', null, undefined, 'zh_CN', 42]) {
    check(`'${v}' 는 모른다`, 언어고르기(v) === null, String(언어고르기(v)));
  }
  const 앞 = 언어();
  check('모르는 값이면 안 바꾼다', 언어정하기('fr') === false && 언어() === 앞);
  check('아는 값이면 바꾼다', 언어정하기('en') === true && 언어() === 'en');
}

trace('4-어느것이이기나');

// ── 환경변수가 설정을 이긴다 ────────────────────────────────────────────
//
// 한 번만 영어로 켜 보려는 사람이 설정을 안 건드리고 `DEEL_LANG=en deel` 로
// 할 수 있어야 한다. 반대로 되어 있으면 그 한 번을 위해 설정을 고쳤다가
// 되돌리는 일을 하게 된다.
{
  check('환경변수가 이긴다', 언어잡기({ env: { DEEL_LANG: 'en' }, cfg: { lang: 'ko' } }) === 'en');
  check('환경변수가 없으면 설정', 언어잡기({ env: {}, cfg: { lang: 'en' } }) === 'en');
  check('둘 다 없으면 한국어', 언어잡기({ env: {}, cfg: {} }) === 기본언어);
  check('기본이 한국어다', 기본언어 === 'ko');
  // 시스템 로캘은 안 본다. 윈도우·WSL 에서 LANG=en_US 인 한국 사람이 많고,
  // 그걸 보면 멀쩡히 쓰던 사람 화면이 어느 날 영어로 바뀐다.
  check('LANG 은 안 본다', 언어잡기({ env: { LANG: 'en_US.UTF-8' }, cfg: {} }) === 'ko');
  check('LC_ALL 도 안 본다', 언어잡기({ env: { LC_ALL: 'en_US.UTF-8' }, cfg: {} }) === 'ko');
  check('이상한 값이면 한국어', 언어잡기({ env: { DEEL_LANG: 'fr' }, cfg: { lang: 'zz' } }) === 'ko');
  check('cfg 가 없어도 안 죽는다', 언어잡기({ env: {} }) === 'ko');
}

trace('5-죽은말이없나');

// ── 영어에만 있는 열쇠는 죽은 말이다 ────────────────────────────────────
//
// 한국어 쪽을 고치면서 열쇠 이름을 바꾸면 영어 쪽에 짝 없는 말이 남는다.
// 그 말은 영영 화면에 안 나오는데, 파일에는 있으니 누군가 계속 손본다.
{
  const 짝없음 = 짝없는열쇠('en');
  check('영어에만 있는 열쇠가 없다', 짝없음.length === 0, 짝없음.join(', '));
  check('한국어 쪽에 빈 값이 없다',
    Object.entries(ko).every(([, v]) => typeof v === 'string' && v.trim()),
    Object.entries(ko).filter(([, v]) => !String(v).trim()).map(([k]) => k).join(', '));
  check('영어 쪽에도 빈 값이 없다',
    Object.entries(en).every(([, v]) => typeof v === 'string' && v.trim()),
    Object.entries(en).filter(([, v]) => !String(v).trim()).map(([k]) => k).join(', '));

  // 자리 이름이 두 언어에서 같아야 한다. 다르면 영어 화면에 {turns} 가 그대로 찍힌다.
  // 규칙을 구현과 똑같이 잡는다. 여기만 \w 로 두면 한글 자리 이름은 안 세어져서,
  // 정작 검사가 필요한 자리(영어 화면의 {안})를 조용히 넘긴다.
  //
  // 조사 표시(`{것:으로}`)와 조사만 내는 표시(`{~값:은는}`)는 **한국어 문법**
  // 이지 자리 이름이 아니다. 영어 글에는 있을 수가 없으므로, 여기서는 이름만
  // 남기고 견준다. 안 그러면 한국어를 자연스럽게 고칠 때마다 이 검사가 운다.
  const 자리들 = (v) => [...new Set(
    (String(v).match(/\{[^{}\s]+\}/g) ?? [])
      .map((t) => `{${t.slice(1, -1).replace(/^~/, '').split(':')[0]}}`),
  )].sort().join(',');
  const 어긋남 = Object.keys(en).filter((k) => ko[k] && 자리들(ko[k]) !== 자리들(en[k]));
  check('두 언어의 {자리} 이름이 같다', 어긋남.length === 0,
    어긋남.map((k) => `${k}: ${자리들(ko[k])} ≠ ${자리들(en[k])}`).join(' · '));
}

trace('6-명령표가따라오나');

// ── 명령 목록이 언어를 따라오는가 ───────────────────────────────────────
//
// 켤 때 한 번 읽어 굳히면 /lang 으로 바꿔도 목록이 안 따라온다. 그러면
// 바뀐 것처럼 보이다가 안 바뀐 자리가 남고, 그게 제일 헷갈린다.
{
  언어정하기('ko');
  const 한 = COMMANDS.help.desc;
  언어정하기('en');
  const 영 = COMMANDS.help.desc;
  check('/lang 뒤에 명령 설명이 따라온다', 한 !== 영, `${한} / ${영}`);
  check('영어 설명이 영어다', /^[\x00-\x7f]+$/.test(영), 영);
  check('인자 힌트도 따라온다', COMMANDS.ctx.arg === en['cmd.ctx.arg'], COMMANDS.ctx.arg);

  // 모든 명령에 설명이 있어야 한다. 빠뜨리면 열쇠 이름이 그대로 찍힌다.
  for (const l of 언어들) {
    언어정하기(l);
    const 빠진것 = Object.keys(COMMANDS).filter((n) => COMMANDS[n].desc === `cmd.${n}.desc`);
    check(`${l}: 설명 없는 명령이 없다`, 빠진것.length === 0, 빠진것.join(', '));
    const 인자빠짐 = Object.keys(COMMANDS)
      .filter((n) => 'arg' in COMMANDS[n] && COMMANDS[n].arg === `cmd.${n}.arg`);
    check(`${l}: 인자 힌트가 빠진 명령이 없다`, 인자빠짐.length === 0, 인자빠짐.join(', '));
  }

  // 화면 말이 온통 못 읽는 말인 사람에게 '전부 보려면 /level developer' 라고
  // 적어 봐야 그 줄도 못 읽는다. /lang 은 초보 목록에 있어야 한다.
  const { shows } = await import('../src/ui/level.js');
  check('/lang 은 초보 목록에 있다', shows('쉬움', 'lang') === true);

  // 상태줄 조각 이름도 같은 길로 온다.
  언어정하기('en');
  check('상태줄 조각 이름도 따라온다', SEGMENTS.dir.desc === en['seg.dir'], SEGMENTS.dir.desc);
  check('시작 모션 곁말도 따라온다', 기본곁말(false) === en['intro.inside'], 기본곁말(false));
  check('바깥 곁말도', 기본곁말(true) === en['intro.outside'], 기본곁말(true));

  /*
   * 승인 방식이 제일 안 어긋나야 할 자리다 — 그게 안전 표시라서 그렇다.
   *
   * 처음에 펼치기(...)로 붙였다가 값이 그 자리에서 굳었다. 게터를 펼치면
   * 게터가 아니라 그때 읽은 글자가 복사되기 때문이다. 그러면 /lang 으로
   * 바꿔도 승인 표시만 옛 말로 남는다.
   */
  const { 승인, 표시 } = await import('../src/ui/approve.js');
  check('승인 방식 이름이 따라온다', 승인.auto.이름 === en['approve.auto.name'], 승인.auto.이름);
  check('승인 한 줄 설명도 따라온다', 승인.strict.한줄 === en['approve.strict.line'], 승인.strict.한줄);
  check('짧은 이름도 따라온다', 승인.confirm.짧은이름 === en['approve.confirm.short'], 승인.confirm.짧은이름);
  check('글자는 말과 무관하게 그대로', 승인.auto.글자 === '⏵⏵' && 승인.strict.글자 === '⏸');
  check('상태줄 표시에도 반영된다', 표시('auto').includes(en['approve.auto.name']), 표시('auto'));
  언어정하기('ko');
  check('한국어로 되돌리면 한국어', 승인.auto.이름 === ko['approve.auto.name'], 승인.auto.이름);
  언어정하기('en');

  // 수준 이름도.
  const { LEVELS } = await import('../src/ui/level.js');
  check('수준 이름이 따라온다', LEVELS['쉬움'].name === en['level.beginner.name'], LEVELS['쉬움'].name);
  check('수준 id 는 그대로 — 설정에 남는 값이라 바뀌면 안 된다', LEVELS['쉬움'].id === '쉬움');
}

trace('7-얼마나옮겼나');

// ── 얼마나 옮겼는지 숨기지 않는다 ───────────────────────────────────────
//
// 이 검사는 **실패하지 않는다.** 남은 것이 있는 게 잘못이 아니라, 남은 것을
// 안 세는 게 잘못이다. 숫자를 화면에 적어 두면 다음 사람이 어디를 도울지 안다.
{
  const p = 옮긴만큼('en');
  check('전체 마디 수를 안다', p.전체 === Object.keys(ko).length, String(p.전체));
  check('옮긴 것 + 남은 것 = 전체', p.옮김 + p.남음 === p.전체, `${p.옮김}+${p.남음}=${p.전체}`);
  check('한국어는 언제나 다 있다', 옮긴만큼('ko').남음 === 0, String(옮긴만큼('ko').남음));

  적어둘것.push(`영어: ${p.옮김}/${p.전체} 마디 (${Math.round((p.옮김 / p.전체) * 100)}%)`);
  if (p.남음) 적어둘것.push(`아직 한국어로 나오는 것 ${p.남음}개: ${p.안옮긴열쇠.slice(0, 8).join(', ')}${p.남음 > 8 ? ' …' : ''}`);
  else 적어둘것.push('영어로 다 옮겼습니다. 새 말을 넣을 때 en.js 도 같이 채워 주세요.');
}

trace('8-코드는안바뀐다');

// ── 코드는 안 바뀐다 ────────────────────────────────────────────────────
//
// 이 단계에서 바뀌는 것은 **글**뿐이다. 어느 도구를 주는지, 어느 모드가
// 파일을 바꿀 수 있는지 같은 판단은 말과 무관해야 한다. 여기가 흔들리면
// 영어로 켠 사람만 다른 프로그램을 쓰는 셈이 된다.
//
// (모델이 읽는 글 자체는 일부러 바뀐다 — prompt.test.js 가 그쪽을 잰다.)
{
  const { MODES, canWrite, allow } = await import('../src/agent/modes.js');
  const { toolSchemas } = await import('../src/tools/index.js');

  const 이름들 = (l) => {
    언어정하기(l);
    return toolSchemas(null, { work: 'code', ctx: 32768 }).map((t) => t.function.name).join(',');
  };
  check('주는 도구가 같다', 이름들('ko') === 이름들('en'), 이름들('en'));

  const 쓸수있나표 = (l) => {
    언어정하기(l);
    return Object.keys(MODES).map((k) => `${k}:${canWrite(k)}`).join(',');
  };
  check('파일을 바꿀 수 있는 모드가 같다', 쓸수있나표('ko') === 쓸수있나표('en'), 쓸수있나표('en'));

  const 허용 = (l) => { 언어정하기(l); return allow('plan', Object.keys(MODES)).join(','); };
  check('모드별 허용 목록이 같다', 허용('ko') === 허용('en'));

  언어정하기('en');
  check('모드 id 는 그대로 — 설정에 남는 값이다', MODES.code.id === 'code');
}


trace('조사');

// ── 조사가 값을 따라가는가 ──────────────────────────────────────────────
//
// 값이 그때그때 달라지는 자리에 조사를 글에 박아 두면 "기사 으로 바꿨습니다"
// 가 나온다. 안 터지고, 검사도 안 잡고, 화면에서만 어색해서 오래 남는다.
// 실제로 /motion 이 그 상태로 한 판 나갈 뻔했다.
{
  const 짝 = [
    // [값, 갈래, 바라는 조사]
    ['기사', '으로', '로'],      // 받침 없음
    ['기본', '으로', '으로'],    // 받침 ㄴ
    ['끔',   '으로', '으로'],    // 받침 ㅁ
    ['동물', '으로', '로'],      // 받침 ㄹ — 여기만 다르다
    ['사무실', '으로', '로'],    // 받침 ㄹ
    ['기사', '은는', '는'],
    ['기본', '은는', '은'],
    ['동물', '은는', '은'],      // 은는 은 ㄹ 을 안 봐준다
    ['값',   '이가', '이'],
    ['나무', '이가', '가'],
    ['밥',   '을를', '을'],
    ['나무', '을를', '를'],
    ['형',   '과와', '과'],
    ['누나', '과와', '와'],
  ];
  for (const [값, 갈래, 바라는것] of 짝) {
    check(`${값} + ${갈래} → ${바라는것}`, 조사붙이기(값, 갈래) === 바라는것, 조사붙이기(값, 갈래));
  }

  // 한글이 아닌 것으로 끝나면 받침 없는 쪽. 맞는 답이 없는 자리라 규칙을
  // 정해 두고 그대로 지키는 것이 낫다 — 어느 날은 이렇게, 어느 날은 저렇게가
  // 제일 나쁘다.
  check('영어로 끝나면 받침 없는 쪽', 조사붙이기('office', '은는') === '는');
  // 색을 입힌 값이 그대로 들어온다. 안 벗기면 마지막 글자가 늘 리셋의 'm' 이라
  // 무슨 값이 와도 답이 하나로 굳는다 — 상태줄 곁말이 실제로 그 값을 넘긴다.
  check('색을 벗기고 본다', 조사붙이기('[92m기본[0m', '으로') === '으로', 조사붙이기('[92m기본[0m', '으로'));
  check('색을 입혀도 받침 없는 쪽은 그대로', 조사붙이기('[92m기사[0m', '으로') === '로');
  check('빈 값도 안 터진다', 조사붙이기('', '은는') === '는');
  check('모르는 갈래는 아무것도 안 붙인다', 조사붙이기('기사', '없는갈래') === '');

  // 자리에 끼워 넣을 때 실제로 붙는가.
  언어정하기('ko');
  check('{것:으로} 가 값을 보고 고른다', 말('motion.set', { 것: '기사' }).startsWith('기사로'), 말('motion.set', { 것: '기사' }));
  check('받침이 있으면 으로', 말('motion.set', { 것: '기본' }).startsWith('기본으로'), 말('motion.set', { 것: '기본' }));

  // 따옴표가 사이에 끼는 자리 — 조사만 나와야 한다.
  const 모름 = 말('motion.unknown', { 값: '없는거' });
  check('{~값:은는} 은 조사만 낸다', 모름.startsWith('"없는거"는'), 모름);
  check('값을 두 번 안 찍는다', (모름.match(/없는거/g) ?? []).length === 1, 모름);

  // 영어 글에는 조사 표시가 없다. 그래도 값은 들어가야 한다.
  언어정하기('en');
  const en_set = 말('motion.set', { 것: 'knight' });
  check('영어에서는 조사 없이 값만', en_set.includes('knight') && !/[가-힣]/.test(en_set), en_set);
  언어정하기('ko');

  // 안 준 자리는 그대로 둔다 — 조사를 적어 뒀어도 그렇다.
  check('안 준 자리는 중괄호째 남는다', 말('motion.set', {}).includes('{것:으로}'), 말('motion.set', {}));
}

언어정하기(원래언어);
if (원래env !== undefined) process.env.DEEL_LANG = 원래env;

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n화면 말 검사  ${D}(반쯤 옮겨져도 화면이 안 망가지는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log('');
for (const l of 적어둘것) console.log(`  ${D}· ${l}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
