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
//   Ctrl+D · 도구 승인 물음(y · ㅇ · n · ESC · Ctrl+C) · Ctrl+Z 로 재웠다 fg 로 깨우기(입력칸 · 흐르는 중 ·
//   승인 물음 중 · 고아 그룹) — 줄 화면과 상자 화면 둘 다 — 그리고 deel setup(Ctrl+C · 가린 열쇠).
//   판마다 **끝난 뒤 터미널이 원래대로**(icanon · echo) 돌아왔나.
//
//   한 판이 리눅스에서 3분 반쯤이다 — test/검사시간.json 에 적어 둬야 어긋내기 조각이 고르게 나뉜다.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
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
    if 'tty' in st:
        a = termios.tcgetattr(fd)
        results.append({'name': st['tty'], 'ok': True, 'mode': ('icanon' if a[3] & termios.ICANON else '-icanon') + ' ' + ('echo' if a[3] & termios.ECHO else '-echo')})
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
  let 도구결과 = [];
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
      let 끝 = null;
      try {
        const 말들 = JSON.parse(body).messages ?? [];
        끝 = 말들[말들.length - 1];
        const u = [...말들].reverse().find((m) => m.role === 'user');
        말 = typeof u?.content === 'string' ? u.content : JSON.stringify(u?.content ?? '');
      } catch { /* 아래에서 빈 말로 잰다 */ }
      const 보내기 = (delta, 끝남 = null) => res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 끝남 }] })}\n\n`);
      /*
       * 승인 물음을 띄우려면 모델이 도구를 불러야 한다. 도구 결과가 돌아오면 그 글을 적어 두고(거부됐나 ·
       * 만들었나) 짧게 답한다. 「파일써줘」 에는 Write 한 번을 낸다 — 승인 방식이 엄격이면 물음이 뜬다.
       */
      if (끝?.role === 'tool') {
        도구결과.push(String(끝.content ?? '').slice(0, 120));
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        보내기({ content: '도구결과받음' }); 보내기({}, 'stop');
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      받은말.push(말);
      if (말.includes('파일써줘')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        보내기({ tool_calls: [{ index: 0, id: `call_${받은말.length}`, type: 'function', function: { name: 'Write', arguments: JSON.stringify({ file_path: '승인.txt', content: '써짐' }) } }] });
        보내기({}, 'tool_calls');
        res.write('data: [DONE]\n\n');
        return res.end();
      }
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
  const 판 = async (걸음들, { 인자 = '', 설정 = true, 켜짐 = 'fake-7b', 환경 = '', 상자 = false, 도구 = false, 끝 = true, exec = false } = {}) => {
    받은말 = [];
    도구결과 = [];
    const 일터 = mkdtempSync(join(tmpdir(), 'deel-pty-'));
    const 집 = join(일터, 'home');
    mkdirSync(집, { recursive: true });
    if (설정) writeFileSync(join(집, 'config.json'), JSON.stringify({
      version: 1, active: 'gw',
      profiles: [{ id: 'gw', name: '가짜', kind: 'openai', baseUrl: `http://127.0.0.1:${포트}/v1`, auth: 'bearer', apiKey: 'k', model: 'fake-7b', ctx: 32000, streaming: true, tools: 도구 }],
    }));
    const 명령 = `${상자 ? 'unset CI GITHUB_ACTIONS; ' : 'export CI=1; '}cd '${일터}' && DEEL_HOME='${집}' DEEL_NET_ALLOW='http://127.0.0.1:${포트}/v1' DEEL_NO_OPEN=1 ${환경} ${exec ? 'exec ' : ''}'${process.execPath}' '${진입점}' ${인자}; `
      + `echo "EXIT=$?"; stty -a | tr '\\n' ' '; echo; echo END-OF-"RUN"\r`;
    const 걸음표 = join(일터, 'spec.json');
    writeFileSync(걸음표, JSON.stringify({
      steps: [
        { send: 명령, mark: true, wait: 켜짐, timeout: 30, name: '켜짐' }, { sleep: 1.5 },
        ...걸음들,
        ...(끝 ? [{ wait: 'END-OF-RUN', timeout: 25, name: '끝까지' }] : []),
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
    const 썼나 = existsSync(join(일터, '승인.txt'));
    rmSync(일터, { recursive: true, force: true });
    const 꼬리 = 결과.tail.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    const stty = /(-?icanon)\b.*?\s(-?echo)\s/.exec(꼬리) ?? [];
    return {
      걸음: Object.fromEntries(결과.results.map((r) => [r.name, r.ok])),
      모드: Object.fromEntries(결과.results.filter((r) => r.mode).map((r) => [r.name, r.mode])),
      종료: /EXIT=(\d+)/.exec(꼬리)?.[1],
      복구됨: stty[1] === 'icanon' && stty[2] === 'echo',
      stty: `${stty[1] ?? '?'} ${stty[2] ?? '?'}`,
      받은말: [...받은말],
      도구결과: [...도구결과],
      썼나,
      꼬리: 꼬리.slice(-500),
      화면: String(결과.all ?? 결과.tail),
      화면글: String(결과.all ?? 결과.tail).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''),
      저장된: 설정 ? null : 저장된,
    };
  };
  const 덧 = (r) => `켜짐=${r.걸음.켜짐} · ${JSON.stringify(r.받은말)} · EXIT=${r.종료} · ${r.stty} · ${JSON.stringify(r.꼬리.slice(-200))}`;

  /*
   * ── 줄 화면과 상자 화면, 둘 다 ──────────────────────────────────────────
   *
   * CI 환경변수가 있으면 deel 은 일부러 상자를 끄고 줄 화면으로 뜬다(ui/screen.js 의 상자쓸까). GitHub
   * 러너는 CI 를 갖고 있어서, 처음 넣은 이 검사는 **사람들이 실제로 보는 상자 입력칸을 한 번도 안 밟았다.**
   * 그래서 같은 판을 두 화면으로 돌린다 — 줄 화면은 CI=1 로 못 박고, 상자 화면은 CI 를 지운다.
   */
  for (const 상자 of [false, true]) {
    const 이름 = 상자 ? '상자 화면' : '줄 화면';
    const 판에 = (걸음들) => 판(걸음들, { 상자 });

    trace(`1-기본 (${이름})`);
    {
      const r = await 판에([{ type: '안녕하세요\r', wait: '받았습니다:5자', name: '답' }, { type: '/exit\r' }]);
      check(`★★ 진짜 pty (${이름}): 말하면 답이 오고 /exit 는 0 으로 끝난다`, r.걸음.답 && r.종료 === '0' && r.받은말[0] === '안녕하세요', 덧(r));
      check(`★★ 진짜 pty (${이름}): 끝난 뒤 터미널이 원래대로다 (icanon · echo)`, r.복구됨, 덧(r));
      check(`  진짜 pty (${이름}): ${상자 ? '상자 입력칸이 켜졌다 (│ ❯)' : '상자 없이 줄로 흐른다'}`, 상자 === r.화면글.includes('│ ❯ '), JSON.stringify(r.화면글.slice(-200)));
    }

    trace(`2-한글-지우기 (${이름})`);
    {
      const r = await 판에([
        { type: '가나다' }, { send: '\x7f', sleep: 0.2 }, { send: '\x7f', sleep: 0.2 },
        { type: '라\r', wait: '받았습니다:2자', name: '답' }, { type: '/exit\r' },
      ]);
      check(`★ 진짜 pty (${이름}): 「가나다」 ⌫⌫ 「라」 는 「가라」 로 간다 (한글 한 글자씩 지운다)`, r.받은말[0] === '가라' && r.복구됨, 덧(r));
    }

    trace(`3-붙여넣기 (${이름})`);
    {
      const r = await 판에([
        { send: '\x1b[200~줄하나\n줄둘\x1b[201~', sleep: 0.5 },
        { type: '\r', wait: '받았습니다:', name: '답' }, { type: '/exit\r' },
      ]);
      check(`★★ 진짜 pty (${이름}): 여러 줄 붙여넣기는 한 말로 간다 (줄마다 따로 안 보낸다)`,
        r.받은말.length === 1 && r.받은말[0] === '줄하나\n줄둘' && r.복구됨, 덧(r));
    }

    trace(`4-창-크기 (${이름})`);
    {
      const r = await 판에([
        { type: '첫말\r', wait: '받았습니다:2자', name: '첫 답' },
        { winsize: [12, 30], sleep: 0.8 },
        { type: '둘째말\r', wait: '받았습니다:3자', name: '좁힌 뒤' },
        { winsize: [50, 200], sleep: 0.8 },
        { type: '셋째말이다\r', wait: '받았습니다:5자', name: '넓힌 뒤' },
        { type: '/exit\r' },
      ]);
      check(`★ 진짜 pty (${이름}): 창을 좁혔다 넓혀도 말이 다 가고 0 으로 끝난다`,
        r.받은말.length === 3 && r.종료 === '0' && r.복구됨, 덧(r));
    }

    trace(`5-흐르는-중-Ctrl+C (${이름})`);
    {
      const r = await 판에([
        { type: '느리게 말해줘\r', sleep: 1.5 }, { send: '\x03', sleep: 1.5 },
        { type: '다음말\r', wait: '받았습니다:3자', name: '다음 답' }, { type: '/exit\r' },
      ]);
      check(`★★ 진짜 pty (${이름}): 답이 흐르는 중 Ctrl+C 는 그 답만 끊고, 다음 말을 받는다`,
        r.받은말.includes('다음말') && r.종료 === '0' && r.복구됨, 덧(r));
    }

    trace(`6-Ctrl+D (${이름})`);
    {
      const r = await 판에([{ send: '\x04', sleep: 1.5 }]);
      check(`★ 진짜 pty (${이름}): 빈 입력에서 Ctrl+D 는 나가고 터미널을 돌려놓는다`, r.종료 !== undefined && r.복구됨, 덧(r));
    }

    /*
     * ── Ctrl+Z 로 재웠다가 fg 로 깨우기 ─────────────────────────────────
     *
     * 셸이 프로세스를 재우면 날것 모드가 풀린 채 셸로 돌아가야 하고, fg 로 깨우면 다시 날것 모드로 들어가
     * 입력칸을 다시 그려야 한다. 그 순간의 모드를 pty 에서 직접 읽는다. 처음 재 보니 fg 하자마자 deel 이
     * **조용히 끝났다** — 이어 친 글을 셸이 명령으로 받았다(repl.js 의 SIGTSTP 머리말).
     *
     * 재우면 bash 는 명령줄의 나머지(EXIT · stty · END-OF-RUN)를 곧바로 돌린다. 그래서 이 판은 그 값을
     * 안 읽고, fg 가 끝난 뒤 deel 의 종료코드와 터미널 모드를 따로 찍게 한다.
     */
    const fg끝 = { send: 'echo "FG=$?"; stty -a | tr \'\\n\' \' \'; echo; echo END-OF-"FG"\r', wait: 'END-OF-FG', timeout: 15, name: 'fg 끝' };
    const fg읽기 = (r) => {
      const 끝 = /FG=(\d+)[\s\S]*?(-?icanon)\b[\s\S]*?\s(-?echo)\s/.exec(r.화면글) ?? [];
      const 재운앞 = r.화면.slice(0, Math.max(0, r.화면.search(/Stopped|Suspended/)));
      const 나중 = (켬, 끔) => 재운앞.lastIndexOf(끔) >= 재운앞.lastIndexOf(켬);
      return {
        종료: 끝[1],
        복구됨: 끝[2] === 'icanon' && 끝[3] === 'echo',
        // 잠들기 직전에 deel 이 마지막으로 보낸 것이 「끔」 이어야 셸이 그걸 안 물려받는다.
        붙여넣기껐나: 재운앞.includes('\x1b[?2004h') && 나중('\x1b[?2004h', '\x1b[?2004l'),
        커서보이나: 나중('\x1b[?25l', '\x1b[?25h'),
      };
    };

    trace(`7-Ctrl+Z-fg (${이름})`);
    {
      const r = await 판([
        { tty: '켠 뒤' },
        { send: '\x1a', wait: 'Stopped|Suspended', timeout: 10, name: '재움' },
        { send: 'fg\r', mark: true, sleep: 2 },
        { tty: 'fg 뒤' },
        // 모는 쪽은 날것 바이트에서 찾는다 — 상자의 │ 와 ❯ 사이에는 색 바꿈이 끼므로 건너뛰게 둔다.
        // 키를 치기 **전**이라 여기서 보이는 상자는 깨어난 자리에서 새로 그린 것뿐이다.
        ...(상자 ? [{ wait: String.raw`│(?:\x1b\[[0-9;]*m)* (?:\x1b\[[0-9;]*m)*❯`, timeout: 5, name: '상자 다시' }] : []),
        { type: '가나다' }, { send: '\x7f', sleep: 0.2 }, { send: '\x7f', sleep: 0.2 },
        { type: '라\r', wait: '받았습니다:2자', name: '깨운 뒤 답' }, { type: '/exit\r', sleep: 1.5 }, fg끝,
      ], { 상자, 끝: false });
      const f = fg읽기(r);
      const 재움덧 = `모드=${JSON.stringify(r.모드)} · 걸음=${JSON.stringify(r.걸음)} · fg=${JSON.stringify(f)} · ${JSON.stringify(r.받은말)} · ${JSON.stringify(r.화면글.slice(-300))}`;
      check(`★★ 진짜 pty (${이름}): Ctrl+Z 로 재우면 셸로 돌아간다`, r.걸음.재움 && r.모드['켠 뒤'] === '-icanon -echo', 재움덧);
      check(`★ 진짜 pty (${이름}): 잠들기 전에 붙여넣기 표지를 끄고 커서를 보이게 둔다 — 셸이 물려받지 않게`, f.붙여넣기껐나 && f.커서보이나, 재움덧);
      check(`★★ 진짜 pty (${이름}): fg 로 깨우면 다시 날것 모드다 — 한글 지우기까지 그대로 받는다`,
        r.모드['fg 뒤'] === '-icanon -echo' && r.받은말.at(-1) === '가라', 재움덧);
      check(`★★ 진짜 pty (${이름}): 깨운 뒤 /exit 는 0 으로 끝나고 터미널이 원래대로다`, r.걸음['fg 끝'] && f.종료 === '0' && f.복구됨, 재움덧);
      if (상자) check(`  진짜 pty (${이름}): 깨우면 상자 입력칸을 다시 그린다`, r.걸음['상자 다시'], 재움덧);
    }

    trace(`7-흐르는-중-Ctrl+Z (${이름})`);
    {
      const r = await 판([
        { type: '느리게 말해줘\r', sleep: 1 },
        { send: '\x1a', wait: 'Stopped|Suspended', timeout: 10, name: '재움' },
        { sleep: 1 }, { send: 'fg\r', mark: true },
        { wait: '받았습니다:7자', timeout: 20, name: '흐르던 답 끝' },
        { type: '다음말\r', wait: '받았습니다:3자', name: '다음 답' }, { type: '/exit\r', sleep: 1.5 }, fg끝,
      ], { 상자, 끝: false });
      const f = fg읽기(r);
      check(`★ 진짜 pty (${이름}): 답이 흐르는 중 재웠다 깨워도 답을 끝까지 받고 다음 말로 간다`,
        r.걸음.재움 && r.걸음['흐르던 답 끝'] && r.받은말.at(-1) === '다음말' && f.종료 === '0' && f.복구됨 && f.커서보이나,
        `걸음=${JSON.stringify(r.걸음)} · fg=${JSON.stringify(f)} · ${JSON.stringify(r.받은말)} · ${JSON.stringify(r.화면글.slice(-300))}`);
    }

    trace(`7-승인-물음-중-Ctrl+Z (${이름})`);
    {
      // 물음은 readline 이 아니라 우리가 찍은 글이다 — 깨울 때 우리가 안 되찍으면 줄 화면에서 물음이 사라진다.
      const r = await 판([
        { type: '/mode strict\r', wait: '모두 확인', name: '엄격' },
        { type: '파일써줘\r', wait: '실행할까요', name: '물음' },
        { send: '\x1a', wait: 'Stopped|Suspended', timeout: 10, name: '재움' },
        { send: 'fg\r', mark: true },
        { wait: '실행할까요', timeout: 5, name: '물음 다시' },
        { type: 'n\r', wait: '도구결과받음', name: '답한 뒤' },
        { type: '/exit\r', sleep: 1.5 }, fg끝,
      ], { 상자, 도구: true, 끝: false });
      const f = fg읽기(r);
      check(`★ 진짜 pty (${이름}): 승인 물음 중에 재웠다 깨우면 물음을 다시 찍고, n 은 여전히 거부다`,
        r.걸음['물음 다시'] && !r.썼나 && /거부/.test(r.도구결과[0] ?? '') && f.종료 === '0' && f.복구됨,
        `걸음=${JSON.stringify(r.걸음)} · fg=${JSON.stringify(f)} · 도구결과=${JSON.stringify(r.도구결과)} · ${JSON.stringify(r.화면글.slice(-300))}`);
    }

    trace(`7-고아-그룹-Ctrl+Z (${이름})`);
    {
      /*
       * `exec deel` 로 띄우면 deel 이 세션의 맨 앞이 되고 부모(python)는 다른 세션이라 프로세스 그룹이 고아다.
       * 그러면 커널은 SIGTSTP 를 그냥 버린다 — 안 잠든다. `ssh -t 호스트 deel` · `docker run -it` 이 이 꼴이다.
       * 그때도 날것 모드가 돌아와 있어야 한다(SIGCONT 는 영영 안 온다).
       */
      const r = await 판([
        { tty: '켠 뒤' },
        { send: '\x1a', sleep: 1.5 },
        { tty: 'Ctrl+Z 뒤' },
        { type: '가나다' }, { send: '\x7f', sleep: 0.2 }, { send: '\x7f', sleep: 0.2 },
        { type: '라\r', wait: '받았습니다:2자', name: '답' },
        { type: '/exit\r', sleep: 1.5 },
      ], { 상자, 끝: false, exec: true });
      check(`★★ 진짜 pty (${이름}): 고아 그룹이라 Ctrl+Z 가 버려져도 날것 모드로 돌아와 키를 그대로 받는다`,
        r.모드['켠 뒤'] === '-icanon -echo' && r.모드['Ctrl+Z 뒤'] === '-icanon -echo' && r.받은말.at(-1) === '가라' && !/Stopped|Suspended/.test(r.화면글),
        `모드=${JSON.stringify(r.모드)} · 걸음=${JSON.stringify(r.걸음)} · ${JSON.stringify(r.받은말)} · ${JSON.stringify(r.화면글.slice(-300))}`);
    }

    /*
     * ── 승인 물음 (엄격) ─────────────────────────────────────────────────
     *
     * 「실행할까요? (y/n)」 은 내 파일이 바뀌기 직전에 서는 유일한 문이다. 진짜 터미널에서 친 키가 그대로
     * 답이 되는지, ESC · Ctrl+C 가 승인으로 새지 않는지, 친 답이 **다음 입력칸으로 흘러들지 않는지**를 본다.
     */
    const 승인판 = (답걸음) => 판([
      { type: '/mode strict\r', wait: '모두 확인', name: '엄격' },
      { type: '파일써줘\r', wait: '실행할까요', name: '물음' },
      ...답걸음,
      { type: '다음말\r', wait: '받았습니다:3자', timeout: 20, name: '다음 답' },
      { type: '/exit\r' },
    ], { 상자, 도구: true });
    const 승인덧 = (r) => `썼나=${r.썼나} · 걸음=${JSON.stringify(r.걸음)} · 도구결과=${JSON.stringify(r.도구결과)} · ${덧(r)}`;

    for (const [답, 키, 됨] of [['y', 'y\r', true], ['ㅇ', 'ㅇ\r', true], ['n', 'n\r', false]]) {
      trace(`7-승인-${답} (${이름})`);
      const r = await 승인판([{ type: 키, wait: '도구결과받음', name: '답한 뒤' }]);
      check(`★★ 진짜 pty (${이름}): 승인 물음에 「${답}」 — ${됨 ? '파일을 쓴다' : '안 쓰고 거부로 돌려준다'}`,
        r.걸음.물음 && r.썼나 === 됨 && (됨 ? /만듦/.test(r.도구결과[0] ?? '') : /거부/.test(r.도구결과[0] ?? '')), 승인덧(r));
      check(`  진짜 pty (${이름}): 「${답}」 이 다음 입력칸으로 안 흘러든다 — 다음 말은 「다음말」 그대로`,
        r.받은말.at(-1) === '다음말' && r.종료 === '0' && r.복구됨, 승인덧(r));
    }

    for (const [이름키, 키] of [['ESC', '\x1b'], ['Ctrl+C', '\x03']]) {
      trace(`7-승인-${이름키} (${이름})`);
      const r = await 승인판([{ send: 키, sleep: 1.5 }]);
      check(`★★ 진짜 pty (${이름}): 승인 물음에서 ${이름키} 는 승인이 아니다 — 파일을 안 쓴다`, r.걸음.물음 && !r.썼나, 승인덧(r));
      check(`  진짜 pty (${이름}): ${이름키} 뒤에도 다음 말을 받고 0 으로 끝난다`,
        r.받은말.at(-1) === '다음말' && r.종료 === '0' && r.복구됨, 승인덧(r));
    }
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
