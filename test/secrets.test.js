// 열쇠가 모델에게, 그리고 디스크에 남는 대화 기록에 끼어드는가.
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// 사람이 열쇠를 붙여 넣는 일은 드뭅니다. 새는 자리는 거의 항상 명령 출력이다 —
// `env` · `git remote -v` · `curl -v` · 검사 실패 로그. 그 글은 모델에게 실려
// 가고, 동시에 `.deel/sessions/*.jsonl` 로 디스크에 적힌다. 그 파일은 나중에
// `/recall` 로 다시 읽히고 `deel pack` 에 딸려 갈 수도 있다. **한 번 새면
// 여러 벌이 된다.**
//
// 그런데 여기서 제일 조심할 것은 새는 것이 아니라 **고치는 것**이다.
// `.env` 를 읽었을 때 가려 버리면, 모델이 가려진 글을 보고 그걸 되돌려 쓴다.
// 그러면 진짜 열쇠가 있던 자리에 표가 적힌다 — 비밀을 지키려다 사람의 열쇠를
// 우리 손으로 지우는 셈이다. 그래서 파일 내용은 **안 가린다.**
//
// 이 검사는 그 둘을 갈라 놓는다.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 가리기, 훑기, 가렸다는말, 봤다는말, 아는열쇠, 가릴도구, 표몇군데, 가릴까 } from '../src/safety/secrets.js';
import { runTool } from '../src/tools/index.js';
import { makeScope } from '../src/safety/guard.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { allowEndpoint } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-새는자리');

