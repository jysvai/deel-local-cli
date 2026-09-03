// 붙여넣기를 접어서 보여 주는가 — 그리고 접은 것이 그대로 펴지는가.
//
// ── 무슨 일이 났었나 ────────────────────────────────────────────────────
//
// 「붙여넣기 해도 창에 붙여넣기된 내용이 다 뜨는게 아니야 claude/codex 처럼
//  압축된 거 처럼 보이면 더 좋을거같아, 그래야 자기가 뭘 붙여넣기 한건지
//  보기 더 편하잖아」
//
// 입력 상자는 여덟 줄까지만 보이고, 넘치면 **끝 여덟 줄**만 남는다. 마흔
// 줄을 붙이면 앞 서른두 줄이 화면에서 사라진다. 보내는 값은 멀쩡한데
// 화면이 그렇게 보이니, 사람은 앞부분이 안 갔다고 여기고 다시 붙인다.
//
// ── 여기서 지키는 것 ────────────────────────────────────────────────────
//
//   1. 상자에 안 들어갈 만큼 큰 덩이만 접는다. 세 줄짜리는 그냥 보인다.
//   2. 접은 것은 보낼 때 **글자 하나 안 틀리고** 되돌아온다. 되돌릴 수
//      없는 접기는 접기가 아니라 잘라내기다.
//   3. 화면에는 무엇을 붙였는지(줄 수·크기)가 남는다.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { trace } from './trace.mjs';
import { 크기말, 접을까, 표만들기, 펼치기, 쓴번호들, 표무늬 } from '../src/ui/pastechip.js';
import { 안쪽최대 } from '../src/ui/inputbox.js';
import { 언어정하기 } from '../src/i18n/index.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 여기 = dirname(fileURLToPath(import.meta.url));
const 뿌리 = dirname(여기);
const 소스 = readFileSync(new URL('../src/repl.js', import.meta.url), 'utf8');

trace('1-크기말');

{
  check('1KB 아래는 바이트로', 크기말(0) === '0B' && 크기말(999) === '999B',
    `${크기말(0)} · ${크기말(999)}`);
  check('KB 로 올린다', 크기말(1536) === '1.5KB', 크기말(1536));
  check('MB 로 올린다', 크기말(3 * 1024 * 1024) === '3.0MB', 크기말(3 * 1024 * 1024));
  check('경계에서 안 어긋난다', 크기말(1024) === '1.0KB', 크기말(1024));
}

trace('2-접을까');

{
  check('빈 것은 안 접는다', 접을까('') === false);
  check('한 줄짜리는 안 접는다', 접을까('안녕하세요') === false);

  /*
   * ★ 줄이 둘만 돼도 접는다.
   *
   * 처음에는 「상자에 들어가는 여덟 줄까지는 안 접는다」 였다. 자리가 있으니
   * 접을 이유가 없다고 본 것인데, 그게 틀렸다. 자리가 있느냐가 아니라
   * **그릴 수 있느냐**가 갈림이다. 상자는 readline 의 rl.line 이고 거기에는
   * 개행을 못 넣는다(newline.test.js). 그래서 안 접힌 넉 줄은 상자에
   * **맨 밑 한 줄만** 뜬다 — 사용자가 겪은 그대로다.
   */
  const 넉줄 = ['하나', '둘', '셋', '넷'].join('\n');
  const 여덟줄 = Array.from({ length: 안쪽최대 }, (_, i) => `줄 ${i + 1}`).join('\n');
  const 아홉줄 = Array.from({ length: 안쪽최대 + 1 }, (_, i) => `줄 ${i + 1}`).join('\n');
  check('★ 두 줄짜리도 접는다 (상자가 한 줄밖에 못 그린다)', 접을까('가\n나') === true);
  check('★ 넉 줄은 접는다 — 맨 밑 줄만 보이던 자리', 접을까(넉줄) === true);
  check(`${안쪽최대}줄도 접는다`, 접을까(여덟줄) === true);
  check(`넘치는 ${안쪽최대 + 1}줄은 접는다`, 접을까(아홉줄) === true);

  /*
   * ★ 줄 수만 세면 안 된다.
   *
   * 한 줄이어도 폭보다 길면 상자 안에서 여러 줄로 접힌다. 로그 한 줄,
   * 미니파이된 JSON 한 줄이 딱 그렇다 — 줄 수로만 재면 이런 것이 안
   * 접히고, 상자가 그대로 먹힌다.
   */
  const 긴한줄 = 'ㄱ'.repeat(800);
  check('★ 한 줄이어도 폭보다 길면 접는다', 접을까(긴한줄, { 폭: 80 }) === true);
  /*
   * ★ 그리고 그 판단은 **폭을 봐야** 한다. 폭을 안 보고 글자 수로만
   * 자르면, 창이 아주 넓어서 다 보이는 글까지 접힌다.
   */
  check('★ 폭이 넓으면 같은 글도 안 접는다', 접을까(긴한줄, { 폭: 4000 }) === false);

  // 상자가 쓰는 값과 어긋나면, 상자를 고쳤을 때 접는 기준만 옛 값에 남는다.
  check('기본 기준이 상자의 안쪽최대와 같다',
    접을까(여덟줄, { 최대: 안쪽최대 }) === 접을까(여덟줄)
    && 접을까(아홉줄, { 최대: 안쪽최대 }) === 접을까(아홉줄));
}

