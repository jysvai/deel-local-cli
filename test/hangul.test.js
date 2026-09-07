// 한글이 어느 하나에서라도 깨지나 — 한 자리에 모아 잰다.
//
// ── 왜 따로 모으나 ─────────────────────────────────────────────────────
//
// 조각조각은 이미 재고 있다. 인코딩은 encoding.test.js 가, 화면 폭은
// ui.test.js 가, 경로 경계는 guard.test.js 가 본다. 그런데 **한글이
// 깨지는 자리는 그 사이사이**다.
//
//   게이트웨이가 한글 로 준 것을 우리가 어떻게 읽나
//   한 글자가 스트림 조각 둘에 걸쳐 오면
//   맥이 준 자모 분리(NFD) 이름과 우리가 쥔 NFC 이름
//   한글 이름 파일을 Read → Edit → Grep 으로 이어 갈 때
//   잘라 낼 때 글자 한가운데를 자르나
//
// 이 자리들은 어느 한 검사의 소관도 아니라서, 지금까지 아무도 안 봤다.
// 그리고 이건 우리가 남보다 나을 수 있다고 말하는 바로 그 자리다 —
// 남의 도구에서 한글이 도구 인자에서 깨지고 IME 조합이 겹치는 것이
// 몇 해째 열린 채로 있다. 그렇게 말하려면 우리 쪽에 검사가 있어야 한다.
//
// ── 무엇에는 안 붙나 ────────────────────────────────────────────────────
//
// 화면 전체가 한국어로만 나오나(langleak.test.js), 시킴말이 새나
// (prompt.test.js) 는 여기서 안 본다. 여기는 **글자가 그대로 살아 있나**만
// 본다. 옮긴 말이 맞나와 글자가 안 깨지나는 다른 축이다.
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { partialParse } from '../src/agent/salvage.js';
import { runTool } from '../src/tools/index.js';
import { makeScope } from '../src/safety/guard.js';
import { width, clip, pad } from '../src/ui/ansi.js';
import { decode as 바이트풀기, encode as 글자묶기 } from '../src/tools/encoding.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-hangul-'));
const ctx = () => ({
  scope: makeScope(root),
  history: { snapshot() {} },
  audit: { tool() {} },
  seen: new Set(),
  모델컨텍스트: 128000,
});

// 고르게 어려운 표본. 받침·겹받침·옛한글·한자·이모지·조사까지 섞는다.
const 표본 = '한글 맞춤법 검사기 · 닭볶음탕 · 읽기 · 뷁 · 漢字 · 😀 · 을/를';

trace('1-도구인자');

// ── 1. 게이트웨이가 한글을 \uXXXX 로 준다 ───────────────────────────────
//
// 이게 남의 도구에서 몇 해째 열려 있는 그 자리다. JSON 규격은 비ASCII 를
// 이스케이프해도 되고 안 해도 된다. 그래서 창구마다 다르게 오는데, 그
// **둘이 같은 값이 되지 않으면** 모델이 부른 도구의 인자가 조용히 달라진다.
// 파일 이름이 달라지면 없는 파일을 만들고, 찾을 말이 달라지면 못 찾는다.
{
  /*
   * **UTF-16 낱개**로 돌아야 한다.
   *
   * 처음에 `[...s]` 로 적었다가 이모지가 반만 나갔다. 그건 부호점 단위라
   * 😀 가 한 덩이로 오는데, 이스케이프는 낱개(\ud83d\ude00) 두 통으로 적어야
   * 하기 때문이다. 창구가 실제로 그렇게 준다.
   */
  const 이스케이프 = (s) => Array.from({ length: s.length }, (_, i) => {
    const u = s.charCodeAt(i);
    return u < 128 ? s[i] : '\\u' + u.toString(16).padStart(4, '0');
  }).join('');

  const 날것 = JSON.stringify({ file_path: 표본, pattern: '읽기' });
  const 이스케이프된 = `{"file_path":"${이스케이프(표본)}","pattern":"${이스케이프('읽기')}"}`;

  // 먼저 규격 자체가 같은 값을 준다는 것을 못 박는다. 이게 우리 기준이다.
  check('JSON 규격상 두 모양은 같은 값이다',
    JSON.parse(날것).file_path === JSON.parse(이스케이프된).file_path, '');

  // 그리고 우리 살리개도 같은 값을 줘야 한다. 살리개는 JSON.parse 가
  // 실패했을 때 쓰는 길이라, 여기가 어긋나면 **답이 잘린 날에만** 인자가
  // 달라진다 — 재현이 제일 안 되는 종류의 탈이다.
  const a = partialParse(날것);
  const b = partialParse(이스케이프된);
  check('★★ 살리개도 두 모양을 같게 읽는다',
    a.args.file_path === 표본 && b.args.file_path === 표본,
    JSON.stringify([a.args.file_path, b.args.file_path]));
  check('★ 이모지(서러게이트 짝)도 살아난다', b.args.file_path.includes('😀'), b.args.file_path);

  // 반토막 난 이스케이프에서 멈추되, 거기까지 읽은 것은 준다.
  const 반토막 = partialParse('{"file_path":"\\ud55c\\uae0');
  check('반토막 난 \\u 앞까지는 살린다', 반토막.args.file_path === '한', JSON.stringify(반토막.args));
}