// ── 실제로 새는 모양들 ──────────────────────────────────────────────────
//
// 지어낸 예가 아니라 명령이 실제로 찍는 모양 그대로다.
{
  const 것들 = [
    ['env 가 찍은 열쇠', 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz012345'],
    ['git remote -v', 'origin\thttps://jysvai:ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345@github.com/x/y.git (fetch)'],
    ['curl -v 헤더', '> Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop'],
    ['AWS 열쇠', 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE'],
    ['슬랙 토큰', 'SLACK=xoxb-1234567890-abcdefghijkl'],
    // 구글 열쇠는 AIza 뒤 35자로 길이가 정해져 있다. 길이를 안 맞춘 가짜로
    // 재면 검사만 통과하고 진짜는 못 잡는 규칙이 남는다.
    ['구글 열쇠', 'GOOGLE=AIzaSyD_abcdefghijklmnopqrstuvwxyz12345'],
    ['사설키 덩어리', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow…\n-----END RSA PRIVATE KEY-----'],
    ['앤트로픽 열쇠', 'ANTHROPIC=sk-ant-api03-abcdefghijklmnopqrstuvwxyz'],
    ['이름이 말해 주는 것', 'DB_PASSWORD=한글암호여도가린다'],
  ];
  for (const [무엇, 글] of 것들) {
    const r = 가리기(글);
    check(`${무엇} 을 가린다`, r.가린것.length > 0 && !r.글.includes(원래값(글)),
      r.글.slice(0, 90));
  }
}

function 원래값(줄) {
  // 마지막 토막이 대개 값이다. 검사가 '진짜 값이 안 남았는지' 를 보려고 쓴다.
  const m = 줄.match(/[:=]\s*["']?([^\s"']{12,})/);
  return m ? m[1] : '(이 줄에는 값이 없습니다)';
}

trace('2-멀쩡한글');

// ── 멀쩡한 글은 안 건드린다 ─────────────────────────────────────────────
//
// 여기가 더 중요하다. 넓게 잡아 코드에 흔한 글자를 비밀로 오인하면, 모델이
// 보는 코드가 조용히 달라진다. 그건 막으려던 것보다 나쁜 고장이다.
{
  const 멀쩡한것 = [
    'PATH=/usr/bin:/bin:/usr/local/bin',
    'const 몫 = 계산(a, b);   // sk- 는 그냥 글자',
    'npm ERR! code ELIFECYCLE',
    // 검사 결과처럼 생긴 줄은 여기 쓰지 않는다. test/run.mjs 가 자식의 출력에서
    // 통과·실패 수를 정규식으로 긁어 가는데, 그 모양을 흉내 내면 **이 파일의
    // 검사 개수가 그 숫자로 바뀐다.** 실제로 한 번 771개로 찍혔다.
    '커버리지 87.4% · 줄 1,204개',
    'https://github.com/jysvai/deel-local-cli.git',
    'KEY_LENGTH = 32',
    'import { 가리기 } from "../src/safety/secrets.js";',
    '  ✓ 모르는 도구는 other — 낱말을 지어내지 않는다',
  ];
  for (const 글 of 멀쩡한것) {
    const r = 가리기(글);
    check(`안 건드린다: ${글.slice(0, 40)}`, r.글 === 글 && r.가린것.length === 0, r.글.slice(0, 80));
  }
}

trace('3-아는열쇠');

// ── 아는 값은 짐작보다 먼저 ─────────────────────────────────────────────
//
// 설정에 든 게이트웨이 열쇠는 짐작이 아니라 **아는 값**이다. 모양이 어떻든
// 그 글자가 나오면 지운다.
{
  const 열쇠 = 'aBcD-사내게이트웨이-열쇠-9876543210';
  const 글 = `curl -H "X-Custom: ${열쇠}" https://gw.example.test/v1`;
  const r = 가리기(글, { 열쇠들: [열쇠] });
  check('설정한 열쇠는 모양과 상관없이 지운다', !r.글.includes(열쇠), r.글);
  check('무엇을 지웠는지 종류로 남긴다', r.가린것.some((x) => x.종류 === '설정한열쇠'), JSON.stringify(r.가린것));

  // 짧은 것은 안 쓴다. 세 글자짜리를 그대로 찾아 지우면 멀쩡한 글이 뭉개진다.
  check('짧은 열쇠는 안 쓴다', 아는열쇠(['abc', 'x', '충분히긴열쇠입니다']).length === 1,
    JSON.stringify(아는열쇠(['abc', 'x', '충분히긴열쇠입니다'])));
  check('긴 것부터 지운다 — 짧은 것이 긴 것의 일부일 때', (() => {
    const 순서 = 아는열쇠(['짧은열쇠12345', '짧은열쇠12345678901234']);
    return 순서[0].length > 순서[1].length;
  })());
  const 없을때 = 가리기('아무 비밀 없는 줄', { 열쇠들: [null, undefined, ''] });
  check('열쇠가 없어도 안 죽는다', 없을때.글 === '아무 비밀 없는 줄');
}

trace('4-몇군데인지');

// ── 몇 군데를 가렸는지 정확히 센다 ──────────────────────────────────────
//
// 규칙끼리 겹친다 — `Authorization: Bearer eyJ…` 는 jwt 가 먼저 가리고
// 헤더가 그 위를 다시 가린다. 바꾼 횟수로 세면 "2군데" 가 되는데 글에는 표가
// 하나뿐이다. 사람이 세어 보면 안 맞는 숫자를 내놓게 된다.
{
  const r = 가리기('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop');
  const 표수 = (r.글.match(/«가림:/g) ?? []).length;
  const 센것 = r.가린것.reduce((a, x) => a + x.몇번, 0);
  check('센 숫자가 글에 남은 표 개수와 같다', 표수 === 센것, `표 ${표수}개 · 셈 ${센것}`);

  const 둘 = 가리기('A=sk-aaaaaaaaaaaaaaaaaaaaaaaa\nB=sk-bbbbbbbbbbbbbbbbbbbbbbbb');
  check('두 군데면 두 군데라고 한다', 둘.가린것.reduce((a, x) => a + x.몇번, 0) === 2,
    JSON.stringify(둘.가린것));
}

trace('4.5-헤더규칙자체');

/*
 * ── ★ 겹치는 규칙은 겹치지 않는 예로 따로 재야 한다 ─────────────────────
 *
 * 바로 위 검사와 1절의 `curl -v 헤더` 는 값이 둘 다 **JWT** 다. 그래서 헤더
 * 규칙이 통째로 죽어 있어도 jwt 규칙이 대신 가려 버린다 — 실제로 헤더 규칙의
 * 정규식을 아무것도 안 맞게 바꿔 봤는데 71건이 전부 초록이었다.
 * 「가리는 규칙이 있다」와 「그 규칙이 실제로 가린다」는 다른 말이다.
 *
 * 그런데 사내 게이트웨이가 주는 Bearer 값은 대개 JWT 가 아니라 그냥 불투명한
 * 문자열이다. 헤더 규칙이 유일한 그물인 자리가 바로 거기다. 그 값으로 잰다.
 */
{
  const 것들 = [
    ['불투명 Bearer', 'Authorization: Bearer A1b2C3d4E5f6G7h8I9j0K1l2M3n4', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'],
    ['Basic 인증', 'Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA=='],
    ['프록시 헤더', 'Proxy-Authorization: Bearer 사내게이트웨이토큰1234', '사내게이트웨이토큰1234'],
    ['X-Api-Key', 'X-Api-Key: 0123456789abcdef0123', '0123456789abcdef0123'],
    ['등호로 적힌 것', 'X-Auth-Token=zzzz-yyyy-xxxx-wwww', 'zzzz-yyyy-xxxx-wwww'],
  ];
  for (const [무엇, 글, 값] of 것들) {
    const r = 가리기(글);
    check(`★ ${무엇} — 값이 안 남는다`, !r.글.includes(값), r.글);
    check(`  ${무엇} — 헤더 규칙이 잡았다고 적는다`, r.가린것.some((x) => x.종류 === '헤더'),
      JSON.stringify(r.가린것));
  }

  // 헤더 이름은 남긴다 — 무슨 헤더가 새고 있었는지 모르면 사람이 손을 못 쓴다.
  check('헤더 이름은 그대로 둔다',
    가리기('Authorization: Bearer A1b2C3d4E5f6G7h8I9j0K1l2').글.startsWith('Authorization: '));

  // 값이 줄 끝까지 가려져야 한다. `Bearer` 만 가리고 뒤를 남기면 안 가린 것만 못하다.
  check('낱말 하나만 가리고 값을 남기지 않는다',
    !/Bearer\s+\S/.test(가리기('Authorization: Bearer A1b2C3d4E5f6G7h8I9j0K1l2').글));

  // 다음 줄까지 먹으면 멀쩡한 출력이 통째로 사라진다.
  const 두줄 = 가리기('Authorization: Bearer A1b2C3d4E5f6G7h8I9j0K1l2\n다음 줄은 멀쩡합니다');
  check('다음 줄까지 먹지 않는다', 두줄.글.includes('다음 줄은 멀쩡합니다'), 두줄.글);
}

trace('5-모델에게하는말');

// ── 표만 남기고 말을 안 하면 모델이 헛돈다 ──────────────────────────────
//
// 「«가림:openai»」 를 진짜 값으로 알고 명령에 다시 써 넣는다. 그러면 명령이
// 실패하고, 왜 실패했는지 모른 채 같은 것을 되풀이한다. 걸음 수만 태운다.
{
  const 말 = 가렸다는말([{ 종류: 'openai', 몇번: 2 }]);
  check('몇 군데인지 말한다', /2군데/.test(말), 말);
  check('진짜 값이 아니라고 말한다', /진짜 값이 아/.test(말), 말);
  check('그대로 쓰지 말라고 말한다', /써 넣지 마|물어보/.test(말), 말);
  check('가린 게 없으면 아무 말도 안 붙인다', 가렸다는말([]) === '' && 가렸다는말(null) === '');
}

trace('6-파일은안가린다');

// ── 파일 내용은 안 가린다. 대신 알린다 ──────────────────────────────────
//
// 이 프로젝트에서 제일 조심스러운 결정이다. `.env` 를 가리면 모델이 가려진
// 글을 보고 되돌려 써서 **사람의 열쇠가 우리 손에 지워진다.** 비밀을 지키려다
// 비밀을 파괴하는 셈이다.
{
  check('명령 출력은 가리는 쪽', 가릴도구.has('Bash') && 가릴도구.has('WebFetch'));
  check('파일을 읽는 도구는 안 가리는 쪽', !가릴도구.has('Read') && !가릴도구.has('Grep')
    && !가릴도구.has('Edit') && !가릴도구.has('Write'),
    [...가릴도구].join(' '));

  // 훑기는 세기만 하고 글은 안 돌려준다.
  const 본것 = 훑기('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz012345');
  check('안 고치고도 무엇이 있는지 안다', 본것.length > 0, JSON.stringify(본것));
  check('사람에게 할 말이 나온다', /비밀로 보이는 값/.test(봤다는말(본것)), 봤다는말(본것));
  check('없으면 아무 말도 안 한다', 봤다는말([]) === '');

  // 세는 길이 두 벌이면 "가릴 때는 3군데, 셀 때는 5군데" 가 된다.
  const 글 = 'A=sk-aaaaaaaaaaaaaaaaaaaaaaaa\nAuthorization: Bearer eyJaaaaaaaa.bbbbbbbbbb.cccccccccc';
  check('훑은 숫자와 가린 숫자가 같다',
    JSON.stringify(훑기(글)) === JSON.stringify(가리기(글).가린것),
    `${JSON.stringify(훑기(글))} / ${JSON.stringify(가리기(글).가린것)}`);
}

trace('6-2-가린표가-파일로-되돌아가나');

/*
 * ── 가린 표가 파일에 적히면 진짜 열쇠가 없어진다 ────────────────────────
 *
 * 위 6절이 "파일은 안 가린다" 고 정한 까닭 그대로의 사고가, 파일을 안 가려도
 * 일어날 수 있다.
 *
 *   1. 모델이 `cat .env` 를 부른다      → Bash 라서 우리가 가린다
 *   2. 모델은 «가림:환경변수» 를 진짜 값으로 알고
 *   3. Write 로 `.env` 를 다시 쓴다     → 진짜 열쇠 자리에 표가 적힌다
 *
 * 가렸다는말() 이 "이건 진짜 값이 아닙니다" 라고 일러 주지만 그건 **부탁이지
 * 자물쇠가 아니다.** 못 알아들은 모델 하나면 사람의 열쇠가 없어지고, 파일은
 * 멀쩡해 보여서 사람은 무엇이 없어졌는지조차 모른다.
 *
 * 그래서 진짜 파일을 놓고, 진짜 도구를 불러서, 열쇠가 살아 있는지를 본다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-secret-'));
  const ctx = () => ({
    scope: makeScope(방),
    history: { snapshot() {} },
    audit: { write() {}, tool() {} },
    seen: new Set([join(방, '.env')]),
    enc: new Map(),
    모델컨텍스트: 32768,
  });
  const 진짜 = 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz012345';
  const 파일 = join(방, '.env');

  // 모델이 본 것 — 명령 출력이라 우리가 가린 글.
  const 모델이본것 = 가리기(진짜).글;
  check('명령 출력에서는 열쇠가 가려진다', !모델이본것.includes('sk-proj-'), 모델이본것);

  for (const [이름, 부르기] of [
    ['Write', () => runTool('Write', { file_path: '.env', content: 모델이본것 }, ctx())],
    ['Append', () => runTool('Append', { file_path: '.env', content: `\n${모델이본것}\n` }, ctx())],
    ['Edit', () => runTool('Edit', {
      file_path: '.env', old_string: 진짜, new_string: 모델이본것,
    }, ctx())],
  ]) {
    writeFileSync(파일, 진짜, 'utf8');
    const r = await 부르기();
    check(`★ ${이름} 은 가린 표를 파일에 못 쓴다`, !!r.error, JSON.stringify(r.error ?? r.content ?? '').slice(0, 90));
    check(`★ ${이름} 뒤에도 진짜 열쇠가 살아 있다`,
      readFileSync(파일, 'utf8').includes('sk-proj-abcdefghijklmnopqrstuvwxyz012345'),
      JSON.stringify(readFileSync(파일, 'utf8')).slice(0, 90));
    // "안 됩니다" 만 하면 모델은 표를 지우고 빈 값으로 써서 결국 열쇠를 없앤다.
    check(`${이름} 은 어떻게 하라는지도 말한다`, /사용자에게 물어보|Edit/.test(String(r.error ?? '')),
      String(r.error ?? '').split('\n').at(-1)?.trim().slice(0, 70));
  }

  /*
   * 막는 것이 여기서 그쳐야 한다. 표가 없는 글까지 막으면 파일을 아예 못 쓴다 —
   * 지키려던 것보다 훨씬 큰 고장이다.
   */
  writeFileSync(파일, 진짜, 'utf8');
  const 멀쩡 = await runTool('Write', { file_path: '.env', content: 'OPENAI_API_KEY=sk-proj-새로받은열쇠입니다0123456789' }, ctx());
  check('표가 없으면 그냥 써진다', !멀쩡.error, JSON.stringify(멀쩡.error ?? '').slice(0, 80));
  check('쓴 것이 그대로 들어갔다', readFileSync(파일, 'utf8').includes('새로받은열쇠입니다'));

  // 「가림」 이라는 낱말이 글에 들어 있는 것만으로는 안 막는다. 표 모양이어야 한다.
  const 낱말 = await runTool('Write', { file_path: '메모.txt', content: '이 값은 가림 처리했습니다' }, ctx());
  check('「가림」 이라는 낱말만으로는 안 막는다', !낱말.error, JSON.stringify(낱말.error ?? '').slice(0, 80));

  /*
   * 찾는 말(old_string)에 표가 있는 것은 막을 일이 아니다.
   *
   * 모델이 가려진 줄을 그대로 **찾을 말**로 쓴 것뿐이고, 그러면 파일에서 못
   * 찾고 끝난다 — 파일은 한 글자도 안 바뀐다. 여기까지 막으면 "쓰려는 내용에
   * 표가 있습니다" 라는 **틀린 까닭**을 대게 되고, 모델은 안 쓴 것을 썼다고
   * 알아듣는다. 진짜 까닭(못 찾음)을 그대로 말해야 다음 수가 나온다.
   */
  writeFileSync(파일, 진짜, 'utf8');
  const 찾는말에표 = await runTool('Edit', {
    file_path: '.env', old_string: 모델이본것, new_string: 'OPENAI_API_KEY=새값',
  }, ctx());
  check('찾는 말에 든 표는 이 자물쇠가 안 막는다',
    !/쓰려는 내용에/.test(String(찾는말에표.error ?? '')), String(찾는말에표.error ?? '').split('\n')[0].slice(0, 60));
  check('대신 못 찾았다고 한다', /찾지 못했습니다/.test(String(찾는말에표.error ?? '')),
    String(찾는말에표.error ?? '').split('\n')[0].slice(0, 60));

  check('몇 군데인지 센다', 표몇군데(`a «가림:openai» b «가림» c`) === 2, String(표몇군데(`a «가림:openai» b «가림» c`)));
  check('표가 없으면 0', 표몇군데('그냥 글') === 0);

  rmSync(방, { recursive: true, force: true });
}

trace('6-3-바깥으로-나갈-때는-파일도-가린다');

/*
 * ── 저울이 뒤집히는 자리 ────────────────────────────────────────────────
 *
 * 6절이 「파일 내용은 안 가린다」 로 정한 것은 **로컬 모델만 쓰던 때의 저울**
 * 이다. 가려서 잃는 것(사람의 열쇠가 지워짐)이, 얻는 것(어차피 이 컴퓨터 밖으로
 * 안 나가는 글을 가림)보다 컸다.
 *
 * 바깥으로 나가면 얻는 쪽이 훨씬 무거워진다 — Read 한 번이면 `.env` 가 통째로
 * 남의 서버 로그에 남고, 그건 되돌릴 수가 없다. 그리고 잃는 쪽은 이제 6-2절의
 * 자물쇠가 막는다. 그 자물쇠가 먼저 생겼기 때문에 여기서 가릴 수 있게 됐다.
 *
 * ── 어떻게 끝까지 돌려 보나 ────────────────────────────────────────────
 *
 * 「바깥으로 나가는 연결」을 진짜로 붙어서 만들 수는 없다. 이 도구가 「이 안」
 * 으로 치는 범위가 곧 사설 대역 전부라(127.x · 10.x · 192.168.x · 172.16~31.x),
 * 검사가 닿을 수 있는 주소는 전부 「이 안」 이다. 진짜 바깥 주소로 붙는 검사는
 * 이 저장소가 절대 안 만든다.
 *
 * 그래서 **주소는 바깥 것을 쓰되 나가지는 않는다** — fetch 를 검사 안에서
 * 갈아 끼워 가짜 게이트웨이가 답하게 한다. 한 바이트도 밖으로 안 나가면서
 * 루프는 자기가 바깥에 붙은 줄 안다. 여태 이 자리를 loop.js 소스를 정규식으로
 * 훑어서 때웠는데, 글자를 재면 변수 이름 하나만 바꿔도 빨개지고 정작 판단이
 * 뒤집혀도 글자가 그대로면 초록이다.
 */
{
  // 이 안 — 여태 하던 그대로다. 명령 출력만 가리고 파일은 안 가린다.
  check('이 안: 명령 출력은 가린다', 가릴까('Bash', { 바깥: false }) === true);
  check('★ 이 안: 파일은 안 가린다', 가릴까('Read', { 바깥: false }) === false);
  check('이 안: Grep 도 안 가린다', 가릴까('Grep', { 바깥: false }) === false);

  // 바깥 — 파일에서 읽어 온 글도 가린다.
  check('★ 바깥: 파일도 가린다', 가릴까('Read', { 바깥: true }) === true);
  check('바깥: 명령 출력은 당연히 가린다', 가릴까('Bash', { 바깥: true }) === true);
  for (const 도구 of ['Read', 'Grep', 'Glob', 'Excel', 'Todo', '모르는도구']) {
    check(`바깥: ${도구} 도 가린다`, 가릴까(도구, { 바깥: true }) === true);
  }

  // 안 주면 이 안으로 본다. 「모르면 가린다」 가 아니라 「모르면 여태대로」 다 —
  // 여기서 기본을 가리는 쪽으로 잡으면, 부르는 데 하나를 빠뜨렸을 때 로컬
  // 사용자의 파일이 조용히 가려진다.
  check('안 주면 여태대로', 가릴까('Read') === false && 가릴까('Bash') === true);

}

trace('6-4-바깥으로나가는루프');

// ── 루프를 끝까지 돌려서, 모델에게 실제로 나간 글을 본다 ────────────────
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-secret-loop-'));
  const 진짜열쇠 = 'sk-proj-abcdefghijklmnopqrstuvwxyz012345';
  writeFileSync(join(방, '.env'), `OPENAI_API_KEY=${진짜열쇠}\n`, 'utf8');

  /*
   * 가짜 게이트웨이. 첫 부름에는 Read 를 시키고, 그 결과를 받은 두 번째
   * 부름의 몸통을 그대로 들고 있는다 — 거기 담긴 것이 곧 **바깥으로 나가는 글**
   * 이다. 주소는 바깥 것이지만 fetch 를 갈아 끼웠으므로 한 바이트도 안 나간다.
   */
  const 나간몸통 = [];
  const 진짜fetch = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    나간몸통.push(JSON.parse(String(opt.body ?? '{}')));
    const 답 = 나간몸통.length === 1
      ? { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: '.env' }) } }] } }] }
      : { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '봤습니다.' } }] };
    return new Response(JSON.stringify(답), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const 가린기록 = [];
  const 돌려보기 = async (base) => {
    나간몸통.length = 0;
    allowEndpoint(base);
    const conn = {
      kind: 'openai', base, auth: 'none', key: null, model: '검사용',
      ctx: 32768, streaming: false, tools: true, json: false, think: false,
    };
    const session = new Session(conn, { root: 방, mode: 'auto', think: 'off', maxSteps: 4 });
    const ctx = {
      scope: makeScope(방),
      history: { snapshot() {}, nextTurn() {} },
      audit: { write(kind, d) { if (kind === 'secret') 가린기록.push(d); }, tool() {}, turn() {} },
      seen: new Set(), enc: new Map(), 요청: '.env 좀 봐줘',
    };
    for await (const _ of run(session, ctx, '.env 좀 봐줘', {})) { /* 이벤트는 여기서 안 본다 */ }
    // 두 번째 부름의 몸통에 도구 결과가 실려 나간다.
    return JSON.stringify(나간몸통.at(-1) ?? {});
  };

  try {
    const 바깥으로 = await 돌려보기('https://gateway.example.test/v1');
    check('★ 바깥으로 나가는 길에서는 파일 내용이 가려져 나간다',
      !바깥으로.includes(진짜열쇠), 바깥으로.includes(진짜열쇠) ? '열쇠가 그대로 나갔다' : '');
    check('★ 가렸다는 것을 모델에게도 알려 준다', 바깥으로.includes('가림'), '');
    check('가렸다는 것을 감사기록에 남긴다',
      가린기록.some((d) => d.가렸나 === true && d.바깥 === true), JSON.stringify(가린기록));

    가린기록.length = 0;
    const 이안에서 = await 돌려보기('http://127.0.0.1:11434/v1');
    check('★ 이 안에서는 파일 내용을 안 가리고 그대로 준다',
      이안에서.includes(진짜열쇠), 이안에서.includes('가림') ? '가려 버렸다' : '열쇠가 아예 안 실렸다');
    check('안 가려도 봤다는 것은 기록에 남긴다',
      가린기록.some((d) => d.가렸나 === false && d.바깥 === false), JSON.stringify(가린기록));
  } finally {
    globalThis.fetch = 진짜fetch;
    rmSync(방, { recursive: true, force: true });
  }
}

trace('7-이상한것');

// ── 이상한 것이 와도 안 죽는다 ──────────────────────────────────────────
{
  check('null 이어도 안 죽는다', 가리기(null).글 === '' && 훑기(null).length === 0);
  check('숫자여도 안 죽는다', 가리기(12345).글 === '12345');
  check('아주 긴 글도 돈다', (() => {
    const 큰것 = ('가'.repeat(500) + '\n').repeat(400) + 'K=sk-aaaaaaaaaaaaaaaaaaaaaaaa';
    const r = 가리기(큰것);
    return r.가린것.length === 1 && !r.글.includes('sk-aaaa');
  })());
  // 이미 가린 것을 또 가리면 무엇이 가려졌는지 뭉개진다.
  const 한번 = 가리기('K=sk-aaaaaaaaaaaaaaaaaaaaaaaa');
  const 두번 = 가리기(한번.글);
  check('가린 것을 다시 가리지 않는다', 두번.글 === 한번.글, `${한번.글} → ${두번.글}`);
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n비밀 가리기 검사  ${D}(열쇠가 모델과 디스크로 새는가 · 파일은 안 건드리는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
