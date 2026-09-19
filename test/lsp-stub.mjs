/**
 * LSP 흉내 서버 — 시험이 박아 넣는 것.
 *
 * 왜 이게 필요한가: 언어 서버는 이 프로그램을 쓰는 자리 대부분에 안 깔려 있다.
 * 진짜 서버로만 시험하면 하필 제일 시험이 필요한 자리(사내망·CI)에서 통째로
 * 안 돈다. 그렇다고 client.js 를 흉내로 갈아 끼우면 정작 재고 싶은 것 —
 * 길이 머리말, 통 경계, 악수 순서 — 이 다 안 재진다.
 *
 * 그래서 흉내는 **규약 쪽에서** 낸다. 오가는 말은 진짜 그대로다. 답만 미리
 * 정해 놓았을 뿐이다.
 *
 * 시험이 재고 싶은 것을 일부러 어렵게 낸다 —
 *   · 답을 **두 통으로 쪼개서** 보낸다 (경계 맞추기가 되는지)
 *   · 한글이 든 이름을 준다 (길이를 바이트로 세는지)
 *   · workspace/configuration 을 우리에게 되묻는다 (안 답하면 멎는 서버 흉내)
 *   · 인자를 주면 답을 아예 안 하거나 늦게 한다 (시한이 도는지)
 */
import { 틀, 받개 } from '../src/lsp/rpc.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

const 몫 = new Set(process.argv.slice(2));
/*
 * 제 pid 를 파일에 적는다 — **셸 껍데기 너머의 진짜 서버**가 죽었나를 재려고.
 *
 * `.cmd` 로 띄우면 우리가 쥔 pid 는 cmd.exe 것이다. 그것만 보고 「껐다」 고 하면
 * 안의 서버가 살아 남아도 초록이 뜬다.
 */
const pid자리 = [...몫].find((a) => a.startsWith('--pidfile='))?.slice('--pidfile='.length) ?? null;
if (pid자리) writeFileSync(pid자리, String(process.pid));
// 우리가 workspace/configuration 에 무엇을 돌려줬는지 적어 둔다 (stub/설정답 으로 꺼내 본다).
let 설정답;
const 말안함 = 몫.has('--mute');           // 아무 답도 안 한다 — 시한 시험
const 늦게 = 몫.has('--slow');             // 아주 늦게 답한다
const 죽음 = 몫.has('--die');              // initialize 를 받고 바로 죽는다
const 늦은색인 = 몫.has('--lateindex');    // 처음 두 번은 심볼을 못 찾은 척한다
/*
 * 참조를 아주 많이 준다 — **자르는 자리**를 만들려고.
 *
 * 진짜 저장소에서 흔한 수다. 이름 하나를 백여 곳에서 쓰는 것은 예사고, 작은
 * 모델은 그중 쉰 곳밖에 못 받는다. 셋만 주는 흉내로는 그 자리를 영영 못 잰다.
 */
const 참조많음 = 몫.has('--manyrefs');
/*
 * 물음을 받으면 **같은 번호로** 우리 쪽에서도 하나 묻고 나서 답한다.
 *
 * 진짜 서버가 이렇게 한다. LSP 는 오가는 번호를 양쪽이 따로 세고, vscode-jsonrpc
 * 를 쓰는 서버(pyright · rust-analyzer)는 1부터 센다 — 우리도 1부터 센다.
 * 번호로만 가르면 서버의 물음이 우리 물음의 답으로 소비된다.
 */