trace('2-조각난스트림');

// ── 2. 한 글자가 조각 둘에 걸쳐 온다 ────────────────────────────────────
//
// 한글은 UTF-8 로 세 바이트다. SSE 조각은 바이트 경계로 오지 글자 경계로
// 오지 않는다. 그래서 조각을 각각 toString('utf8') 하면 경계에 걸린 글자가
// `` 로 바뀐다 — 영어만 쓰면 평생 안 나는 탈이다.
{
  const 바이트 = Buffer.from(표본, 'utf8');
  const 붙이기 = (자르는법) => {
    const dec = new TextDecoder();
    let out = '';
    for (const 조각 of 자르는법) out += dec.decode(조각, { stream: true });
    return out + dec.decode();   // 마지막 flush 를 빠뜨리면 끝 글자가 사라진다
  };

  // 모든 바이트 자리에서 한 번씩 잘라 본다. 한 자리라도 깨지면 실패다.
  let 깨진자리 = -1;
  for (let i = 1; i < 바이트.length; i++) {
    if (붙이기([바이트.subarray(0, i), 바이트.subarray(i)]) !== 표본) { 깨진자리 = i; break; }
  }
  check('★★ 어느 바이트에서 잘려도 안 깨진다', 깨진자리 === -1, `깨진 자리 ${깨진자리}`);

  // 한 바이트씩 오는 최악의 경우.
  check('★ 한 바이트씩 와도 안 깨진다',
    붙이기([...바이트].map((b) => Buffer.from([b]))) === 표본, '');

  /*
   * 스트림이 **글자 한가운데서** 끊긴 경우.
   *
   * 이때가 마지막 flush 가 값을 하는 유일한 자리다. `stream: true` 는 아직
   * 모자란 바이트를 들고 있으므로, 그냥 끝내면 그 자리에 아무것도 안 나온다.
   * adapter.js 가 `done` 일 때 `dec.decode()` 를 한 번 더 부르는 그 줄이
   * 여기서 「깨진 글자 하나」 를 뱉게 한다.
   *
   * 둘 다 온전한 답은 아니다. 그런데 **앞엣것까지 통째로 잃는 것**과
   * 「마지막 한 글자가 깨졌다」 는 다르다. 뒤엣것은 보면 알고, 앞엣것은
   * 모델이 짧은 답을 받은 것으로 알고 그냥 넘어간다.
   */
  const 반토막바이트 = 바이트.subarray(0, 바이트.length - 1);   // 마지막 글자를 한 바이트 자른다
  const flush없이 = (() => {
    const dec = new TextDecoder();
    return dec.decode(반토막바이트, { stream: true });
  })();
  const flush하고 = (() => {
    const dec = new TextDecoder();
    return dec.decode(반토막바이트, { stream: true }) + dec.decode();
  })();
  check('★ 글자 한가운데서 끊기면 flush 없이는 그 글자가 통째로 사라진다',
    flush없이.length + 1 === flush하고.length, `${flush없이.length} vs ${flush하고.length}`);
  check('★★ flush 하면 깨진 글자로라도 남는다 — 앞엣것은 다 살아 있다',
    flush하고.startsWith(표본.slice(0, -1)), flush하고.slice(-6));
}

