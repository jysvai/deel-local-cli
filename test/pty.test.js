// 진짜 터미널(pty) 안의 대화 화면 검사.
//
// 왜 이 파일이 필요한가:
//   대화 화면 검사는 전부 가짜 TTY 흐름(PassThrough 에 isTTY 를 붙인 것)으로 돈다. 그러면 날것 모드
//   (raw mode)를 켜고 끄는 일, 커널이 보내는 창 크기 신호, 끝난 뒤 터미널이 원래대로 돌아오는지는 한 번도
//   안 밟힌다. 44회차에 맥·리눅스 러너에서 진짜 pty 로 처음 몰아 봤다 — 고칠 것은 없었지만, 그 길을 지키는
//   검사가 관문에 하나도 없었다.
//
//   pty 는 node 만으로 못 연다(의존성 0개). 맥·리눅스에 기본으로 있는 python3 의 pty 모듈로 bash 를 띄우고,
//   그 안에서 deel 을 키 입력으로 몬다. 윈도우나 python3 가 없는 곳에서는 건너뛴다.
//
//   무엇을 보나: 한글 지우기 · 여러 줄 붙여넣기가 한 말로 · 창 크기 바꾸기 · 답이 흐르는 중 Ctrl+C ·
//   Ctrl+D · 그리고 판마다 **끝난 뒤 터미널이 원래대로**(icanon · echo) 돌아왔나.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const skip = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 건너뜀 = (name, 왜) => skip.push({ name, 왜 });
const 진입점 = resolve('bin', 'deel.js');

/*
 * pty 를 모는 쪽 — python3. 단계마다 키를 넣고, 화면에 원하는 글이 뜰 때까지 기다린다.
 * 다 끝나면 {results, tail} 을 JSON 한 줄로 낸다. 화면을 안 읽으면 pty 버퍼가 차서 안쪽 셸이
 * 멈추므로(맥 zpty 에서 겪은 것과 같다) 기다리는 동안 늘 읽어 비운다.
 */
const 모는것 = String.raw`
import json, os, pty, re, select, signal, struct, sys, time, fcntl, termios
spec = json.load(open(sys.argv[1], encoding='utf-8'))
pid, fd = pty.fork()
if pid == 0:
    os.execvpe('bash', ['bash', '--norc', '--noprofile', '-i'], dict(os.environ, PS1='$ ', TERM='xterm-256color'))
def setsize(rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
setsize(30, 100)
buf = b''
mark = 0
def pump(t):
    global buf
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try:
                d = os.read(fd, 65536)
            except OSError:
                return
            if not d:
                return
            buf += d
def wait(pat, t):
    rx = re.compile(pat.encode('utf-8'))
    end = time.time() + t
    while time.time() < end:
        if rx.search(buf[mark:]):
            return True
        pump(0.1)
    return bool(rx.search(buf[mark:]))
results = []
pump(1.0)
for st in spec['steps']:
    if 'winsize' in st:
        setsize(*st['winsize'])
    if st.get('mark'):
        mark = len(buf)
    if 'type' in st:
        for ch in st['type']:
            os.write(fd, ch.encode('utf-8'))
            pump(0.03)
    if 'send' in st:
        os.write(fd, st['send'].encode('utf-8'))
    if 'sleep' in st:
        pump(st['sleep'])
    if 'wait' in st:
        ok = wait(st['wait'], st.get('timeout', 20))
        results.append({'name': st.get('name', st['wait']), 'ok': ok})
pump(1.0)
try:
    os.kill(pid, signal.SIGKILL)
except Exception:
    pass
print(json.dumps({'results': results, 'tail': buf[-8000:].decode('utf-8', 'replace'), 'all': buf.decode('utf-8', 'replace')}, ensure_ascii=False))
`;

const python있나 = process.platform !== 'win32'
  && spawnSync('python3', ['-c', 'import pty, fcntl, termios'], { timeout: 15000 }).status === 0
  && spawnSync('bash', ['-c', 'true'], { timeout: 15000 }).status === 0;

