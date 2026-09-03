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

const 몫 = new Set(process.argv.slice(2));
const 말안함 = 몫.has('--mute');           // 아무 답도 안 한다 — 시한 시험
const 늦게 = 몫.has('--slow');             // 아주 늦게 답한다
const 죽음 = 몫.has('--die');              // initialize 를 받고 바로 죽는다
const 늦은색인 = 몫.has('--lateindex');    // 처음 두 번은 심볼을 못 찾은 척한다
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
    const 내기 = () => 보내기({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri: 어긋난주소(uri), diagnostics: 진단 },
    });
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
    };
    보내기({ jsonrpc: '2.0', id, result: 표[q] ?? [] });
    return;
  }

  if (method === 'textDocument/definition') {
    보내기({ jsonrpc: '2.0', id, result: [자리('src/셈.js', 3, 15)] });
    return;
  }

  if (method === 'textDocument/references') {
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

  if (method === 'shutdown') { 보내기({ jsonrpc: '2.0', id, result: null }); return; }

  if (id !== undefined) 보내기({ jsonrpc: '2.0', id, error: { code: -32601, message: `모르는 것: ${method}` } });
}

// 부모가 파이프를 닫으면 같이 끝난다. 유령이 남으면 시험이 끝나도 안 죽는다.
// --sticky 면 안 죽는다 — 위 선언부에 왜 그런 흉내가 필요한지 적어 두었다.
// 그때도 영영 살지는 않는다. 시한을 둬서 검사가 죽어도 뒤에 안 남게 한다.
if (안죽음) setTimeout(() => process.exit(0), 60_000);
else process.stdin.on('end', () => process.exit(0));