trace('3-자모분리');

// ── 3. 맥이 준 이름은 자모가 나뉘어 있다 ────────────────────────────────
//
// 맥 파일 시스템은 이름을 NFD 로 준다. `한` 이 `ㅎ+ㅏ+ㄴ` 세 부호점이다.
// 눈으로는 같고, `===` 로는 다르다. 그래서 경로를 견주는 자리에서 한 번
// 어긋나면 「그 파일 없습니다」 가 되는데, 화면에는 같은 이름이 찍혀 있다.
{
  const 이름 = '오후보고서.txt';
  check('NFC 와 NFD 는 길이부터 다르다',
    이름.normalize('NFC').length !== 이름.normalize('NFD').length,
    `${이름.normalize('NFC').length} vs ${이름.normalize('NFD').length}`);
  check('그래도 눈으로는 같다', 이름.normalize('NFC') !== 이름.normalize('NFD'), '');

  const scope = makeScope(root);
  const 풀어보기 = (n) => { try { return scope.resolve(n); } catch (e) { return `막힘: ${e.message}`; } };
  const nfc = 풀어보기(이름.normalize('NFC'));
  const nfd = 풀어보기(이름.normalize('NFD'));
  check('★★ 두 꼴 다 범위 안으로 통과한다',
    !String(nfc).startsWith('막힘') && !String(nfd).startsWith('막힘'), `${nfc} / ${nfd}`);
  check('★★ 그리고 같은 파일을 가리킨다',
    String(nfc).normalize('NFC') === String(nfd).normalize('NFC'), '');

  /*
   * 보여 주는 이름도 마찬가지다.
   *
   * 여기가 어긋나면 제 폴더 안의 파일이 `../../../Users/me/오후/main.py`
   * 처럼 보인다 — 화면만 이상한 것이 아니라, 그 이름을 다시 도구에 넣으면
   * 진짜로 범위 밖이 된다.
   */
  const 보임 = scope.show(scope.resolve(이름.normalize('NFD')));
  check('★ 보여 주는 이름이 폴더 밖으로 안 새 나간다', !보임.startsWith('..'), 보임);
}

trace('4-한글이름파일');

// ── 4. 이름이 한글인 파일을 끝까지 다룬다 ───────────────────────────────
//
// 만들고 → 읽고 → 고치고 → 찾는다. 한 고리라도 끊기면 한글 이름을 쓰는
// 사람은 이 프로그램을 못 쓴다. 그리고 국내 저장소에서 한글 이름은 드물지
// 않다 — 문서 폴더는 거의 전부 그렇다.
{
  mkdirSync(join(root, '문서'), { recursive: true });
  // 한 대화로 이어 간다. Edit 은 같은 대화에서 Read 를 거친 파일만 고친다 —
  // ctx 를 매번 새로 만들면 그 규칙에 걸려서, 정작 재려던 것을 못 잰다.
  const 한대화 = ctx();
  const 경로 = '문서/설계 명세서.md';
  const 처음 = `# 설계 명세서\n\n${표본}\n\n다음 걸음: 검토\n`;

  const w = await runTool('Write', { file_path: 경로, content: 처음 }, 한대화);
  check('한글 이름으로 쓴다', !w.error, w.error ?? '');
  check('디스크에 그대로 들어갔다',
    readFileSync(join(root, '문서', '설계 명세서.md'), 'utf8') === 처음, '');

  const r = await runTool('Read', { file_path: 경로 }, 한대화);
  check('★ 읽어 온 것이 쓴 것과 같다',
    !r.error && String(r.content).includes(표본), r.error ?? String(r.content).slice(0, 60));

  const e = await runTool('Edit', {
    file_path: 경로, old_string: '다음 걸음: 검토', new_string: '다음 걸음: 배포',
  }, 한대화);
  check('★★ 한글을 한글로 바꾼다', !e.error, e.error ?? '');
  check('바꾼 것만 바뀌었다', (() => {
    const s = readFileSync(join(root, '문서', '설계 명세서.md'), 'utf8');
    return s.includes('다음 걸음: 배포') && !s.includes('검토') && s.includes(표본);
  })(), '');

  const g = await runTool('Grep', { pattern: '닭볶음탕', output_mode: 'files_with_matches' }, 한대화);
  check('★ 한글로 찾는다', !g.error && String(g.content).includes('설계 명세서.md'),
    g.error ?? String(g.content).slice(0, 80));

  const gl = await runTool('Glob', { pattern: '문서/*.md' }, 한대화);
  check('한글 폴더 무늬로 찾는다', !gl.error && String(gl.content).includes('설계 명세서.md'),
    gl.error ?? String(gl.content).slice(0, 80));
}

