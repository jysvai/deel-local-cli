// 화면 사진 만들기 — 진짜 화면을 찍어서 SVG 로 굳힌다.
//
// ── 왜 있나 ────────────────────────────────────────────────────────────
//
// README 에 코드블록으로 붙인 화면은 **손으로 적은 것**이라, 화면이 바뀌어도
// 그 자리는 안 바뀐다. 그러면 문서가 조용히 거짓말을 하기 시작한다. 실제로
// 판올림마다 손으로 고쳐 왔고, 몇 군데는 이미 지금 화면과 달랐다.
//
// 여기서는 진짜로 `deel` 을 띄워서 나온 것을 그대로 그린다. 화면이 바뀌면
// 다시 돌려서 다시 만든다. 지어낸 그림이 아니다.
//
// ── 왜 SVG 인가 ────────────────────────────────────────────────────────
//
// PNG 는 커지고, 확대하면 흐려지고, 깃 저장소에 덩어리로 쌓인다. SVG 는
// 글자가 글자로 남아서 선명하고, 몇 KB 고, diff 도 읽힌다. 밝은 판·어두운
// 판을 따로 내서 `<picture>` 로 고르게 한다.
//
// ── 칸을 어떻게 맞추나 ─────────────────────────────────────────────────
//
// 터미널은 글자 하나가 한 칸이고 한글은 두 칸이다. 그런데 브라우저 글꼴은
// 한글 폭이 라틴 두 배라는 보장이 없다 — 그대로 흘리면 상자 그림이 어긋난다.
// 그래서 **한 덩이마다 차지할 칸 수를 재서 `textLength` 로 못 박는다.**
// 어떤 글꼴로 그려도 격자가 안 흐트러진다.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { width } from '../src/ui/ansi.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const 진입점 = join(repo, 'bin', 'deel.js');
const 나갈곳 = join(repo, 'docs', 'assets');

// 한 칸의 크기. 14px 모노스페이스의 실제 자간에 맞춘 값이다.
const 칸너비 = 8.4;
const 줄높이 = 19;
const 글자크기 = 14;

/*
 * 색.
 *
 * 터미널 16색을 그대로 옮기지 않고 **읽히는 값**으로 고쳐 잡았다. 터미널의
 * 기본 초록·회색은 흰 바탕에서 거의 안 보인다. README 는 흰 바탕에서 보는
 * 사람이 더 많다.
 */
const 판 = {
  light: {
    바탕: '#ffffff', 테: '#d0d7de', 글: '#1f2328', 그늘: '#59636e',
    빨강: '#cf222e', 초록: '#1a7f37', 노랑: '#9a6700', 파랑: '#0969da',
    보라: '#8250df', 하늘: '#1b7c83', 흰것: '#1f2328',
    창테: '#d0d7de', 창머리: '#f6f8fa', 불1: '#ff5f57', 불2: '#febc2e', 불3: '#28c840',
  },
  dark: {
    바탕: '#0d1117', 테: '#30363d', 글: '#e6edf3', 그늘: '#8b949e',
    빨강: '#ff7b72', 초록: '#3fb950', 노랑: '#d29922', 파랑: '#58a6ff',
    보라: '#bc8cff', 하늘: '#39c5cf', 흰것: '#f0f6fc',
    창테: '#30363d', 창머리: '#161b22', 불1: '#ff5f57', 불2: '#febc2e', 불3: '#28c840',
  },
};

const 색번호 = {
  30: '그늘', 31: '빨강', 32: '초록', 33: '노랑', 34: '파랑', 35: '보라', 36: '하늘', 37: '글',
  90: '그늘', 91: '빨강', 92: '초록', 93: '노랑', 94: '파랑', 95: '보라', 96: '하늘', 97: '흰것',
};