const 번호겹침 = 몫.has('--collide');
// 첫 판 진단을 아주 늦게 낸다 — 둘째 판이 나간 뒤에 도착하도록. 판 번호를 붙인다.
const 옛판 = 몫.has('--stale');
const 판센것 = new Map();   // 파일마다 따로 센다 — 전역으로 세면 둘째 파일부터 첫 판이 늦어진다
const 열린것 = new Set();   // didOpen 으로 연 파일들
/*
 * 파이프가 닫혀도 안 죽는다 — 진짜 언어 서버 중에 이런 것이 있다.
 *
 * 이걸 쓰는 자리는 하나다. 「부모가 죽을 때 아이도 데려가나」 를 재려면,
 * 아이가 **저 혼자 죽지 않아야** 한다. 안 그러면 우리 그물을 통째로 걷어내도
 * 아이는 어차피 죽어서 검사가 초록으로 남는다 — 아무것도 안 지키는 검사가 된다.
 */
const 안죽음 = 몫.has('--sticky');
let 물어본횟수 = 0;

/**
 * 주소를 **일부러 다르게** 적는다.
 *
 * 진짜 서버가 이렇게 한다. pyright 은 우리가 보낸 `file:///C:/…` 를 받아
 * `file:///c%3A/…` 로 적어서 돌려준다 — 같은 파일인데 글자가 다르다.
 * 글자로 견주면 영영 안 맞고, 진단이 제대로 왔는데도 '안 왔다' 가 된다.
 * 아무 말도 안 하는 것이 '성하다' 는 뜻이라, 틀린 것을 성하다고 말하게 된다.
 *
 * 윈도우가 아닌 데서는 드라이브 글자가 없으니, 대신 글자 하나를 퍼센트로
 * 적어 같은 어긋남을 만든다. 어느 쪽이든 주소는 같은 파일을 가리킨다.
 */
