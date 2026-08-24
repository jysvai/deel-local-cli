// 소스 코드가 정해진 자리 밖으로 새어 나가지 않는지 검증한다.
//
// 이게 이 프로그램에서 제일 중요한 검사다.
// 코딩 에이전트는 파일 내용을 통째로 모델에 보낸다. 그 주소가 하나로 묶여 있지 않으면
// "로컬에서만 돕니다" 는 그냥 말이다. 그래서 말이 아니라 여기서 확인한다.
import { createServer } from 'node:http';
import { req } from '../src/backend/http.js';
import {
  allowEndpoint, allowTemporarily, setOffline, checkUrl, resetNet,
  contacted, allowed, isLocalHost, NetBlocked,
} from '../src/safety/network.js';
import { importSpecs } from '../src/pack/selfpack.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 막히나 = (url) => {
  try { checkUrl(url); return false; } catch (e) { return e instanceof NetBlocked; }
};

// ── 1. 기본은 전부 거절 ─────────────────────────────────────────────────
resetNet();
check('아무것도 정하지 않으면 전부 거절', 막히나('https://api.openai.com/v1/chat/completions'));
check('로컬조차도 거절', 막히나('http://127.0.0.1:11434/api/chat'));

// ── 2. 정한 자리 하나만 통과 ────────────────────────────────────────────
allowEndpoint('http://127.0.0.1:11434/v1');
check('정한 자리는 통과', !막히나('http://127.0.0.1:11434/v1/chat/completions'));
check('같은 호스트 다른 포트는 거절', 막히나('http://127.0.0.1:1234/v1/chat/completions'));
check('바깥 주소는 거절', 막히나('https://api.openai.com/v1/chat/completions'));
check('비슷하게 생긴 주소도 거절', 막히나('http://127.0.0.1.evil.com/v1/chat/completions'));
check('허용 목록은 하나뿐', allowed().length === 1, allowed().join(', '));

// 새 연결로 바꾸면 앞의 것은 닫힌다 — 모델을 갈아탄 뒤에도 옛 주소가 열려 있으면 안 된다.
allowEndpoint('http://127.0.0.1:1234/v1');
check('연결을 바꾸면 이전 자리는 닫힘', 막히나('http://127.0.0.1:11434/v1/chat/completions'));
check('바꾼 자리는 열림', !막히나('http://127.0.0.1:1234/v1/models'));

// ── 3. 잠깐 열기는 반드시 다시 닫힌다 ───────────────────────────────────
const close = allowTemporarily('https://codeload.github.com/a/b');
check('잠깐 여는 동안은 통과', !막히나('https://codeload.github.com/a/b/tar.gz'));
close();
check('닫으면 다시 거절', 막히나('https://codeload.github.com/a/b/tar.gz'));

// ── 4. 오프라인 잠금 ────────────────────────────────────────────────────
setOffline(true);
const c2 = allowTemporarily('https://codeload.github.com/a/b');
check('오프라인이면 허용 목록에 있어도 바깥은 거절', 막히나('https://codeload.github.com/a/b/tar.gz'));
c2();
check('오프라인이어도 이 컴퓨터 안은 통과', !막히나('http://127.0.0.1:1234/v1/models'));
setOffline(false);

// ── 5. 사설망 판정 ──────────────────────────────────────────────────────
for (const h of ['127.0.0.1', 'localhost', '192.168.0.5', '10.1.2.3', '172.16.0.9', '::1']) {
  check(`이 컴퓨터·사내망으로 봄: ${h}`, isLocalHost(h));
}
for (const h of ['8.8.8.8', 'api.openai.com', '172.32.0.1', 'evil.com']) {
  check(`바깥으로 봄: ${h}`, !isLocalHost(h));
}