trace('5-화면폭');

// ── 5. 자를 때 글자 한가운데를 안 자른다 ────────────────────────────────
//
// 한글은 터미널에서 두 칸을 먹는다. 칸 수로 세면서 자르면 **글자 한가운데**
// 에서 끊기는데, 그러면 그 자리에 깨진 글자가 남는 것이 아니라 줄 전체의
// 칸이 하나씩 밀린다 — 표가 통째로 어긋난다.
{
  check('한글은 두 칸이다', width('한') === 2 && width('한글') === 4, String(width('한글')));
  check('영문은 한 칸이다', width('ab') === 2, '');
  check('섞여 있어도 센다', width('a한b') === 4, String(width('a한b')));

  for (const n of [1, 2, 3, 4, 5, 8, 12]) {
    const 잘린것 = clip('한글 맞춤법 검사기', n);
    check(`${n}칸으로 잘라도 칸을 안 넘는다`, width(잘린것) <= n, `${width(잘린것)}칸 "${잘린것}"`);
  }
  // 자른 자리에 반쪽 글자가 남으면 안 된다. 반쪽은 어차피 못 만들지만,
  // 「두 칸짜리를 한 칸 자리에 넣으려다 넣어 버리는」 것은 실제로 난다.
  check('★ 홀수 칸에 두 칸짜리를 우겨넣지 않는다', width(clip('한글', 3)) <= 3, `${width(clip('한글', 3))}칸`);

  // 칸 맞추기도 마찬가지다. 이것이 어긋나면 /work 같은 표가 계단처럼 밀린다.
  for (const s of ['한글', 'ab', 'a한', '']) {
    check(`pad 가 칸을 맞춘다: "${s}"`, width(pad(s, 10)) === 10, `${width(pad(s, 10))}칸`);
  }
}

trace('6-CP949');

// ── 6. CP949 로 적힌 파일 ───────────────────────────────────────────────
//
// 국내 회사 파일은 아직 CP949 가 많다. UTF-8 이라 여기고 읽으면 한글이
// 통째로 깨지고, 더 나쁜 것은 **그대로 UTF-8 로 덮어쓰는** 것이다 —
// 그러면 원본이 없어진다.
{
  const 글 = '가나다 라마바\r\n사아자\r\n';
  // 표에 적힌 이름을 그대로 쓴다 (tools/encoding.js 의 LEGACY). 'cp949' 처럼
  // 아는 이름을 넣으면 조용히 UTF-8 로 떨어지는데, 그러면 이 검사가 아무것도
  // 안 재면서 초록으로 남는다 — 처음에 실제로 그랬다.
  const cp949 = 글자묶기(글, 'euc-kr').buf;
  check('CP949 로 적으면 UTF-8 과 바이트가 다르다',
    !cp949.equals(Buffer.from(글, 'utf8')), '');

  const 읽은것 = 바이트풀기(cp949);
  check('★★ CP949 인 것을 알아채고 읽는다',
    읽은것.text.includes('가나다') && 읽은것.text.includes('사아자'),
    `${읽은것.encoding} "${읽은것.text.slice(0, 12)}"`);
  check('★ 무슨 인코딩이었는지 말해 준다 — 되쓸 때 그대로 써야 한다',
    /949|euc/i.test(String(읽은것.encoding)), String(읽은것.encoding));
  check('★★ 그리고 UTF-8 이라고 우기지 않는다', 읽은것.encoding !== 'utf-8', String(읽은것.encoding));

  // 왕복. 읽고 그대로 되쓰면 바이트가 같아야 한다.
  check('★★ 읽고 그대로 되쓰면 바이트가 같다',
    글자묶기(읽은것.text, 읽은것.encoding).buf.equals(cp949), '');
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n한글 회귀 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
rmSync(root, { recursive: true, force: true });
process.exitCode = fail.length ? 1 : 0;
