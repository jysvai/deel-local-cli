// 프록시 검사(proxy.test.js)의 자식 — https 대상을 CONNECT 터널로. 부모가 띄운 서버에 붙는다.
//
// 따로 뜨는 까닭: NODE_EXTRA_CA_CERTS 는 프로세스가 **뜰 때** 읽는 값이라, 부모 안에서는
// 검사용 인증서를 믿게 할 길이 없다. 부모가 인증서를 파일로 떨궈 주고 이 파일을 띄운다.
// 결과는 JSON 한 줄로 stdout 에 쓴다. 부모가 그걸 읽어 검사 목록에 합친다.
import { req, closeConnections } from '../src/backend/http.js';
import { allowEndpoint, resetNet, NetBlocked, contacted } from '../src/safety/network.js';
import { 프록시정하기 } from '../src/backend/proxy.js';

const 결과 = [];
const 보고 = (name, cond, note = '') => 결과.push({ name, cond: !!cond, note: String(note) });
const 프록시포트 = process.env.DEEL_PROXY_TEST_PROXY;
const 대상포트 = process.env.DEEL_PROXY_TEST_TARGET;
try {
  프록시정하기({ env: { HTTPS_PROXY: `http://127.0.0.1:${프록시포트}` }, 로컬우회: false });
  resetNet();
  allowEndpoint(`https://localhost:${대상포트}`);
  const r = await req(`https://localhost:${대상포트}/v1/models`, { timeout: 8000 });
  보고('https 대상에 터널로 닿는다', r.ok && r.json?.data?.[0]?.id === 'tls-model', JSON.stringify({ ok: r.ok, status: r.status, error: r.error }));
  보고('닿은 기록에 프록시 경유가 적힌다', contacted()[0]?.via === `http://127.0.0.1:${프록시포트}`, JSON.stringify(contacted()));

  const s = await req(`https://localhost:${대상포트}/v1/stream`, { method: 'POST', body: { a: 1 }, stream: true, timeout: 8000 });
  let 글 = '';
  if (s.ok && s.res?.body) {
    const reader = s.res.body.getReader();
    const dec = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; 글 += dec.decode(value, { stream: true }); }
  }
  보고('터널 안에서 흘려 받기도 된다', /data: 1[\s\S]*data: 2[\s\S]*\[DONE\]/.test(글), 글.slice(0, 80));
  보고('머리말을 읽을 수 있다', s.res?.headers?.get?.('content-type')?.includes('text/event-stream'), String(s.res?.headers?.get?.('content-type')));

  // 허용 안 된 https 대상 — 프록시에 CONNECT 조차 안 간다 (부모가 프록시 기록으로 확인)
  let 막힘 = null;
  try { await req(`https://localhost:${Number(대상포트) + 1}/v1/models`, { timeout: 3000 }); } catch (e) { 막힘 = e; }
  보고('허용 안 된 https 대상은 던져서 막는다', 막힘 instanceof NetBlocked, 막힘?.name);

  // 프록시가 407 을 주면 인증 이야기를 한다 (부모가 두 번째 프록시를 인증 요구로 띄워 둔다)
  프록시정하기({ env: { HTTPS_PROXY: `http://127.0.0.1:${process.env.DEEL_PROXY_TEST_AUTHPROXY}` }, 로컬우회: false });
  const 인증 = await req(`https://localhost:${대상포트}/v1/models`, { timeout: 8000 });
  보고('프록시가 인증을 요구하면 그렇다고 말한다', !인증.ok && /인증|407/.test(인증.error ?? ''), JSON.stringify({ status: 인증.status, error: 인증.error }));
  프록시정하기({ env: { HTTPS_PROXY: `http://user:pw@127.0.0.1:${process.env.DEEL_PROXY_TEST_AUTHPROXY}` }, 로컬우회: false });
  const 인증됨 = await req(`https://localhost:${대상포트}/v1/models`, { timeout: 8000 });
  보고('주소에 user:pw 를 넣으면 통한다', 인증됨.ok, JSON.stringify({ status: 인증됨.status, error: 인증됨.error }));
} catch (e) {
  보고('자식이 터지지 않는다', false, String(e?.stack ?? e));
}
process.stdout.write(JSON.stringify(결과) + '\n');
// 열어 둔 것이 없으니 저절로 끝난다. process.exit() 는 안 쓴다 — 윈도우에서 닫는 중인
// 핸들을 두고 끊으면 libuv 가 abort 한다 (backend/http.js closeConnections 참고).
await closeConnections();
process.exitCode = 0;
