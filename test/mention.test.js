// @파일 지목 — 말 속에 @경로 를 쓰면 그 파일을 바로 붙여 보낸다.
//
// 왜 필요한가: 지금은 파일 하나 보여주려면 모델이 Read 도구를 스스로 불러야
// 한다. 로컬 모델은 도구 호출이 약해서 이 왕복이 자주 헛돈다. 사람이 이미
// 어느 파일인지 알고 있는데 모델더러 찾아보라고 시키는 셈이다.
//
// 여기서 제일 조심할 것은 '아닌 것을 파일로 오해하지 않기' 다.
// 이메일 주소, CSS 의 @media, 파이썬 장식자, 트위터 아이디 — 전부 @ 로 시작한다.
// 그래서 실제로 있는 경로일 때만 붙인다. 없으면 글자 그대로 둔다.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expand, findMentions } from '../src/agent/mention.js';
import { makeScope } from '../src/safety/guard.js';
import { trace } from './trace.mjs';
import { 내부살림 } from '../src/tools/fsutil.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-at-'));
const scope = makeScope(root);
mkdirSync(join(root, 'src'), { recursive: true });
mkdirSync(join(root, '자료 폴더'), { recursive: true });
writeFileSync(join(root, 'src', 'a.js'), 'const a = 1;\nexport default a;\n', 'utf8');
writeFileSync(join(root, 'src', 'b.js'), 'export const b = 2;\n', 'utf8');
writeFileSync(join(root, '한글 이름.txt'), '띄어쓰기가 든 이름\n', 'utf8');
writeFileSync(join(root, '자료 폴더', '표.csv'), 'ㄱ,ㄴ\n1,2\n', 'utf8');
writeFileSync(join(root, '큰것.txt'), 'x'.repeat(50000), 'utf8');
// CP949 파일 — 사내에 흔하다. UTF-8 로 읽으면 다 깨진다.
writeFileSync(join(root, 'cp949.txt'), Buffer.from([0xB0, 0xA1, 0xB3, 0xAA, 0x0A]));
// 그림 — 못 보는 모델에는 바이트를 아예 안 싣는다.
writeFileSync(join(root, '화면.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4]));

const 붙임 = (text, opts = {}) => expand(text, { scope, ...opts });

trace('1-찾기');

// ── 무엇을 지목으로 볼 것인가 ───────────────────────────────────────────
{
  check('맨 앞의 @ 를 찾는다', findMentions('@src/a.js 봐줘').length === 1, '');
  check('가운데 것도 찾는다', findMentions('이거 @src/a.js 어때').length === 1, '');
  check('여럿도 찾는다', findMentions('@src/a.js 와 @src/b.js').length === 2, '');
  check('이메일은 안 잡는다', findMentions('hong@example.com 로 보내줘').length === 0,
    JSON.stringify(findMentions('hong@example.com 로 보내줘')));
  check('@ 뒤가 비면 안 잡는다', findMentions('값이 @ 이다').length === 0, '');
  check('따옴표로 묶으면 통째로 잡는다', findMentions('@"한글 이름.txt" 읽어')[0]?.path === '한글 이름.txt',
    JSON.stringify(findMentions('@"한글 이름.txt" 읽어')));
  // ★ (6회차 붙임6af M1·M2) 감싼 지목. 닫는 백틱(경로 끝)·닫는 낫표(뒤에붙는것)는 알면서
  // 여는 쪽을 앞자리로 안 받아, 마크다운 버릇으로 쓴 `@경로` 가 조용히 안 붙었다.
  check('★ (6회차 붙임6af M1) 백틱으로 감싼 지목도 찾는다', findMentions('`@src/a.js` 봐줘')[0]?.path === 'src/a.js',
    JSON.stringify(findMentions('`@src/a.js` 봐줘')));
  check('★ (6회차 붙임6af M2) 낫표로 감싼 지목도 찾는다',
    findMentions('「@src/a.js」 와 『@src/b.js』').map((m) => m.path.replace(/[」』]+$/, '')).join(' ') === 'src/a.js src/b.js',
    JSON.stringify(findMentions('「@src/a.js」 와 『@src/b.js』')));
  check('(M1·M2 짝) 글자에 붙은 @ 는 여전히 안 잡는다', findMentions('값@src/a.js 와 a`b@c').length === 0,
    JSON.stringify(findMentions('값@src/a.js 와 a`b@c')));
}

trace('2-붙이기');

// ── 실제로 붙는가 ───────────────────────────────────────────────────────
{
  const r = 붙임('@src/a.js 이거 뭐 하는 거야?');
  check('파일 내용이 붙는다', r.text.includes('export default a;'), r.text.slice(0, 120));
  check('원래 하던 말은 남는다', r.text.includes('이거 뭐 하는 거야?'), r.text.slice(0, 120));
  check('무엇을 붙였는지 알려 준다', r.attached.length === 1, JSON.stringify(r.attached));
  check('붙인 경로를 보기 좋게 준다', /a\.js/.test(r.attached[0]?.show ?? ''), r.attached[0]?.show);
  check('줄 번호가 붙는다', /\b1\b.*const a = 1;/.test(r.text), r.text.slice(0, 200));
}

{
  const r = 붙임('@src/a.js 와 @src/b.js 를 비교해줘');
  check('두 개를 다 붙인다', r.attached.length === 2, JSON.stringify(r.attached.map((x) => x.show)));
  check('둘 다 내용이 들어간다', r.text.includes('export default a;') && r.text.includes('export const b = 2;'), '');
}

{
  const r = 붙임('@"한글 이름.txt" 이거');
  check('따옴표로 묶은 이름도 붙는다', r.text.includes('띄어쓰기가 든 이름'), r.text.slice(0, 150));
}

trace('3-아닌것');

// ── 파일이 아닌 @ 는 건드리지 않는다 ────────────────────────────────────
{
  const 원래 = 'hong@example.com 으로 보내고 @media 도 손봐줘';
  const r = 붙임(원래);
  check('이메일·@media 는 그냥 둔다', r.text === 원래, r.text);
  check('붙인 게 없다', r.attached.length === 0, '');
}

{
  const 원래 = '@없는파일.js 좀 봐줘';
  const r = 붙임(원래);
  check('없는 파일은 글자 그대로 둔다', r.text === 원래, r.text);
  check('없다고 조용히 적어 둔다', r.missing.length === 1, JSON.stringify(r.missing));
}

{
  // 작업 범위 밖은 절대 안 읽는다. @ 로 우회할 수 있으면 울타리가 없는 것과 같다.
  const r = 붙임('@../../../비밀.txt 읽어');
  check('작업 범위 밖은 안 붙인다', r.attached.length === 0, JSON.stringify(r.attached));
  check('막혔다고 남긴다', r.blocked.length === 1, JSON.stringify(r.blocked));
  check('막힌 것도 글자는 그대로', r.text.includes('@../../../비밀.txt'), r.text);
}

/*
 * ── 살림 파일은 @ 로도 못 붙인다 ────────────────────────────────────────
 *
 * mention.js 가 이 검사를 가리키고 있었는데 **검사가 없었다.** 주석은
 * `test/mention-secret.test.js` 를 가리켰고 그런 파일은 없다. 그러니까 이
 * 자리는 「지킨다고 적어 두고 아무도 안 재는」 상태였다 — 그게 제일 오래
 * 안 들키는 종류다.
 *
 * 무엇을 막나: Read 도구는 `.deel/config.json` 을 막고 있었는데 @ 는 안
 * 막고 있었다. 그래서 `@.deel/config.json` 한 줄이면 게이트웨이 열쇠가
 * 대화에 실려 그대로 바깥으로 나갔다. 도구는 막고 @ 는 안 막으면 막은 것이
 * 아니다.
 *
 * 울타리 밖(위 검사)과는 다른 축이다. 이건 **울타리 안에 있는데도 못 읽는**
 * 파일이라, 경로 검사로는 안 걸린다.
 */
{
  mkdirSync(join(root, '.deel'), { recursive: true });
  writeFileSync(join(root, '.deel', 'config.json'),
    '{"profiles":[{"key":"sk-비밀열쇠-절대-안-나가야-함"}]}', 'utf8');

  const r = 붙임('@.deel/config.json 좀 봐줘');
  check('★★ 살림 파일은 안 붙인다', r.attached.length === 0, JSON.stringify(r.attached));
  check('★★ 열쇠가 글에 안 실린다', !r.text.includes('sk-비밀열쇠'), r.text.slice(0, 80));
  check('막혔다고 남긴다', r.blocked.length === 1, JSON.stringify(r.blocked));
  // 막았다고 사람이 친 글자를 지우지는 않는다. 화면에서 무엇을 시켰는지는 남아야 한다.
  check('막힌 것도 글자는 그대로', r.text.includes('@.deel/config.json'), r.text.slice(0, 80));

  /*
   * ★★ 열쇠를 담는 파일이 config.json 하나가 아니다.
   *
   * mcp.json 은 붙여 둔 MCP 서버마다 env 를 통째로 적어 두는 자리라 토큰이
   * 그대로 들어 있다. 목록으로 막는 방식은 늘 이렇게 샌다 — 같은 종류의
   * 파일을 하나 늘려 놓고 목록에 안 올리면 그날부터 조용히 나간다.
   * (이 검사를 쓰면서 실제로 찾은 구멍이다.)
   */
  writeFileSync(join(root, '.deel', 'mcp.json'),
    '{"servers":{"깃허브":{"env":{"GITHUB_TOKEN":"ghp_비밀토큰"}}}}', 'utf8');
  const r2 = 붙임('@.deel/mcp.json 이거 봐줘');
  check('★★ MCP 설정도 안 붙인다', r2.attached.length === 0, JSON.stringify(r2.attached));
  check('★★ MCP 토큰이 글에 안 실린다', !r2.text.includes('ghp_비밀토큰'), r2.text.slice(0, 80));

  // 지난 대화 기록도 안 붙인다. 열쇠는 없지만 옛 대화가 통째로 들어온다.
  mkdirSync(join(root, '.deel', 'sessions'), { recursive: true });
  writeFileSync(join(root, '.deel', 'sessions', 'a1.jsonl'), '{"role":"user"}', 'utf8');
  const r3 = 붙임('@.deel/sessions/a1.jsonl');
  check('★ 지난 대화 기록도 안 붙인다', r3.attached.length === 0, JSON.stringify(r3.attached));
}

trace('4-폴더');

// ── 폴더를 지목하면 ─────────────────────────────────────────────────────
{
  const r = 붙임('@src 안에 뭐가 있어?');
  check('폴더는 목록을 붙인다', r.text.includes('a.js') && r.text.includes('b.js'), r.text.slice(0, 200));
  check('폴더라고 밝힌다', /폴더/.test(r.text), r.text.slice(0, 200));
  check('폴더도 붙인 것으로 센다', r.attached.length === 1, '');
}

trace('5-상한');

// ── 너무 크면 ───────────────────────────────────────────────────────────
{
  const r = 붙임('@큰것.txt 요약해줘', { budget: 400 });
  check('상한을 넘으면 앞부분만 붙인다', r.text.length < 20000, String(r.text.length));
  check('잘랐다고 말해 준다', /잘랐|일부만|중 /.test(r.text), r.text.slice(-200));
  check('잘린 것은 다 읽은 것으로 안 친다', r.attached[0]?.full === false, JSON.stringify(r.attached[0]));
}

{
  const r = 붙임('@src/a.js 짧은 것', { budget: 4000 });
  check('작은 파일은 통째로 붙는다', r.attached[0]?.full === true, JSON.stringify(r.attached[0]));
}

{
  // 여러 개를 붙여도 전체 상한을 넘지 않아야 한다. 컨텍스트를 통째로 먹으면
  // 정작 하려던 일을 못 한다.
  const r = 붙임('@큰것.txt @src/a.js @src/b.js', { budget: 500 });
  const 넘음 = r.text.length > 40000;
  check('여러 개를 붙여도 전체 상한을 지킨다', !넘음, String(r.text.length));
}

trace('6-인코딩');

// ── CP949 ───────────────────────────────────────────────────────────────
{
  const r = 붙임('@cp949.txt 뭐라고 적혀 있어?');
  check('CP949 파일도 제대로 읽는다', r.text.includes('가나'), JSON.stringify(r.text.slice(0, 120)));
  check('깨진 글자가 안 섞인다', !r.text.includes('�'), '');
}

trace('7-읽은것으로치기');

// ── 통째로 붙었으면 '읽은 파일' 로 친다 ─────────────────────────────────
{
  const seen = new Set();
  const r = 붙임('@src/a.js 고쳐줘', { seen });
  check('통째로 붙으면 읽은 것으로 친다', seen.size === 1, String(seen.size));
  check('그 파일이 맞다', [...seen][0].endsWith('a.js'), [...seen][0]);
  check('붙인 개수와도 맞는다', r.attached.length === 1, '');
}

{
  // 잘렸으면 읽은 것으로 치면 안 된다 — 안 본 데를 고치게 된다.
  const seen = new Set();
  붙임('@큰것.txt 고쳐줘', { budget: 300, seen });
  check('잘렸으면 읽은 것으로 안 친다', seen.size === 0, String(seen.size));
}

trace('7.5-못붙인것');

/*
 * ── 안 붙은 것을 「이미 읽은 것으로 치고」 라고 하지 않는다 (2.0.0 8회차 스키마) ──
 *
 * 그림을 못 보는 모델에는 바이트를 아예 안 싣는다. 그런데 그 파일도 attached 에 세어져
 * 머리말이 「지목한 파일입니다. 이미 읽은 것으로 치고 답하세요」 로 붙었다. 모델에게는
 * 「이 파일은 이미 봤다」 는 말이라, Read 도 안 하고 안 본 파일의 내용을 지어낸다.
 */
{
  const r = 붙임('@화면.png 이거 뭐야?');
  check('그림을 못 보는 모델에는 그림을 안 싣는다', r.그림들.length === 0 && /못 봅니다/.test(r.text), r.text.slice(-160));
  check('★★ (8회차) 못 붙인 파일을 「이미 읽은 것으로 치고」 라고 안 한다',
    !/이미 읽은 것으로 치고/.test(r.text), r.text.split('\n').filter((l) => /지목한 파일/.test(l))[0] ?? '');
  check('  대신 지어내지 말라고 말한다', /지어내지/.test(r.text), r.text.split('\n').filter((l) => /지목한 파일/.test(l))[0] ?? '');
  const r2 = 붙임('@화면.png 랑 @src/a.js 봐줘');
  check('★ (8회차) 섞여 있으면 진짜 붙은 것만 센다',
    /지목한 파일입니다\. 이미 읽은 것으로 치고/.test(r2.text) && !/파일 2개입니다/.test(r2.text),
    r2.text.split('\n').filter((l) => /지목한 파일/.test(l))[0] ?? '');
  const r3 = 붙임('@src/a.js 랑 @src/b.js 봐줘');
  check('짝: 둘 다 붙었으면 그대로 2개라고 센다', /파일 2개입니다\. 이미 읽은 것으로 치고/.test(r3.text),
    r3.text.split('\n').filter((l) => /지목한 파일/.test(l))[0] ?? '');
  check('짝: 못 붙였어도 화면에는 그대로 알린다', r.attached.length === 1, JSON.stringify(r.attached));
}

trace('8-이상한것');

// ── 이상한 값 ───────────────────────────────────────────────────────────
{
  check('빈 글이어도 안 죽는다', 붙임('').text === '', '');
  check('@ 하나만 있어도 안 죽는다', 붙임('@').text === '@', '');
  check('@@ 도 안 죽는다', typeof 붙임('@@src/a.js').text === 'string', '');
  check('없는 값이어도 안 죽는다', typeof expand(null, { scope }).text === 'string', '');
  check('scope 가 없어도 안 죽는다', typeof expand('@src/a.js', {}).text === 'string', '');
}

{
  // 문장부호가 붙어 와도 파일을 찾아야 한다.
  const r = 붙임('@src/a.js, 이거랑 @src/b.js. 둘 다');
  check('뒤에 붙은 쉼표·마침표를 떼고 찾는다', r.attached.length === 2, JSON.stringify(r.attached.map((x) => x.show)));
  check('문장부호는 글에 남는다', r.text.includes(',') && r.text.includes('.'), '');
}

trace('9-치움');
rmSync(root, { recursive: true, force: true });

/*
 * ── 살림 자리는 옮길 수 있다 ────────────────────────────────────────────
 *
 * `DEEL_HOME` 이 정식 설정이다(config.js) — 사내 휴대용 설치와 검사가 쓴다.
 * 그런데 막는 자(내부살림)가 `.deel` 이라는 **글자**로 찾고 있었다. 이름에
 * 그 글자가 없는 자리로 옮기면 막이 통째로 풀리고, 그 순간 `config.json`
 * (게이트웨이 열쇠가 든 파일)이 그냥 읽힌다.
 */
{
  const 옛집 = process.env.DEEL_HOME;
  const 딴집 = join(tmpdir(), 'deel-딴이름-살림');
  process.env.DEEL_HOME = 딴집;
  try {
    check('★★ 옮긴 살림의 설정 파일도 막는다',
      !!내부살림(join(딴집, 'config.json')), String(내부살림(join(딴집, 'config.json'))).slice(0, 40));
    check('★★ 옮긴 살림의 MCP 설정도 막는다',
      !!내부살림(join(딴집, 'mcp.json')), String(내부살림(join(딴집, 'mcp.json'))).slice(0, 40));
    check('★ 기본 이름(.deel)도 그대로 막는다',
      !!내부살림(join('C:', 'Users', 'x', '.deel', 'config.json').replace(/\\/g, '/')));
    check('★ 남의 config.json 은 안 막는다 — 막는 것이 아니라 살림을 막는 것',
      내부살림(join(딴집, '..', '프로젝트', 'config.json')) === null,
      String(내부살림(join(딴집, '..', '프로젝트', 'config.json'))));
  } finally {
    if (옛집 == null) delete process.env.DEEL_HOME; else process.env.DEEL_HOME = 옛집;
  }
}

trace('10-대소문자');

/*
 * ★★★ 대소문자만 바꾸면 그대로 열렸다.
 *
 * ── 왜 통과했나 ─────────────────────────────────────────────────────────
 *
 * 막는 자가 `조각.lastIndexOf('.deel')` 로 찾았다 — **정확히 소문자**일
 * 때만 맞는다. 그런데 이 프로그램이 주로 도는 윈도우(NTFS)와 맥(APFS 기본)
 * 은 파일 이름의 대소문자를 **안 가린다.** 이름은 안 맞는데 파일은 열린다.
 *
 *     .deel/config.json   막힘
 *     .DEEL/config.json   통과 ← 같은 파일이 열린다
 *
 * 그 파일에 게이트웨이 열쇠가 들어 있다. 열쇠는 대화에 실려 게이트웨이로
 * 나가고 세션 기록으로 디스크에도 남는다 — 「나가는 문은 하나」 라는 약속이
 * 그 문으로 열쇠를 내보내는 꼴이 된다. 커밋 쪽은 이미 막고 있었는데
 * (test/commit.test.js 3⅞+절) **읽는 쪽만** 안 막고 있었다.
 *
 * 리눅스에서 `.DEEL` 은 진짜 다른 폴더다. 그래도 막는다 — 그 이름을 쓰는
 * 사람은 사실상 없고, 안 막아서 잃는 것과 견줄 수가 없다.
 */
{
  const 윗집 = join('C:', 'Users', 'x').replace(/\\/g, '/');
  const 살림 = (p) => 내부살림(`${윗집}/${p}`);

  for (const p of [
    '.DEEL/config.json',
    '.Deel/config.json',
    '.deel/CONFIG.JSON',
    '.DEEL/mcp.json',
    '.DEEL/history/1.json',
  ]) {
    check(`★★★ ${p} 도 막는다`, !!살림(p), '대소문자만 바꿨더니 통과함');
  }

  // 남의 도구 살림도 같은 까닭으로 같이 막는다.
  check('★★ .CLAUDE/history.jsonl 도 막는다', !!살림('.CLAUDE/history.jsonl'), '통과해 버림');
  check('★★ .Codex/history.jsonl 도 막는다', !!살림('.Codex/history.jsonl'), '통과해 버림');

  // 넓히다 반대로 베면 안 된다.
  check('★ deelignore 같은 이름은 안 막는다', 살림('.deelignore') === null, String(살림('.deelignore')).slice(0, 40));
  check('★ 남의 config.json 은 그대로 통과한다', 살림('프로젝트/config.json') === null, String(살림('프로젝트/config.json')).slice(0, 40));
}


trace('11-이름만같은남의파일');

/*
 * ── 「이름만 audit.jsonl」 은 **남의 파일**이다 ──────────────────────
 *
 * 막는 자의 마지막 줄이 자리를 안 보고 이름만 봤다 — `이름 === 'audit.jsonl'`.
 * 그래서 프로젝트가 제 감사 기록을 그 이름으로 쓰면 제 파일을 못 읽었다:
 *
 *     Read src/audit.jsonl   「deel 자신의 기록입니다」
 *
 * 거짓 경고도 결함이다. 모델은 그 파일이 없는 것으로 치고 일하거나, 없는
 * 권한 문제를 찾아 헤맨다. deel 이 이 이름을 쓰는 자리는 제 살림 폴더 안
 * 하나뿐이고(safety/audit.js · stats.js), 그 자리는 위 `.deel`·집 폴더
 * 갈래가 이미 잡는다.
 *
 * **넓히다 살림이 새면 훨씬 큰 사고다.** 그래서 같은 절에서 진짜 살림이
 * 여전히 막히는지를 함께 못 박는다.
 */
{
  // 안 막아야 할 것 — 프로젝트 제 파일.
  check('★★ 프로젝트 제 파일 src/audit.jsonl 은 안 막는다',
    내부살림('C:/work/proj/src/audit.jsonl') === null, String(내부살림('C:/work/proj/src/audit.jsonl')).slice(0, 40));
  check('★ 로그 폴더에 둔 audit.jsonl 도 안 막는다',
    내부살림('/home/u/proj/logs/audit.jsonl') === null, String(내부살림('/home/u/proj/logs/audit.jsonl')).slice(0, 40));
  /*
   * 자리를 「점으로 시작하나」 로만 보던 때, 프로젝트의 숨은 폴더가 통째로 살림이 됐다.
   * `.github/` · `.ci/` · `.circleci/` 는 프로젝트 제 폴더다 — 거기 둔 제 기록을 못 읽었다.
   */
  for (const 곳 of ['.github', '.ci', '.circleci']) {
    const 길 = `C:/work/proj/${곳}/audit.jsonl`;
    check(`★★ 숨은 프로젝트 폴더(${곳})의 audit.jsonl 도 안 막는다`,
      내부살림(길) === null, String(내부살림(길)).slice(0, 40));
  }

  // 여전히 막아야 할 것 — 진짜 살림.
  check('★★ .deel/audit.jsonl 은 여전히 막는다', !!내부살림('C:/Users/x/.deel/audit.jsonl'));
  check('★★ .DEEL/audit.jsonl 도 여전히 막는다', !!내부살림('C:/Users/x/.DEEL/audit.jsonl'));
  check('★ .deel/sessions/1.jsonl 도 여전히 막는다', !!내부살림('C:/Users/x/.deel/sessions/1.jsonl'));
  check('★★ .deel/config.json 은 여전히 막는다', !!내부살림('C:/Users/x/.deel/config.json'));

  const 옇집 = process.env.DEEL_HOME;
  const 딴집 = join(tmpdir(), 'deel-옴긴살림');
  process.env.DEEL_HOME = 딴집;
  try {
    check('★★ 옮긴 살림(DEEL_HOME)의 audit.jsonl 도 여전히 막는다',
      !!내부살림(join(딴집, 'audit.jsonl')), String(내부살림(join(딴집, 'audit.jsonl'))).slice(0, 40));
  } finally {
    if (옇집 == null) delete process.env.DEEL_HOME; else process.env.DEEL_HOME = 옇집;
  }
}


const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n@파일 지목  ${D}(아닌 것을 파일로 오해하지 않는 게 절반이다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