trace('3-표만들기');

{
  const 글 = '가\n나\n다';
  const 표 = 표만들기(1, 글);
  check('표 모양이 한눈에 읽힌다', /^\[붙여넣기 #1 · 3줄 · \d+B\]$/.test(표), 표);
  check('번호가 들어간다', 표만들기(7, 글).includes('#7'), 표만들기(7, 글));
  check('줄 수를 센다', 표만들기(1, 'a\nb\nc\nd').includes('4줄'), 표만들기(1, 'a\nb\nc\nd'));
  /*
   * ★ 크기는 **바이트**다. 글자 수로 세면 한글 문서의 크기가 3분의 1로
   * 보인다 — 32k 짜리 창에 뭘 밀어 넣는지 감이 안 잡힌다.
   */
  check('★ 크기를 바이트로 센다 (한글은 글자당 3바이트)',
    표만들기(1, '가나다').includes('9B'), 표만들기(1, '가나다'));
}

trace('4-펼치기');

{
  const 붙인것들 = new Map();
  const 원문 = '첫 줄\n\t들여쓴 줄\n이모지 🙂 와 따옴표 "큰" \'작은\'\n마지막';
  붙인것들.set(1, 원문);
  const 표 = 표만들기(1, 원문);

  check('표 하나가 원문으로 돌아온다', 펼치기(표, 붙인것들) === 원문);
  /*
   * ★ 바이트가 같아야 한다. 눈으로 같아 보이는 것으로는 모자란다 —
   * 줄바꿈 하나, 탭 하나가 달라져도 붙여 넣은 코드가 안 돌아간다.
   */
  check('★ 바이트까지 그대로다',
    Buffer.compare(Buffer.from(펼치기(표, 붙인것들), 'utf8'), Buffer.from(원문, 'utf8')) === 0);

  check('앞뒤에 사람이 친 말이 붙어 있어도 그 자리에서 펴진다',
    펼치기(`이거 봐 ${표} 어때?`, 붙인것들) === `이거 봐 ${원문} 어때?`);

  const 둘 = new Map([[1, 'AAA'], [2, 'BBB']]);
  check('표 두 개가 각각 제 원문으로 펴진다',
    펼치기(`${표만들기(1, 'AAA')} 와 ${표만들기(2, 'BBB')}`, 둘) === 'AAA 와 BBB');
  /*
   * ★ 붙어 있어도 각각이다. 무늬가 욕심을 부리면(`.*`) 두 표를 한 덩이로
   * 먹어서 둘 다 못 알아본다.
   */
  check('★ 표 두 개가 붙어 있어도 각각 펴진다',
    펼치기(`${표만들기(1, 'AAA')}${표만들기(2, 'BBB')}`, 둘) === 'AAABBB');

  check('모르는 번호는 사람이 친 글로 보고 둔다',
    펼치기('[붙여넣기 #99 · 3줄 · 10B]', 둘) === '[붙여넣기 #99 · 3줄 · 10B]');

  /*
   * ★ 치환 특수문자. 원문에 `$&` 나 `$1` 이 들어 있으면 replace 가 그걸
   * 「방금 맞은 것」 으로 바꿔 넣는다. 정규식 코드를 붙여넣으면 바로 난다.
   */
  const 달러 = new Map([[1, 'const re = s.replace(/x/g, "$&$1$$");']]);
  check('★ 원문에 $& 가 있어도 안 망가진다',
    펼치기(표만들기(1, 달러.get(1)), 달러) === 달러.get(1),
    펼치기(표만들기(1, 달러.get(1)), 달러));

  check('빈 것을 넣어도 안 터진다', 펼치기(null, 둘) === '' && 펼치기('그냥 글', null) === '그냥 글');
}

trace('5-쓴번호들');

{
  check('쓴 번호를 다 찾는다',
    JSON.stringify(쓴번호들(`${표만들기(3, 'a')} x ${표만들기(5, 'b')}`)) === '[3,5]',
    JSON.stringify(쓴번호들(`${표만들기(3, 'a')} x ${표만들기(5, 'b')}`)));
  check('없으면 빈 목록', 쓴번호들('아무 말').length === 0);
  /*
   * ★ 무늬에 /g 를 박아 두면 lastIndex 가 남아서, 같은 무늬로 두 번
   * 물었을 때 두 번째가 조용히 거짓이 된다.
   */
  const 한개 = 표만들기(1, 'a');
  check('★ 무늬를 두 번 물어도 같은 답이다',
    표무늬.test(한개) === 표무늬.test(한개) && 표무늬.test(한개) === true);
}

trace('6-repl-배선');

{
  check('repl 이 접을까를 부른다', /붙임접을까\(/.test(소스));
  check('repl 이 표를 만든다', /붙임표\(번호, 붙인것\)/.test(소스));
  check('repl 이 보내기 직전에 편다', /const 펴진것 = 붙임펼치기\(보낼것, 붙인것들\)/.test(소스));

  /*
   * ★ 펴는 자리가 한 군데여야 한다. 미리 쳐 둔 것이든 기다리다 보낸
   * 것이든 결국 같은 줄을 지나가므로, 거기서 한 번만 펴면 어느 길로 와도
   * 원문이 간다. 두 군데서 펴면 한쪽을 고칠 때 다른 쪽이 조용히 어긋난다.
   */
  check('★ 펴는 자리가 한 군데다', (소스.match(/붙임펼치기\(/g) ?? []).length === 1,
    `${(소스.match(/붙임펼치기\(/g) ?? []).length}군데`);

  // 펴진 것을 보내야 한다. 보낼것 을 그대로 보내면 모델은 표만 받는다.
  check('★ 펴진 것을 보낸다', /w\(펴진것\)/.test(소스) && /queue\.push\(펴진것\)/.test(소스));

  /*
   * ★ 접었으면 쌓인 줄에서 빼야 한다. 안 빼면 표도 가고 원문도 가서
   * 같은 글이 두 번 실린다.
   */
  check('★ 접은 줄은 쌓인 데서 뺀다', /이어쓰기줄들 = 붙임앞줄수 \? \(이어쓰기줄들 \?\? \[\]\)\.slice\(0, 붙임앞줄수\) : null/.test(소스));

  check('다 쓴 표는 치운다', /붙임쓴번호들\(보낼것\)\) 붙인것들\.delete\(번호\)/.test(소스));
  check('시작 표에서 앞자리를 적어 둔다', /붙임앞줄수 = 이어쓰기줄들\?\.length \?\? 0/.test(소스));
}

trace('7-진짜로-접히나');

/*
 * ── 소스를 훑는 것만으로는 모자란다 ─────────────────────────────────────
 *
 * 위 검사들은 "그렇게 적혀 있나" 를 본다. 이 결함이 잡으려는 것은
 * **화면에 무엇이 남고 모델에게 무엇이 가나** 이고, 그건 진짜 deel 을
 * 띄워 봐야만 안다. paste.test.js 와 같은 방법이다 — tty-preload.mjs 로
 * 터미널인 척하고, 터미널이 붙여넣기를 감쌀 때 보내는 바이트를 흘려 넣는다.
 */
{
  const 받은것 = [];
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (String(req.url).endsWith('/models')) return send({ data: [{ id: '스텁모델', object: 'model' }] });
      const j = (() => { try { return JSON.parse(b || '{}'); } catch { return {}; } })();
      const u = (j.messages ?? []).filter((m) => m.role === 'user').at(-1);
      if (u) 받은것.push(String(u.content));
      return send({ id: 'x', object: 'chat.completion', model: '스텁모델',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '네' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 } });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));

  const home = mkdtempSync(join(tmpdir(), 'deel-chip-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 's', level: '개발자',
    profiles: [{
      id: 's', name: 's', kind: 'openai', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`,
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: false, tools: false,
    }],
  }), 'utf8');
  const root = mkdtempSync(join(tmpdir(), 'deel-chip-'));

  const { CI, ...환경 } = process.env;
  const 앞선것 = join(여기, 'tty-preload.mjs').replace(/\\/g, '/');
  const kid = spawn(process.execPath,
    ['--import', `file:///${앞선것}`, join(뿌리, 'bin', 'deel.js'), '--root', root, '--offline'],
    { cwd: 뿌리, stdio: ['pipe', 'pipe', 'pipe'], env: { ...환경, DEEL_HOME: home } });

  let out = '';
  kid.stdout.setEncoding('utf8');
  kid.stderr.setEncoding('utf8');
  kid.stdout.on('data', (d) => { out += d; });
  kid.stderr.on('data', (d) => { out += d; });
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 기다리기 = async (뭐, 될때까지, 최대 = 20000) => {
    const 끝 = Date.now() + 최대;
    while (Date.now() < 끝) {
      if (될때까지()) return true;
      await 자기(50);
    }
    check(`${뭐} 를 ${최대}ms 안에 못 봤다`, false, out.slice(-160));
    return false;
  };
  const 민화면 = () => out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

  await 기다리기('붙여넣기 표 켜기', () => out.includes('\x1b[?2004h'));
  await 기다리기('입력 자리(❯)가 그려지기', () => 민화면().includes('❯'));
  await 기다리기('화면이 다 그려지기', (() => {
    let 앞길이 = -1; let 그대로인때 = 0;
    return () => {
      if (out.length === 앞길이) { 그대로인때 += 1; return 그대로인때 >= 8; }
      앞길이 = out.length; 그대로인때 = 0; return false;
    };
  })());

  // 상자에 절대 안 들어가는 덩이. 탭과 이모지를 섞어 둔다 — 바이트가
  // 그대로 가는지 보려는 것이다.
  const 붙일것 = Array.from({ length: 40 }, (_, i) =>
    (i === 7 ? '\t들여쓴 줄 🙂 입니다' : `${i + 1}번째 줄 — 붙여넣기 시험`)).join('\n');
  // 색을 벗긴 글에서 자를 것이므로, 자리도 벗긴 글에서 재야 한다.
  const 접힌뒤자리 = 민화면().length;
  kid.stdin.write(`\x1b[200~${붙일것}\x1b[201~`);
  await 기다리기('접었다고 알려 주기', () => /붙여넣기 #1/.test(민화면().slice(접힌뒤자리)));
  const 접힌화면 = 민화면().slice(접힌뒤자리);

  kid.stdin.write('\n');
  await 기다리기('붙인 글이 모델까지 가기', () => 받은것.length >= 1);
  kid.stdin.write('/exit\n');
  await Promise.race([new Promise((r) => kid.on('close', r)), 자기(7000).then(() => kid.kill())]);
  srv.close();

  check('접었다고 표로 알려 준다', /\[붙여넣기 #1 · 40줄 · [\d.]+(?:B|KB)\]/.test(접힌화면),
    접힌화면.split('\n').find((l) => /붙여넣기 #/.test(l))?.trim().slice(0, 70) ?? '(못 찾음)');

  /*
   * ★ 접었으면 화면에 마흔 줄이 안 쏟아져야 한다. 이게 이 파일이 있는
   * 이유다 — 표만 만들고 상자에는 그대로 밀어 넣으면 아무것도 안 고친
   * 것이다.
   */
  const 쏟아진줄 = ['3번째 줄', '20번째 줄', '35번째 줄'].filter((s) => 접힌화면.includes(s));
  check('접었으면 상자에 원문이 안 쏟아진다', 쏟아진줄.length === 0,
    쏟아진줄.join(' · ') || '없다');
  /*
   * ★ 그리고 상자에 남는 것이 **표**여야 한다.
   *
   * 안 접으면 상자에는 붙인 것의 **마지막 조각**만 남는다(앞줄들은 쌓여
   * 있고 상자는 그걸 안 그린다) — 그게 바로 「붙여넣기된 내용이 다 뜨는
   * 게 아니야」 라던 그 화면이다. 그러니 마지막 줄이 보이면 안 접힌 것이다.
   */
  check('★ 상자에 원문 조각 대신 표가 남는다',
    접힌화면.includes('[붙여넣기 #1') && !접힌화면.includes('40번째 줄'),
    접힌화면.includes('40번째 줄') ? '마지막 줄이 그대로 보인다 — 안 접혔다' : '');

  /*
   * ★ 그리고 모델에게는 마흔 줄이 **그대로** 가야 한다. 접기는 보기
   * 좋으라고 하는 짓이지 내용을 줄이는 짓이 아니다.
   */
  check('★ 모델에게는 원문이 글자 그대로 간다', 받은것[0] === 붙일것,
    받은것[0] === 붙일것 ? '' : `왔다: ${JSON.stringify(String(받은것[0] ?? '(안 옴)').slice(0, 60))}`);
  check('★ 바이트까지 같다', 받은것[0] !== undefined
    && Buffer.compare(Buffer.from(받은것[0], 'utf8'), Buffer.from(붙일것, 'utf8')) === 0);
  check('표가 모델에게 안 간다', !/붙여넣기 #\d+ ·/.test(받은것[0] ?? ''),
    JSON.stringify(String(받은것[0] ?? '').slice(0, 60)));
  check('마흔 줄을 붙여도 한 번만 간다', 받은것.length === 1, `${받은것.length}번 갔다`);
  check('붙여넣기 표가 글에 안 섞인다', !/\x1b\[20[01]~/.test(받은것[0] ?? ''));

  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

trace('7.5-말을-바꿔도-알아보나');

/*
 * ── 표 낱말이 한국어로 박혀 있었다 ──────────────────────────────────────
 *
 * `/lang en` 을 켠 사람 화면에도 `[붙여넣기 #1 · 40줄 · 2.1KB]` 가 떴다.
 * 그 줄만 한글이라 무엇을 뜻하는지 알 길이 없다.
 *
 * 그런데 여기서 조심할 것이 하나 더 있다. 이 낱말은 **찍고 나서 다시 찾는**
 * 말이다 — 보낼 때 표를 원문으로 펴야 하기 때문이다. 지금 말로만 찾게 해
 * 두면, 표를 찍어 놓고 `/lang en` 을 치는 순간 앞서 찍은 표를 못 알아본다.
 * 그러면 사람이 붙인 마흔 줄 대신 **표 글자가 그대로** 모델에게 간다.
 * 화면에는 아무 표시도 안 난다. 그래서 여기서 못 박는다.
 */
{
  const 원문 = 'a\nb\nc';
  언어정하기('en');
  const 영표 = 표만들기(1, 원문);
  check('★ 영어로 켜면 표도 영어다', /^\[pasted #1 · 3 lines · \d+B\]$/.test(영표), 영표);

  언어정하기('ja');
  check('일본어도 제 말로 적는다', /^\[貼り付け #1 · 3行 · \d+B\]$/.test(표만들기(1, 원문)), 표만들기(1, 원문));
  언어정하기('zh');
  check('중국어도 제 말로 적는다', /^\[粘贴 #1 · 3行 · \d+B\]$/.test(표만들기(1, 원문)), 표만들기(1, 원문));

  // 여기가 진짜다. 한국어로 찍어 둔 표를, 말을 바꾼 뒤에도 펴는가.
  언어정하기('ko');
  const 한글표 = 표만들기(1, 원문);
  언어정하기('en');
  const 통 = new Map([[1, 원문]]);
  check('★ 말을 바꿔도 앞서 찍은 표를 알아본다', 표무늬.test(한글표), `${한글표} · 지금 말 en`);
  check('★ 말을 바꿔도 앞서 찍은 표가 원문으로 펴진다', 펼치기(한글표, 통) === 원문,
    JSON.stringify(펼치기(한글표, 통)));
  const 영표2 = 표만들기(2, 원문);
  통.set(2, 원문);
  check('영어로 찍은 표도 펴진다', 펼치기(영표2, 통) === 원문, JSON.stringify(펼치기(영표2, 통)));
  check('두 말로 찍힌 표가 한 줄에 섞여도 다 펴진다',
    펼치기(`${한글표} 와 ${영표2}`, 통) === `${원문} 와 ${원문}`,
    JSON.stringify(펼치기(`${한글표} 와 ${영표2}`, 통)));
  언어정하기('ko');
}

trace('7.7-일하는-도중에-붙여도-접히나');

/*
 * ── 접기가 기다릴 때만 돌았다 ───────────────────────────────────────────
 *
 * 붙여넣기는 **일하는 도중이 더 흔하다.** 몇 분짜리 턴이 도는 동안 다음에
 * 시킬 것을 미리 붙여 두는 것이 그것이다. 그런데 접기 갈래가 `입력기다림`
 * 일 때만 돌아서, 일하는 중에 마흔 줄을 붙이면 —
 *
 *   상자(일감 자리)에는 **마지막 한 줄만** 보인다
 *     → 사람은 한 줄만 들어갔다고 여기고 다시 붙인다
 *       → 이번엔 진짜로 두 번 들어간다
 *
 * 접기가 애초에 막으려던 바로 그 사고가, 기다릴 때는 안 나고 일할 때만 났다.
 * 그래서 진짜로 일을 시켜 놓고, 그 위에 붙여 본다.
 */
{
  const 받은것 = [];
  let 첫부름 = true;
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      /*
       * 대화 부름이 아닌 것은 여기서 끝낸다.
       *
       * deel 은 켜질 때 서버를 훑는다(/v1/models/<이름> 따위). 그걸 안
       * 갈라 두면 그 탐색이 아래 「첫 부름은 오래 끈다」 를 먼저 써 버려서,
       * 정작 사람이 시킨 일은 곧바로 끝난다 — 일하는 중이 아예 없는 검사가
       * 된다. 앞서 한 번 여기에 속았다.
       */
      if (!String(req.url).includes('/chat/completions')) {
        return send({ data: [{ id: '스텁모델', object: 'model' }] });
      }
      const j = (() => { try { return JSON.parse(b || '{}'); } catch { return {}; } })();
      const u = (j.messages ?? []).filter((m) => m.role === 'user').at(-1);
      if (u) 받은것.push(String(u.content));
      const 답 = () => send({ id: 'x', object: 'chat.completion', model: '스텁모델',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '네' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 } });
      // 사람이 시킨 첫 부름만 오래 끈다 — 그동안이 '일하는 중' 이다.
      if (u && 첫부름) { 첫부름 = false; setTimeout(답, 6000); return; }
      답();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));

  const home = mkdtempSync(join(tmpdir(), 'deel-chipwork-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 's', level: '개발자',
    profiles: [{
      id: 's', name: 's', kind: 'openai', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`,
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: false, tools: false,
    }],
  }), 'utf8');
  const root = mkdtempSync(join(tmpdir(), 'deel-chipwork-'));

  const { CI, ...환경 } = process.env;
  const 앞선것 = join(여기, 'tty-preload.mjs').replace(/\\/g, '/');
  const kid = spawn(process.execPath,
    ['--import', `file:///${앞선것}`, join(뿌리, 'bin', 'deel.js'), '--root', root, '--offline'],
    { cwd: 뿌리, stdio: ['pipe', 'pipe', 'pipe'], env: { ...환경, DEEL_HOME: home } });

  let out = '';
  kid.stdout.setEncoding('utf8');
  kid.stderr.setEncoding('utf8');
  kid.stdout.on('data', (d) => { out += d; });
  kid.stderr.on('data', (d) => { out += d; });
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 민화면 = () => out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  const 기다리기 = async (뭐, 될때까지, 최대 = 25000) => {
    const 끝 = Date.now() + 최대;
    while (Date.now() < 끝) {
      if (될때까지()) return true;
      await 자기(50);
    }
    check(`${뭐} 를 ${최대}ms 안에 못 봤다`, false, 민화면().slice(-200));
    return false;
  };

  await 기다리기('붙여넣기 표 켜기', () => out.includes('\x1b[?2004h'));
  await 기다리기('입력 자리(❯)가 그려지기', () => 민화면().includes('❯'));

  // 일을 시킨다. 서버가 6초를 끄니 그동안이 '일하는 중' 이다.
  kid.stdin.write('오래 걸리는 일 좀 해줘\n');
  const 일하나 = await 기다리기('일하는 중 화면', () => 받은것.length >= 1, 15000);

  const 붙이기전 = 민화면().length;
  const 붙일것 = Array.from({ length: 40 }, (_, i) => `${i + 1}번째 줄 — 일하는 중에 붙임`).join('\n');
  kid.stdin.write(`\x1b[200~${붙일것}\x1b[201~`);
  const 접혔나 = await 기다리기('일하는 중에도 표가 뜨기',
    () => /\[붙여넣기 #1/.test(민화면().slice(붙이기전)), 15000);
  const 붙인뒤화면 = 민화면().slice(붙이기전);

  // 이제 보낸다. 아직 일하는 중이라 예약으로 들어가고, 첫 턴이 끝나면 나간다.
  kid.stdin.write('\n');
  await 기다리기('붙인 것이 모델까지 가기', () => 받은것.length >= 2, 25000);
  kid.stdin.write('/exit\n');
  await Promise.race([new Promise((r) => kid.on('close', r)), 자기(8000).then(() => kid.kill())]);
  srv.close();

  check('먼저: 진짜로 일하는 중이었다', 일하나, `부름 ${받은것.length}회`);
  /*
   * ★ 여기가 이 검사의 심장이다.
   *
   * 기다리는 중에 접으면 대화에 「접어 뒀습니다」 를 찍는다. 일하는 중에는
   * 안 찍는다 — 찍으면 이미 보낸 것처럼 보인다. 그 줄이 보였다면 붙일 때
   * 이미 턴이 끝나 있었다는 뜻이고, 그러면 이 검사는 아무것도 안 잰 것이다.
   */
  check('★ 붙일 때 진짜로 일하는 중이었다', !/접어 뒀습니다/.test(붙인뒤화면),
    /접어 뒀습니다/.test(붙인뒤화면) ? '기다리는 중에 붙었다 — 잰 것이 없다' : '');
  check('★ 일하는 중에 붙여도 표로 접힌다', 접혔나,
    붙인뒤화면.split('\n').find((l) => /붙여넣기 #|번째 줄/.test(l))?.trim().slice(0, 80) ?? '(못 찾음)');

  /*
   * ★ 그리고 원문이 화면에 안 쏟아져야 한다. 접기가 도는지 재는 자리는
   * 여기다 — 표만 뜨고 원문도 같이 쏟아지면 아무것도 안 고친 것이다.
   */
  const 쏟아진줄 = ['3번째 줄', '20번째 줄', '39번째 줄'].filter((s) => 붙인뒤화면.includes(s));
  check('★ 일하는 중에도 원문이 안 쏟아진다', 쏟아진줄.length === 0, 쏟아진줄.join(' · ') || '없다');

  /*
   * ★ 접었어도 보낼 때는 원문 그대로여야 한다. 일하는 중에 붙인 것은
   * 예약으로 들어갔다가 나중에 나가는데, 그 길에서도 펴져야 한다.
   */
  const 나중것 = 받은것[1];
  check('★ 일하는 중에 붙인 것도 원문 그대로 간다', 나중것 === 붙일것,
    나중것 === 붙일것 ? '' : `왔다: ${JSON.stringify(String(나중것 ?? '(안 옴)').slice(0, 70))}`);
  check('표가 모델에게 안 간다', !/붙여넣기 #\d+ ·/.test(나중것 ?? ''),
    JSON.stringify(String(나중것 ?? '').slice(0, 60)));

  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

trace('8-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n붙여넣기 접기 검사  ${D}(마흔 줄이 표 한 줄로 보이고, 그대로 펴지는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