if (!python있나) {
  건너뜀('진짜 pty 에서 대화 화면 몰기', process.platform === 'win32' ? '윈도우에는 pty 가 없습니다' : 'python3(pty) 또는 bash 가 없습니다');
} else {
  /*
   * 가짜 게이트웨이 — 받은 사용자 말을 적고 「받았습니다:N자」 로 답한다. 말에 「느리게」 가 있으면
   * 천천히 흘린다(그 사이에 Ctrl+C). 대화가 아닌 요청(켤 때의 모델 정보 묻기)은 404 로 돌려보낸다.
   */
  let 받은말 = [];
  const 서버 = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'fake-7b' }] }));
      }
      if (!req.url.includes('chat/completions')) { res.writeHead(404); return res.end(); }
      let 말 = '';
      try {
        const u = [...(JSON.parse(body).messages ?? [])].reverse().find((m) => m.role === 'user');
        말 = typeof u?.content === 'string' ? u.content : JSON.stringify(u?.content ?? '');
      } catch { /* 아래에서 빈 말로 잰다 */ }
      받은말.push(말);
      const 답 = `받았습니다:${[...말].length}자`;
      const 느림 = 말.includes('느리게');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const 조각들 = 느림 ? Array.from({ length: 30 }, (_, i) => `천천히${i} `) : [답];
      for (const p of 조각들) {
        if (res.destroyed) return;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
        if (느림) await new Promise((r) => setTimeout(r, 200));
      }
      if (res.destroyed) return;
      if (느림) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ` ${답}` } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise((r) => 서버.listen(0, '127.0.0.1', r));
  const 포트 = 서버.address().port;
  const 모는파일방 = mkdtempSync(join(tmpdir(), 'deel-pty-drive-'));
  const 모는파일 = join(모는파일방, 'drive.py');
  writeFileSync(모는파일, 모는것, 'utf8');

  /** 한 판 — bash 안에서 deel 을 띄우고 걸음들을 친 뒤, 끝난 종료코드와 stty 를 읽는다. */
  const 판 = async (걸음들, { 인자 = '', 설정 = true, 켜짐 = 'fake-7b', 환경 = '' } = {}) => {
    받은말 = [];
    const 일터 = mkdtempSync(join(tmpdir(), 'deel-pty-'));
    const 집 = join(일터, 'home');
    mkdirSync(집, { recursive: true });
    if (설정) writeFileSync(join(집, 'config.json'), JSON.stringify({
      version: 1, active: 'gw',
      profiles: [{ id: 'gw', name: '가짜', kind: 'openai', baseUrl: `http://127.0.0.1:${포트}/v1`, auth: 'bearer', apiKey: 'k', model: 'fake-7b', ctx: 32000, streaming: true, tools: false }],
    }));
    const 명령 = `cd '${일터}' && DEEL_HOME='${집}' DEEL_NET_ALLOW='http://127.0.0.1:${포트}/v1' DEEL_NO_OPEN=1 ${환경} '${process.execPath}' '${진입점}' ${인자}; `
      + `echo "EXIT=$?"; stty -a | tr '\\n' ' '; echo; echo END-OF-RUN\r`;
    const 걸음표 = join(일터, 'spec.json');
    writeFileSync(걸음표, JSON.stringify({
      steps: [
        { send: 명령, mark: true, wait: 켜짐, timeout: 30, name: '켜짐' }, { sleep: 1.5 },
        ...걸음들,
        { wait: 'END-OF-RUN', timeout: 25, name: '끝까지' },
      ],
    }));
    const 결과 = await new Promise((done) => {
      const k = spawn('python3', [모는파일, 걸음표], { stdio: ['ignore', 'pipe', 'pipe'] });
      let o = ''; let e = '';
      k.stdout.on('data', (b) => { o += b; });
      k.stderr.on('data', (b) => { e += b; });
      const 시계 = setTimeout(() => k.kill('SIGKILL'), 120000);
      k.on('close', () => {
        clearTimeout(시계);
        try { done(JSON.parse(o)); } catch { done({ results: [], tail: `모는 쪽 탈: ${e.slice(0, 300)} ${o.slice(0, 300)}` }); }
      });
    });
    let 저장된 = null;
    try { 저장된 = JSON.parse(readFileSync(join(집, 'config.json'), 'utf8')); } catch { /* 없음 */ }
    rmSync(일터, { recursive: true, force: true });
    const 꼬리 = 결과.tail.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    const stty = /(-?icanon)\b.*?\s(-?echo)\s/.exec(꼬리) ?? [];
    return {
      걸음: Object.fromEntries(결과.results.map((r) => [r.name, r.ok])),
      종료: /EXIT=(\d+)/.exec(꼬리)?.[1],
      복구됨: stty[1] === 'icanon' && stty[2] === 'echo',
      stty: `${stty[1] ?? '?'} ${stty[2] ?? '?'}`,
      받은말: [...받은말],
      꼬리: 꼬리.slice(-500),
      화면: String(결과.all ?? 결과.tail),
      저장된: 설정 ? null : 저장된,
    };
  };
  const 덧 = (r) => `켜짐=${r.걸음.켜짐} · ${JSON.stringify(r.받은말)} · EXIT=${r.종료} · ${r.stty} · ${JSON.stringify(r.꼬리.slice(-200))}`;

  trace('1-기본');
  {
    const r = await 판([{ type: '안녕하세요\r', wait: '받았습니다:5자', name: '답' }, { type: '/exit\r' }]);
    check('★★ 진짜 pty: 말하면 답이 오고 /exit 는 0 으로 끝난다', r.걸음.답 && r.종료 === '0' && r.받은말[0] === '안녕하세요', 덧(r));
    check('★★ 진짜 pty: 끝난 뒤 터미널이 원래대로다 (icanon · echo)', r.복구됨, 덧(r));
  }

  trace('2-한글-지우기');
  {
    const r = await 판([
      { type: '가나다' }, { send: '\x7f', sleep: 0.2 }, { send: '\x7f', sleep: 0.2 },
      { type: '라\r', wait: '받았습니다:2자', name: '답' }, { type: '/exit\r' },
    ]);
    check('★ 진짜 pty: 「가나다」 ⌫⌫ 「라」 는 「가라」 로 간다 (한글 한 글자씩 지운다)', r.받은말[0] === '가라' && r.복구됨, 덧(r));
  }

  trace('3-붙여넣기');
  {
    const r = await 판([
      { send: '\x1b[200~줄하나\n줄둘\x1b[201~', sleep: 0.5 },
      { type: '\r', wait: '받았습니다:', name: '답' }, { type: '/exit\r' },
    ]);
    check('★★ 진짜 pty: 여러 줄 붙여넣기는 한 말로 간다 (줄마다 따로 안 보낸다)',
      r.받은말.length === 1 && r.받은말[0] === '줄하나\n줄둘' && r.복구됨, 덧(r));
  }

  trace('4-창-크기');
  {
    const r = await 판([
      { type: '첫말\r', wait: '받았습니다:2자', name: '첫 답' },
      { winsize: [12, 30], sleep: 0.8 },
      { type: '둘째말\r', wait: '받았습니다:3자', name: '좁힌 뒤' },
      { winsize: [50, 200], sleep: 0.8 },
      { type: '셋째말이다\r', wait: '받았습니다:5자', name: '넓힌 뒤' },
      { type: '/exit\r' },
    ]);
    check('★ 진짜 pty: 창을 좁혔다 넓혀도 말이 다 가고 0 으로 끝난다',
      r.받은말.length === 3 && r.종료 === '0' && r.복구됨, 덧(r));
  }

  trace('5-흐르는-중-Ctrl+C');
  {
    const r = await 판([
      { type: '느리게 말해줘\r', sleep: 1.5 }, { send: '\x03', sleep: 1.5 },
      { type: '다음말\r', wait: '받았습니다:3자', name: '다음 답' }, { type: '/exit\r' },
    ]);
    check('★★ 진짜 pty: 답이 흐르는 중 Ctrl+C 는 그 답만 끊고, 다음 말을 받는다',
      r.받은말.includes('다음말') && r.종료 === '0' && r.복구됨, 덧(r));
  }

  trace('6-Ctrl+D');
  {
    const r = await 판([{ send: '\x04', sleep: 1.5 }]);
    check('★ 진짜 pty: 빈 입력에서 Ctrl+D 는 나가고 터미널을 돌려놓는다', r.종료 !== undefined && r.복구됨, 덧(r));
  }

  /*
   * ── deel setup — 물음은 readline 이 아니라 날것 모드를 **직접** 켜고 끈다(ui/prompt.js) ──────
   *
   * 그래서 중간에 Ctrl+C 로 나가면 터미널이 날것인 채로 남을 위험이 대화 화면보다 크다. 열쇠 물음은
   * ● 로 가리므로 화면에 열쇠가 비치면 안 되고, 화살표(무시)·한글·지우기가 섞여도 친 그대로 저장돼야
   * 한다. 열쇠 보관은 꺼서(DEEL_KEYSTORE=off) 설정 파일에 남은 값으로 잰다 — 여기서 보는 것은 입력이다.
   */
  const 주소 = `http://127.0.0.1:${포트}/v1`;
  const 셋업 = { 인자: 'setup', 설정: false, 켜짐: '어디에 붙일까요', 환경: 'DEEL_KEYSTORE=off' };

  trace('7-setup-번호에서-Ctrl+C');
  {
    const r = await 판([{ send: '\x03', sleep: 1 }], 셋업);
    check('★★ 진짜 pty: setup 첫 물음에서 Ctrl+C 는 130 으로 나가고 터미널을 돌려놓는다', r.종료 === '130' && r.복구됨 && !r.저장된, 덧(r));
  }

  trace('8-setup-열쇠-치다가-Ctrl+C');
  {
    const r = await 판([
      { type: '2\r', wait: '주소', name: '주소 물음' },
      { send: `${주소}\r`, wait: 'API 키', name: '열쇠 물음' },
      { type: 'sk-abc' }, { send: '\x03', sleep: 1 },
    ], 셋업);
    check('★★ 진짜 pty: 열쇠를 치다 Ctrl+C — 130 · 터미널 복구 · 아무것도 안 저장', r.종료 === '130' && r.복구됨 && !r.저장된, 덧(r));
    check('★★ 진짜 pty: 친 열쇠가 화면에 한 글자도 안 비친다 (● 로 가림)', !r.화면.includes('sk-abc') && r.화면.includes('●'), JSON.stringify(r.화면.slice(-300)));
  }

  trace('9-setup-끝까지');
  {
    const r = await 판([
      { type: '2\r', wait: '주소', name: '주소 물음' },
      { send: `${주소}\r`, wait: 'API 키', name: '열쇠 물음' },
      { type: 'sk-pty-' }, { send: '\x1b[D', sleep: 0.2 }, { type: '열쇠' }, { send: '\x7f', sleep: 0.2 }, { type: '쇠\r', wait: '이름', name: '이름 물음' },
      { type: '\r', wait: '사용할 모델', timeout: 30, name: '모델 물음' },
      { type: '\r', wait: '저장됨', timeout: 30, name: '저장' },
    ], 셋업);
    const 열쇠 = r.저장된?.profiles?.[0]?.apiKey;
    check('★★ 진짜 pty: setup 을 끝까지 — 화살표는 무시하고 한글 지우기까지 친 그대로 저장한다',
      r.걸음.저장 && 열쇠 === 'sk-pty-열쇠' && r.종료 === '0' && r.복구됨, `열쇠=${JSON.stringify(열쇠)} · ${덧(r)}`);
    check('  끝까지 가도 열쇠가 화면에 안 비친다', !r.화면.includes('sk-pty'), '');
  }

  서버.close();
  rmSync(모는파일방, { recursive: true, force: true });
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n진짜 터미널(pty) 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
for (const s of skip) console.log(`  ${Y}－${X} ${s.name}  ${D}${s.왜}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패${skip.length ? ` · ${skip.length}개 건너뜀` : ''}\n`);
process.exitCode = fail.length ? 1 : 0;