// ── 6. 실제 요청도 막히나 (진짜 서버를 하나 띄워서 확인) ────────────────
const hits = [];
const server = createServer((req_, res) => {
  hits.push(req_.url);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

resetNet();
allowEndpoint(`http://127.0.0.1:${port}`);
const ok = await req(`http://127.0.0.1:${port}/v1/models`);
check('허용된 곳에는 실제로 닿음', ok.ok && hits.length === 1, `요청 ${hits.length}건`);

// 허용되지 않은 곳으로 보내려 하면 요청 자체가 안 나간다
const other = createServer((req_, res) => { hits.push('SHOULD-NOT:' + req_.url); res.end('{}'); });
await new Promise((r) => other.listen(0, '127.0.0.1', r));
const otherPort = other.address().port;
let threw = null;
try {
  await req(`http://127.0.0.1:${otherPort}/v1/chat/completions`, {
    method: 'POST', body: { messages: [{ role: 'user', content: '내 소스 코드 전부' }] },
  });
} catch (e) { threw = e; }
check('허용 안 된 곳은 던져서 막음', threw instanceof NetBlocked, threw?.name ?? '안 막힘');
check('그 서버에는 한 건도 안 닿음', !hits.some((h) => String(h).startsWith('SHOULD-NOT')),
  hits.filter((h) => String(h).startsWith('SHOULD-NOT')).join(', '));

check('닿은 곳 기록이 남음', contacted().length === 1 && contacted()[0].local,
  JSON.stringify(contacted()));

server.close();
other.close();

// ── 7. 문이 정말 하나뿐인가 ─────────────────────────────────────────────
// http.js 말고 다른 데서 fetch 를 직접 부르면 자물쇠를 지나지 않는다.
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const SRC = [
  'src/backend/http.js', 'src/backend/adapter.js', 'src/backend/detect.js',
  'src/backend/probe.js', 'src/backend/scan.js', 'src/plugins/manage.js',
  'src/agent/loop.js', 'src/agent/session.js', 'src/repl.js', 'src/setup.js',
  'src/commands.js', 'src/config.js', 'src/tools/index.js',
];
const 직접fetch = [];
for (const f of SRC) {
  const lines = readFileSync(join(repo, f), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    if (!/(?<![.\w])fetch\s*\(/.test(line)) return;
    // 자물쇠를 지나는 두 곳만 정상이다.
    const 정상 = f === 'src/backend/http.js'
      || (f === 'src/plugins/manage.js' && lines.slice(Math.max(0, i - 3), i + 1).some((l) => /checkUrl/.test(l)));
    if (!정상) 직접fetch.push(`${f}:${i + 1}`);
  });
}
check('자물쇠를 건너뛰는 fetch 없음', 직접fetch.length === 0, 직접fetch.join(', '));

// 연결을 바꾸는 자리는 자물쇠도 같이 옮겨야 한다.
// 한 번 빠뜨렸다 — /model 로 갈아탄 뒤 옛 주소가 열린 채 새 주소가 막혔다.
const 갈아타는곳 = ['src/commands.js', 'src/repl.js', 'src/setup.js'];
const 안옮김 = [];
for (const f of 갈아타는곳) {
  const text = readFileSync(join(repo, f), 'utf8');
  const 바꾼다 = /session\.conn,|conn\.base\s*=|Object\.assign\(session\.conn/.test(text);
  if (바꾼다 && !/allowEndpoint\s*\(/.test(text)) 안옮김.push(f);
}
check('연결을 바꾸면 자물쇠도 옮김', 안옮김.length === 0, 안옮김.join(', '));

// ── 8. 몰래 보내는 코드가 없나 ──────────────────────────────────────────
const 의심 = [];
for (const f of SRC) {
  const text = readFileSync(join(repo, f), 'utf8');
  for (const spec of importSpecs(text)) {
    if (['node:http', 'node:https', 'node:net', 'node:dgram', 'node:tls'].includes(spec)) {
      의심.push(`${f} → ${spec}`);
    }
  }
  // 소스에 박힌 바깥 주소 (github 는 플러그인 받기용이라 예외)
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const host = m[1].toLowerCase();
    if (/github\.com$/.test(host)) continue;
    의심.push(`${f} 안에 박힌 주소: ${host}`);
  }
}
check('소스에 박힌 바깥 주소·저수준 소켓 없음', 의심.length === 0, 의심.slice(0, 4).join(' · '));

// ── 결과 ────────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n바깥으로 새는지 검사  ' + D + '(소스가 정해진 자리 밖으로 나가지 않는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exit(fail.length ? 1 : 0);