function 어긋난주소(href) {
  const 드라이브 = /^file:\/\/\/([A-Za-z]):\//.exec(href);
  if (드라이브) return href.replace(/^file:\/\/\/([A-Za-z]):\//, (_, d) => `file:///${d.toLowerCase()}%3A/`);
  return href.replace(/([a-z])(?=[^/]*$)/, (ch) => `%${ch.charCodeAt(0).toString(16)}`);
}

let 뿌리 = process.cwd();

function 보내기(obj) {
  const 통 = 틀(obj);
  // 일부러 두 조각으로 쪼갠다. 받는 쪽이 통 경계를 제대로 맞추는지 재려고.
  const 반 = Math.max(1, Math.floor(통.length / 2));
  process.stdout.write(통.subarray(0, 반));
  process.stdout.write(통.subarray(반));
}

const 자리 = (rel, line, ch = 0, 끝 = ch + 4) => ({
  uri: pathToFileURL(join(뿌리, rel)).href,
  range: { start: { line, character: ch }, end: { line, character: 끝 } },
});

const 받 = 받개();
process.stdin.on('data', (d) => {
  for (const 통 of 받.넣기(d)) 다루기(통);
});

function 다루기(통) {
  const { id, method, params } = 통;

  // 켜자마자 되물은 configuration 의 답. 모르는 물음으로 치고 오류를 되돌리면 안 된다.
  if (method === undefined && id === 9001) { 설정답 = 통.result; return; }

  // 답하기 전에 같은 번호로 되묻는다. 번호로만 가르는 쪽은 여기서 걸린다.
  if (번호겹침 && id !== undefined && method !== 'shutdown') {
    보내기({ jsonrpc: '2.0', id, method: 'window/workDoneProgress/create', params: { token: `t${id}` } });
  }

  if (method === 'initialize') {
    뿌리 = params?.rootUri ? fileURLToPath(params.rootUri) : process.cwd();
    if (죽음) { 보내기({ jsonrpc: '2.0', id, result: { capabilities: {} } }); process.exit(3); }
    보내기({
      jsonrpc: '2.0',
      id,
      result: {
        capabilities: {
          textDocumentSync: 1,
          definitionProvider: true,
          referencesProvider: true,
          workspaceSymbolProvider: true,
        },
        serverInfo: { name: '흉내서버' },
      },
    });
    // 켜자마자 우리에게 되묻는다. 안 답하면 여기서 멈추는 서버가 진짜로 있다.
    보내기({ jsonrpc: '2.0', id: 9001, method: 'workspace/configuration', params: { items: [{ section: 'x' }] } });
    return;
  }

  if (말안함) return;                       // 악수 뒤로는 아무 말도 안 한다

  if (method === 'initialized' || method === 'exit') {
    if (method === 'exit') process.exit(0);
    return;
  }

  if (method === 'textDocument/didOpen' || method === 'textDocument/didChange') {
    const uri = params?.textDocument?.uri;
    /*
     * 안 연 파일의 didChange 는 **조용히 버린다.** 진짜 서버가 그렇게 한다 —
     * LSP 는 didOpen 으로 연 것만 편집기 쪽 내용으로 들고 있어서, 모르는 파일이
     * 바뀌었다고 하면 무시한다. 그래서 우리가 판 번호를 잘못 이어 세면
     * 진단이 영영 안 오고, 아무 말 없음은 이 프로그램에서 성하다는 뜻이 된다.
     */
    if (method === 'textDocument/didOpen') 열린것.add(uri);
    else if (!열린것.has(uri)) return;
    const 글 = params?.contentChanges?.[0]?.text ?? params?.textDocument?.text ?? '';
    // 글 안에 `틀린것` 이 있으면 오류를 하나 만들어 보낸다.
    // 파일을 실제로 읽어서 정하는 것이 아니라 **받은 내용**으로 정한다 —
    // 우리가 didChange 로 제대로 보냈는지까지 같이 재려고.
    const 줄들 = String(글).split('\n');
    const 진단 = [];
    줄들.forEach((줄, i) => {
      if (줄.includes('틀린것')) {
        진단.push({
          range: { start: { line: i, character: 0 }, end: { line: i, character: 줄.length } },
          severity: 1,
          message: `없는 이름입니다: 틀린것`,
        });
      }
      if (줄.includes('찜찜한것')) {
        진단.push({
          range: { start: { line: i, character: 0 }, end: { line: i, character: 줄.length } },
          severity: 2,
          message: '안 쓰는 값입니다',
        });
      }
    });
    // 일부러 어긋난 주소로 낸다 — 진짜 서버가 그렇게 한다. 위 어긋난주소() 참고.
    const 판 = params?.textDocument?.version;
    const 내기 = () => 보내기({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri: 어긋난주소(uri), version: 판, diagnostics: 진단 },
    });
    if (옛판) {
      // 첫 판은 아주 늦게, 둘째 판은 바로. 그래서 옛 판이 **뒤에** 도착한다.
      const 몇번째 = (판센것.get(uri) ?? 0) + 1;
      판센것.set(uri, 몇번째);
      setTimeout(내기, 몇번째 === 1 ? 400 : 900);
      return;
    }
    if (늦게) setTimeout(내기, 8000);
    else 내기();
    return;
  }

  if (method === 'workspace/symbol') {
    const q = params?.query ?? '';
    // 색인이 아직 안 끝난 척한다. 없어서가 아니라 못 봐서 빈손인 자리다.
    if (늦은색인 && ++물어본횟수 <= 2) { 보내기({ jsonrpc: '2.0', id, result: [] }); return; }
    const 표 = {
      셈하기: [{ name: '셈하기', kind: 12, location: 자리('src/셈.js', 3, 15) }],
      run: [
        { name: 'run', kind: 12, location: 자리('src/a.js', 1, 16) },
        { name: 'run', kind: 12, location: 자리('src/b.js', 2, 16) },
      ],
      범위없는것: [{ name: '범위없는것', kind: 12, location: { uri: pathToFileURL(join(뿌리, 'src/셈.js')).href } }],
      /*
       * 서버는 대개 부분 일치까지 준다 (2.0.0 6회차 LS1). `셈` 을 물으면 이름이 똑같은 것은
       * 없고 `셈하기` 만 온다 — 그걸 짚으면 남의 정의를 내 것처럼 준다.
       * 반대로 `몫` 은 서버가 `셈.몫` 처럼 이름을 꾸며서 준다 — 낱말로 들어 있으니 그 이름이 맞다.
       */
      셈: [{ name: '셈하기', kind: 12, location: 자리('src/셈.js', 3, 15) }],
      몫: [{ name: '셈.몫', kind: 13, location: 자리('src/셈.js', 1, 6) }],
      // 한 파일 안의 서로 다른 둘(A.go · B.go)과, 같은 자리의 겹쳐쓰기(겹 두 줄) (LS2).
      go: [
        { name: 'go', kind: 6, containerName: 'A', location: 자리('src/같은곳.js', 0, 10) },
        { name: 'go', kind: 6, containerName: 'B', location: 자리('src/같은곳.js', 1, 10) },
      ],
      겹: [
        { name: '겹', kind: 12, location: 자리('src/같은곳.js', 2, 9) },
        { name: '겹', kind: 12, location: 자리('src/같은곳.js', 3, 9) },
      ],
    };
    보내기({ jsonrpc: '2.0', id, result: 표[q] ?? [] });
    return;
  }

  if (method === 'textDocument/definition') {
    // 선언만 있는 자리 등에서 서버가 정의를 못 주는 흉내 (LS3).
    보내기({ jsonrpc: '2.0', id, result: 몫.has('--nodef') ? [] : [자리('src/셈.js', 3, 15)] });
    return;
  }

  if (method === 'textDocument/references') {
    // 참조 빈손 — 같은 이름이 여럿인 자리에서 「안 쓰는 것」 으로 읽히는지 재려고 (LS5).
    if (몫.has('--norefs')) { 보내기({ jsonrpc: '2.0', id, result: [] }); return; }
    // 앞 60곳은 a.js, 뒤 60곳은 b.js — 8k 모델 한도(50)로 자르면 보이는 것은 a.js 뿐이다 (LS4).
    if (몫.has('--refs-onefile')) {
      const 한쪽것 = [];
      for (let i = 0; i < 120; i++) 한쪽것.push(자리(i < 60 ? 'src/a.js' : 'src/b.js', 1, 16));
      보내기({ jsonrpc: '2.0', id, result: 한쪽것 });
      return;
    }
    if (참조많음) {
      // 120곳을 두 파일에 흩어 준다. 8k 모델의 한도는 50이라 70곳이 잘린다.
      const 많은것 = [];
      for (let i = 0; i < 120; i++) 많은것.push(자리(i % 2 ? 'src/a.js' : 'src/b.js', i % 3, 2));
      보내기({ jsonrpc: '2.0', id, result: 많은것 });
      return;
    }
    보내기({
      jsonrpc: '2.0',
      id,
      result: [
        자리('src/쓰는곳.js', 4, 8),
        자리('src/쓰는곳.js', 9, 12),
        자리('src/또다른곳.js', 1, 2),
      ],
    });
    return;
  }

  if (method === 'stub/설정답') { 보내기({ jsonrpc: '2.0', id, result: { 받은것: 설정답 ?? '안 옴' } }); return; }

  if (method === 'shutdown') { 보내기({ jsonrpc: '2.0', id, result: null }); return; }

  if (id !== undefined) 보내기({ jsonrpc: '2.0', id, error: { code: -32601, message: `모르는 것: ${method}` } });
}

// 부모가 파이프를 닫으면 같이 끝난다. 유령이 남으면 시험이 끝나도 안 죽는다.
// --sticky 면 안 죽는다 — 위 선언부에 왜 그런 흉내가 필요한지 적어 두었다.
// 그때도 영영 살지는 않는다. 시한을 둬서 검사가 죽어도 뒤에 안 남게 한다.
if (안죽음) setTimeout(() => process.exit(0), 60_000);
else process.stdin.on('end', () => process.exit(0));