/**
 * ANSI 가 섞인 글을 [{글, 색, 굵게}] 줄들로 푼다.
 *
 * 256색(`38;5;n`)도 받는다 — 이 프로그램이 상태줄과 게이지에 쓴다.
 * 정확히 옮기려 들지 않고 가까운 이름으로 접는다. 그림이지 화면이 아니라서,
 * 톤이 몇 단계 다른 것보다 **안 보이는 것**이 문제다.
 */
function 풀기(글) {
  const 줄들 = [];
  let 색 = null;
  let 굵게 = false;
  for (const 한줄 of 글.replace(/\r/g, '').split('\n')) {
    const 조각들 = [];
    let 남은 = 한줄;
    let 쌓임 = '';
    const 밀기 = () => { if (쌓임) { 조각들.push({ 글: 쌓임, 색, 굵게 }); 쌓임 = ''; } };
    while (남은.length) {
      const m = 남은.match(/^\x1b\[([0-9;]*)m/);
      if (m) {
        밀기();
        const 값들 = m[1].split(';').filter(Boolean).map(Number);
        if (!값들.length || 값들[0] === 0) { 색 = null; 굵게 = false; }
        for (let i = 0; i < 값들.length; i++) {
          const v = 값들[i];
          if (v === 1) 굵게 = true;
          else if (v === 22) 굵게 = false;
          else if (v === 38 && 값들[i + 1] === 5) {
            const n = 값들[i + 2];
            i += 2;
            색 = n < 8 ? 색번호[30 + n] : n < 16 ? 색번호[90 + (n - 8)]
              : n >= 232 ? '그늘' : '하늘';
          } else if (색번호[v]) 색 = 색번호[v];
        }
        남은 = 남은.slice(m[0].length);
        continue;
      }
      // 다른 ANSI(커서 옮기기 따위)는 버린다. 그림에는 뜻이 없다.
      const other = 남은.match(/^\x1b\[[0-9;?]*[A-Za-z]|^\x1b[()][A-B]/);
      if (other) { 남은 = 남은.slice(other[0].length); continue; }
      쌓임 += 남은[0];
      남은 = 남은.slice(1);
    }
    밀기();
    줄들.push(조각들);
  }
  return 줄들;
}

const 감싸기 = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 줄들을 SVG 한 장으로.
 *
 * @param {Array} 줄들 풀기() 가 낸 것
 * @param {{제목: string, 갈래: 'light'|'dark', 이름: string}} 옵션
 */
function 그리기(줄들, { 제목, 갈래, 이름 }) {
  const p = 판[갈래];
  const 칸수 = Math.max(40, ...줄들.map((조각들) => 조각들.reduce((n, x) => n + width(x.글), 0)));
  const 여백 = 16;
  const 머리 = 34;
  const w = Math.ceil(칸수 * 칸너비 + 여백 * 2);
  const h = Math.ceil(줄들.length * 줄높이 + 여백 * 2 + 머리);

  const 몸 = [];
  줄들.forEach((조각들, i) => {
    const y = 여백 + 머리 + i * 줄높이 + 글자크기;
    let 칸 = 0;
    for (const 조각 of 조각들) {
      const 몇칸 = width(조각.글);
      if (조각.글.trim()) {
        const x = (여백 + 칸 * 칸너비).toFixed(1);
        const 길이 = (몇칸 * 칸너비).toFixed(1);
        const 색값 = p[조각.색] ?? p.글;
        const 굵기 = 조각.굵게 ? ' font-weight="600"' : '';
        몸.push(`<text x="${x}" y="${y}" fill="${색값}"${굵기} textLength="${길이}" `
          + `lengthAdjust="spacing" xml:space="preserve">${감싸기(조각.글)}</text>`);
      }
      칸 += 몇칸;
    }
  });

  // 창 머리의 점 세 개. 「이건 터미널이다」 를 한눈에 알린다.
  const 점 = (cx, 색) => `<circle cx="${cx}" cy="17" r="5.5" fill="${색}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" `
    + `viewBox="0 0 ${w} ${h}" role="img" aria-label="${감싸기(제목)}">
  <title>${감싸기(제목)}</title>
  <rect width="${w}" height="${h}" rx="8" fill="${p.바탕}" stroke="${p.창테}"/>
  <path d="M0 8a8 8 0 0 1 8-8h${w - 16}a8 8 0 0 1 8 8v${머리 - 8}H0z" fill="${p.창머리}"/>
  <line x1="0" y1="${머리}" x2="${w}" y2="${머리}" stroke="${p.창테}"/>
  ${점(18, p.불1)}${점(36, p.불2)}${점(54, p.불3)}
  <text x="${w / 2}" y="22" fill="${p.그늘}" font-size="12" text-anchor="middle" \
font-family="ui-sans-serif,-apple-system,Segoe UI,sans-serif">${감싸기(이름)}</text>
  <g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace" \
font-size="${글자크기}">
${몸.map((l) => `    ${l}`).join('\n')}
  </g>
</svg>
`;
}

/** deel 을 띄워서 나온 것을 그대로 받는다. */
function 띄우기(인자, { home, cwd, cols = 84, env = {}, 입력 = [] } = {}) {
  return new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, ...인자], {
      cwd,
      env: {
        ...process.env,
        DEEL_HOME: home,
        FORCE_COLOR: '1',
        NO_COLOR: '',
        COLUMNS: String(cols),
        DEEL_NO_OPEN: '1',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let 마지막 = Date.now();
    let 끝남 = false;
    kid.stdout.on('data', (b) => { out += b; 마지막 = Date.now(); });
    kid.stderr.on('data', (b) => { out += b; 마지막 = Date.now(); });
    const 시계 = setTimeout(() => kid.kill('SIGKILL'), 60000);

    // 줄을 밀어 넣을 때는 **저쪽이 조용해졌는지**를 보고 넣는다. 시간으로
    // 재면 느린 기계에서 두 줄이 한 덩어리로 붙는다 (검사에서 이미 겪었다).
    (async () => {
      for (const 줄 of 입력) {
        for (let t = 0; t < 500 && !끝남; t++) {
          if (out.length && Date.now() - 마지막 > 250) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        if (끝남) break;
        kid.stdin.write(줄 + '\n');
        마지막 = Date.now();
      }
      if (!끝남) kid.stdin.end();
    })();

    kid.on('close', () => { 끝남 = true; clearTimeout(시계); done(out); });
  });
}

/**
 * 대화 화면을 찍기 위한 스텁 게이트웨이.
 *
 * **진짜 모델에는 안 붙는다.** 127.0.0.1 의 임시 포트에 우리가 띄운 것이고,
 * 도구를 부르는 차례만 정해 놓았다. 그러니 그림에 나오는 도구 줄·걸린 시간·
 * 토큰 수는 전부 진짜로 돈 결과다 — 도구가 진짜 파일을 읽고 고친다.
 */
function 스텁띄우기() {
  let 차례 = 0;
  let 말 = 'en';
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url.split('?')[0];
      const 보냄 = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (url === '/v1/models') return 보냄({ data: [{ id: 'qwen2.5-coder:7b', object: 'model' }] });
      if (url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }

      const 답 = (msg, why) => 보냄({
        id: 'x', object: 'chat.completion', model: 'qwen2.5-coder:7b',
        choices: [{ index: 0, finish_reason: why ?? (msg.tool_calls ? 'tool_calls' : 'stop'), message: msg }],
        usage: { prompt_tokens: 3900, completion_tokens: 180 },
      });
      const 도구 = (name, args) => 답({
        role: 'assistant', content: null,
        tool_calls: [{ id: `c${차례}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      });

      차례 += 1;
      if (차례 === 1) return 도구('Grep', { pattern: 'console\\.log', output_mode: 'files_with_matches' });
      if (차례 === 2) return 도구('Read', { file_path: 'src/runner.js' });
      if (차례 === 3) {
        return 도구('Edit', {
          file_path: 'src/runner.js',
          old_string: "console.log('run start')",
          new_string: "logger.info('run start')",
        });
      }
      return 답({
        role: 'assistant',
        content: 말 === 'ko'
          ? 'src/runner.js 의 로그를 logger 형식으로 맞췄습니다. 고친 곳은 한 군데입니다.'
          : 'Unified the log calls to the logger format. One change in src/runner.js.',
      });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({
    srv,
    port: srv.address().port,
    // 판마다 처음부터 다시 센다. 안 그러면 두 번째 판은 앞판이 이미 써 버린
    // 차례부터 시작해서 도구를 하나도 안 부르고 답만 한 그림이 된다.
    처음부터: (어느말) => { 차례 = 0; 말 = 어느말; },
  })));
}

/*
 * 임시 폴더 이름을 사람이 읽을 만한 것으로 바꾼다.
 *
 * 진짜 화면을 찍는 값은 그대로 두되, 이 PC 의 임시 경로가 그림에 남으면
 * 읽는 사람에게는 뜻 없는 글자일 뿐이고 내 계정 이름까지 같이 나간다.
 * **값이 아니라 이름만** 바꾼다 — 숫자는 하나도 안 건드린다.
 */
function 길다듬기(글, { home, work }) {
  // 역슬래시를 글자로 안 적는다 — 이 파일이 여러 도구를 거치면서 그 한 글자가
  // 조용히 한 겹씩 벗겨진 적이 있다. 코드값으로 만들면 그럴 일이 없다.
  const 역 = String.fromCharCode(92);
  const 바꿔 = (자리, 새이름) => {
    const 꼴들 = new Set([자리, 자리.split(역).join('/'), 자리.split('/').join(역)]);
    for (const 꼴 of 꼴들) {
      // **같은 폭으로** 바꾼다. 상자 그림 안에서는 글자 하나가 곧 한 칸이라,
      // 짧은 이름으로 그냥 갈아 끼우면 오른쪽 테두리가 그만큼 왼쪽으로 밀린다.
      const 채운것 = 새이름 + ' '.repeat(Math.max(0, width(꼴) - width(새이름)));
      글 = 글.split(꼴).join(채운것);
    }
  };
  바꿔(home, ['C:', 'Users', 'me', '.deel'].join(역));
  바꿔(work, ['C:', 'work', 'myproject'].join(역));
  return 글;
}

/** 앞뒤 빈 줄을 걷어낸다. 그림에 빈 칸만 남는 자리가 생긴다. */
function 다듬기(글, { 자를것 = null, 최대줄 = 60, 뺄것 = [] } = {}) {
  let 줄 = 글.split('\n');
  if (자를것) {
    const i = 줄.findIndex((l) => 자를것.test(l.replace(/\x1b\[[0-9;]*m/g, '')));
    if (i > 0) 줄 = 줄.slice(i);
  }
  /*
   * 찍는 장치 때문에 생긴 줄만 뺀다.
   *
   * 스텁 게이트웨이는 스트리밍을 안 해서 deel 이 「한 번에 나옵니다」 라고
   * 알려 준다. 그건 **이 스텁의 성질**이지 이 프로그램의 성질이 아니다.
   * 그림을 예쁘게 하려고 결과를 지우는 것이 아니라, 찍는 판 때문에 생긴
   * 것을 걷어내는 것이다. 도구 줄·숫자·걸린 시간은 하나도 안 건드린다.
   */
  if (뺄것.length) {
    줄 = 줄.filter((l) => {
      const 민 = l.replace(/\x1b\[[0-9;]*m/g, '');
      return !뺄것.some((무늬) => 무늬.test(민));
    });
  }
  while (줄.length && !줄[0].replace(/\x1b\[[0-9;]*m/g, '').trim()) 줄.shift();
  while (줄.length && !줄.at(-1).replace(/\x1b\[[0-9;]*m/g, '').trim()) 줄.pop();
  return 줄.slice(0, 최대줄).join('\n');
}

function 내기(이름, 글, 제목, 창이름) {
  const 줄들 = 풀기(글);
  for (const 갈래 of ['light', 'dark']) {
    const svg = 그리기(줄들, { 제목, 갈래, 이름: 창이름 });
    const 자리 = join(나갈곳, `${이름}-${갈래}.svg`);
    writeFileSync(자리, svg, 'utf8');
    console.log(`  ${이름}-${갈래}.svg  ${(svg.length / 1024).toFixed(1)}KB · ${줄들.length}줄`);
  }
}

// ── 무엇을 찍나 ─────────────────────────────────────────────────────────

mkdirSync(나갈곳, { recursive: true });
const home = mkdtempSync(join(tmpdir(), 'deel-shot-home-'));
const work = mkdtempSync(join(tmpdir(), 'deel-shot-work-'));

try {
  /*
   * 1) `deel reset` — 무엇이 얼마나 있는지.
   *
   * 살림을 차려 놓고 찍는다. 빈 폴더에서 찍으면 0 만 늘어선 그림이 되어
   * 이 명령이 무엇을 하는지가 안 보인다.
   */
  {
    mkdirSync(join(work, '.deel', 'sessions'), { recursive: true });
    mkdirSync(join(work, '.deel', 'history'), { recursive: true });
    mkdirSync(join(work, '.deel', '증거'), { recursive: true });
    mkdirSync(join(home, 'plugins', 'wiki-kit'), { recursive: true });
    mkdirSync(join(home, 'plugins', 'jira-kit'), { recursive: true });
    mkdirSync(join(home, 'plugins', 'sabun-kit'), { recursive: true });
    writeFileSync(join(home, 'config.json'), JSON.stringify({
      version: 1,
      active: 'gw',
      profiles: [
        { id: 'gw', name: 'gateway', kind: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'dpapi:QUFB', model: 'qwen2.5-coder:7b' },
        { id: 'small', name: 'small', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', apiKey: '', model: 'qwen2.5:1.5b' },
      ],
    }, null, 2), 'utf8');
    writeFileSync(join(home, '배운것.json'), '{}', 'utf8');
    writeFileSync(join(work, '.deel', '배운것.json'), '{}', 'utf8');
    writeFileSync(join(work, '.deel', 'memory.md'), Array.from({ length: 8 }, (_, i) => `- note ${i + 1}`).join('\n'), 'utf8');
    for (let i = 0; i < 14; i++) writeFileSync(join(work, '.deel', 'sessions', `2026090${i % 9}-0${i % 9}0000.jsonl`), '{}\n', 'utf8');
    writeFileSync(join(work, '.deel', 'history', 'edits.jsonl'), '{"e":1}\n'.repeat(41), 'utf8');
    writeFileSync(join(work, '.deel', 'audit.jsonl'), '{"a":1}\n'.repeat(1203), 'utf8');
    writeFileSync(join(work, '.deel', 'mcp.json'), '{}', 'utf8');
    writeFileSync(join(work, '.deelignore'), 'build/\n', 'utf8');
    for (const f of ['a.md', 'b.md', 'c.md']) writeFileSync(join(work, '.deel', '증거', f), 'x\n', 'utf8');

    const 글 = await 띄우기(['reset'], { home, cwd: work, cols: 76 });
    내기('shot-reset', 다듬기(길다듬기(글, { home, work })),
      'deel reset — shows what exists, deletes nothing', 'deel reset');
  }

  // 2) `deel audit` — 사내 심사에 그대로 내는 장.
  {
    const 글 = await 띄우기(['audit'], { home, cwd: work, cols: 78 });
    내기('shot-audit', 다듬기(길다듬기(글, { home, work }), { 최대줄: 34 }),
      'deel audit — the corporate review sheet', 'deel audit');
  }

  /*
   * 3) 대화 화면 — 이 프로그램이 무엇인지 한 장으로 보이는 그림.
   *
   * 영어판과 한국어판을 따로 찍는다. 대화 화면은 통째로 옮겨져 있어서
   * `DEEL_LANG` 만 바꾸면 된다. (설정·심사 화면은 아직 한국어뿐이라
   * 영어 README 에는 이 그림만 쓴다.)
   */
  {
    const { srv, port, 처음부터 } = await 스텁띄우기();
    /*
     * 이름을 정해 놓고 만든다 (mkdtemp 가 아니라).
     *
     * 머리 상자의 「폴더」 줄은 폭에 맞춰 잘린다. mkdtemp 가 붙이는 무작위
     * 꼬리까지 들어가면 그 줄이 `…` 로 끝나 버려서, 나중에 이름을 예쁘게
     * 바꾸려 해도 찾을 글자가 안 남는다. 짧게 지어야 안 잘린다.
     */
    const 방 = join(tmpdir(), 'myproject');
    const 집 = join(tmpdir(), 'deel-shot-home');
    rmSync(방, { recursive: true, force: true });
    rmSync(집, { recursive: true, force: true });
    mkdirSync(방, { recursive: true });
    mkdirSync(집, { recursive: true });
    try {
      mkdirSync(join(방, 'src'), { recursive: true });
      writeFileSync(join(방, 'src', 'runner.js'),
        "export function run() {\n  console.log('run start')\n  return 0\n}\n", 'utf8');
      writeFileSync(join(집, 'config.json'), JSON.stringify({
        version: 1, active: 'local', level: '개발자',
        profiles: [{
          id: 'local', name: 'local', kind: 'openai',
          baseUrl: `http://127.0.0.1:${port}/v1`, auth: 'none', apiKey: '',
          model: 'qwen2.5-coder:7b', ctx: 131072, streaming: false, tools: true,
        }],
      }, null, 2), 'utf8');

      for (const [말, 시킬말] of [['en', 'unify the logging style'], ['ko', '로그 형식을 통일해줘']]) {
        처음부터(말);
        // 고친 파일을 되돌려 놓는다. 앞판이 이미 고쳐 놨으면 다음 판의
        // Edit 는 「찾을 것이 없다」 가 되어 그림이 달라진다.
        writeFileSync(join(방, 'src', 'runner.js'),
          "export function run() {\n  console.log('run start')\n  return 0\n}\n", 'utf8');

        const 글 = 길다듬기(await 띄우기(['--no-tui', '--mode', 'auto'], {
          home: 집, cwd: 방, cols: 78, env: { DEEL_LANG: 말 }, 입력: [시킬말, '/exit'],
        }), { home: 집, work: 방 });

        내기(`shot-chat-${말}`, 다듬기(글, {
          자를것: /╭|┌/, 최대줄: 28,
          뺄것: [/스트리밍이 없어|no streaming, so answers/i],
        }),
          말 === 'en' ? 'deel — a task from start to finish' : 'deel — 시킨 일 한 바퀴', 'deel');

        /*
         * 머리 상자만 따로 한 장.
         *
         * 이 상자는 통째로 옮겨져 있다 — 「어디로 보내는가」 를 한 줄로
         * 답하는 자리라, 이 프로그램을 처음 보는 사람에게 제일 먼저 보여야
         * 할 그림이다. 그 아래 대화 줄은 아직 우리말이 섞여 나와서, 영어
         * 문서에는 이 상자만 쓴다.
         */
        const 줄 = 글.split('\n');
        const 시작 = 줄.findIndex((l) => l.includes('╭'));
        const 끝 = 줄.findIndex((l) => l.includes('╰'));
        if (시작 >= 0 && 끝 > 시작) {
          내기(`shot-head-${말}`, 줄.slice(시작, 끝 + 1).join('\n'),
            말 === 'en' ? 'deel — where your code can go, in one line' : 'deel — 어디로 나가는지 한 줄로',
            'deel');
        }
      }
    } finally {
      srv.close();
      rmSync(방, { recursive: true, force: true });
      rmSync(집, { recursive: true, force: true });
    }
  }
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n  ${나갈곳} 에 넣었습니다.`);
