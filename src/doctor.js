// `deel doctor` — **붙기 전에** 이 자리의 조건을 하나씩 본다.
//
// ── diagnose 와 무엇이 다른가 ──────────────────────────────────────────
//
// `deel diagnose` 는 **모델이 일을 할 수 있나**를 잰다 — 도구를 부르나, 답을
// 흘려보내나, 창이 얼마나 넓나. 그건 붙은 다음의 이야기다.
//
// 그런데 사내에서 막히는 자리는 대부분 그 앞이다. 프록시를 안 거쳐서, 사내
// 루트가 없어서, 열쇠를 못 꺼내서, 인증서 경로에 오타가 나서. 그때 사람이
// 받는 것은 「fetch failed」 나 TLS 악수 실패 한 줄이고, 그 한 줄로는 여섯
// 가지 원인 중 어느 것인지 알 수가 없다. 담당자에게 물어볼 말조차 못 만든다.
//
// 그래서 여기서는 **조건을 하나씩 따로 재고, 각각 어디서 온 값인지 적는다.**
// 화면 한 장이 그대로 담당자에게 보낼 질문이 되게 하는 것이 목표다.
//
// ── 규칙 ───────────────────────────────────────────────────────────────
//
// **모르는 것은 모른다고 적는다.** 못 잰 것을 초록으로 세면 이 화면은 사람을
// 엉뚱한 데로 보낸다. 못 잰 것은 `?` 로 적고 왜 못 쟀는지 붙인다.
//
// **비밀은 한 글자도 안 적는다.** 이 화면은 그대로 캡처되어 사내 메신저로
// 간다. 열쇠는 있나 없나와 어디서 왔나만, 인증서 암호는 어디서 왔나만 적는다.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { req } from './backend/http.js';
import { 프록시설정, 프록시고르기 } from './backend/proxy.js';
import { 인증서설정, 인증서등록, 인증서찾기, 인증서말 } from './backend/clientcert.js';
import { 주소가리기 } from './safety/secrets.js';
import { 믿나 } from './safety/trust.js';
import { headersFor } from './backend/http.js';

/** 한 줄. `상태` 는 ok · warn · no · unknown 넷뿐이다. */
const 줄 = (상태, 이름, 값, 덧말 = null) => ({ 상태, 이름, 값, 덧말 });

/**
 * 이 자리의 조건을 다 본다. 화면 그리기는 안 한다 — 부르는 쪽이 그린다.
 *
 * @param {object} o
 * @param {object|null} o.cfg   읽은 설정
 * @param {object|null} o.prof  고른 프로필
 * @param {string} o.root       작업 폴더
 * @param {boolean} o.바깥가도되나  네트워크를 실제로 두드려도 되나
 */
export async function 진찰(o = {}) {
  const { cfg = null, prof = null, root = process.cwd(), 바깥가도되나 = true, 설정자리 = null } = o;
  const 줄들 = [];

  // ── 1. 이 프로그램이 도는 자리 ───────────────────────────────────────
  const major = parseInt(String(process.versions.node).split('.')[0], 10);
  줄들.push(줄(major >= 20 ? 'ok' : 'no', 'Node', `${process.versions.node} · ${process.platform}`,
    major >= 20 ? null : '20 이상이 필요합니다'));

  // ── 2. 설정 ─────────────────────────────────────────────────────────
  if (설정자리) 줄들.push(줄(existsSync(설정자리) ? 'ok' : 'warn', '설정 파일', 설정자리));
  const 프로젝트설정 = join(root, '.deel', 'config.json');
  if (existsSync(프로젝트설정)) {
    /*
     * 프로젝트 설정은 **믿는 폴더에서만** 읽는다 (safety/trust.js). 여기서
     * 읽었는지 안 읽었는지를 말해 주지 않으면, 적어 둔 사람은 자기 설정이
     * 왜 안 먹는지 영영 모른다 — 파일은 분명히 거기 있기 때문이다.
     */
    const 믿나결과 = 믿나(root);
    줄들.push(줄(믿나결과 ? 'ok' : 'warn', '프로젝트 설정', 프로젝트설정,
      믿나결과 ? '읽습니다' : '안 읽습니다 — 읽게 하려면 deel trust'));
  }
  if (!prof) {
    줄들.push(줄('no', '프로필', '(없음)', 'deel setup 을 먼저 하세요'));
    return { 줄들, 붙어봤나: false };
  }
  줄들.push(줄('ok', '프로필', `${prof.name ?? prof.id ?? '(이름 없음)'} · ${prof.model ?? '(모델 없음)'}`));
  줄들.push(줄('ok', '주소', 주소가리기(prof.baseUrl ?? '(없음)')));

  // ── 3. 열쇠 ─────────────────────────────────────────────────────────
  /*
   * 값은 절대 안 적는다. 있나 없나와 **어디서 왔나**만 적는다 — 고칠 사람이
   * 알아야 하는 것이 그 둘이다. 환경변수가 파일을 이기고 있는데 그걸 모르면
   * 파일만 백 번 고친다.
   */
  const 열쇠어디 = (() => {
    if (process.env.DEEL_API_KEY) return '환경변수 DEEL_API_KEY';
    const 프로필키 = prof.id ? process.env[`DEEL_KEY_${String(prof.id).toUpperCase()}`] : null;
    if (프로필키) return `환경변수 DEEL_KEY_${String(prof.id).toUpperCase()}`;
    if (prof.열쇠받기 || prof.authCommand) return '명령으로 받아 옵니다';
    if (prof.apiKey) return '설정 파일';
    return null;
  })();
  const 열쇠있나 = !!(o.열쇠 ?? '');
  if (prof.auth === 'none') 줄들.push(줄('ok', '열쇠', '안 씁니다 (auth: none)'));
  else if (열쇠있나) 줄들.push(줄('ok', '열쇠', `있습니다 · ${열쇠어디 ?? '어디서 왔는지 모름'}`));
  else 줄들.push(줄('no', '열쇠', '못 꺼냈습니다', 열쇠어디 ? `${열쇠어디} 에서 읽으려 했습니다` : '적어 둔 것이 없습니다'));

  // ── 4. 우리 인증서 (mTLS) ───────────────────────────────────────────
  const 인증 = 인증서설정(prof);
  if (인증) {
    인증서등록(prof.baseUrl, 인증);
    try {
      인증서찾기(prof.baseUrl);      // 파일을 실제로 읽어 본다. 못 읽으면 던진다.
      줄들.push(줄('ok', '내 인증서', 인증서말(인증)));
    } catch (err) {
      줄들.push(줄('no', '내 인증서', 인증서말(인증), String(err?.message ?? err).split('\n')[0]));
    }
  }

  // ── 5. 사내 루트 (NODE_EXTRA_CA_CERTS) ──────────────────────────────
  const ca = process.env.NODE_EXTRA_CA_CERTS;
  if (ca) {
    let 됐나 = false;
    try { 됐나 = statSync(ca).isFile(); } catch { 됐나 = false; }
    줄들.push(줄(됐나 ? 'ok' : 'no', '사내 루트', ca, 됐나 ? null : '그 자리에 파일이 없습니다'));
  }

  // ── 6. 프록시 ───────────────────────────────────────────────────────
  /*
   * 「프록시를 켰다」 와 「이 주소가 그 프록시를 거친다」 는 다른 말이다.
   * NO_PROXY 하나로 거치지 않게 되는데, 그때 화면이 「프록시 켜짐」 만
   * 말하면 사람은 거치는 줄 알고 프록시 담당자에게 묻는다.
   */
  const 프록 = 프록시설정();
  const 이주소 = 프록시고르기(prof.baseUrl ?? '');
  if (프록.탈) 줄들.push(줄('warn', '프록시', '설정을 못 읽었습니다', 프록.탈));
  if (!프록.켜짐) 줄들.push(줄('ok', '프록시', '안 거칩니다 (직접)'));
  else if (이주소) {
    줄들.push(줄('ok', '프록시', `${주소가리기(이주소.url)} · ${이주소.출처}`,
      이주소.auth ? '인증 있음' : null));
  } else {
    줄들.push(줄('warn', '프록시', `${프록.프록시들.map((x) => `${주소가리기(x.url)}(${x.출처})`).join(' · ')}`,
      '이 주소는 프록시를 안 거칩니다 (NO_PROXY 나 이 컴퓨터 안)'));
  }

  // ── 7. MCP ──────────────────────────────────────────────────────────
  const mcp자리 = [join(root, '.deel', 'mcp.json'), join(root, '.mcp.json')].filter((p) => existsSync(p));
  if (mcp자리.length) {
    let 몇 = 0;
    try {
      const j = JSON.parse(readFileSync(mcp자리[0], 'utf8'));
      몇 = Object.keys(j?.mcpServers ?? j?.servers ?? {}).length;
    } catch { 몇 = -1; }
    줄들.push(몇 < 0
      ? 줄('no', 'MCP', mcp자리[0], '읽지 못했습니다 (JSON 이 아닙니다)')
      : 줄('ok', 'MCP', `${mcp자리[0]} · 서버 ${몇}개`, '실제로 띄워 보려면 deel 을 켜고 /mcp'));
  }

  // ── 8. 진짜로 두드려 본다 ───────────────────────────────────────────
  if (!바깥가도되나) {
    줄들.push(줄('unknown', '도달', '안 두드렸습니다', '자물쇠가 걸려 있거나 --offline 입니다'));
    return { 줄들, 붙어봤나: false };
  }

  const 주소 = String(prof.baseUrl ?? '').replace(/\/+$/, '');
  const t0 = Date.now();
  const r = await req(`${주소}/models`, {
    headers: headersFor(prof.auth ?? 'bearer', o.열쇠 ?? ''),
    timeout: 15000,
  });
  const 걸린 = Date.now() - t0;

  if (r.ok) {
    const 목록 = Array.isArray(r.json?.data) ? r.json.data : (Array.isArray(r.json?.models) ? r.json.models : []);
    줄들.push(줄('ok', '도달', `${r.status} · ${걸린}ms`));
    /*
     * 모델 목록에 **그 모델이 있나**까지 본다.
     *
     * 붙기는 되는데 모델 이름이 한 글자 틀린 자리가 흔하다. 그때 서버가 주는
     * 것은 404 나 400 이고, 그 화면은 「주소가 틀렸다」 와 구별이 안 된다.
     */
    const 이름들 = 목록.map((m) => String(m?.id ?? m?.name ?? '')).filter(Boolean);
    if (!이름들.length) 줄들.push(줄('unknown', '모델 목록', '안 알려 줍니다', '목록을 안 내는 서버도 있습니다'));
    else if (이름들.includes(String(prof.model))) 줄들.push(줄('ok', '모델', `${prof.model} · 목록 ${이름들.length}개`));
    else {
      const 비슷 = 이름들.filter((n) => n.includes(String(prof.model ?? '')) || String(prof.model ?? '').includes(n));
      줄들.push(줄('no', '모델', `${prof.model} 이 목록에 없습니다`,
        (비슷.length ? `비슷한 것: ${비슷.slice(0, 3).join(' · ')}` : `있는 것: ${이름들.slice(0, 3).join(' · ')}${이름들.length > 3 ? ' …' : ''}`)));
    }
  } else if (r.status === 401 || r.status === 403) {
    // 닿기는 닿았다. 그 둘을 갈라 줘야 사람이 프록시가 아니라 열쇠를 본다.
    줄들.push(줄('ok', '도달', `${r.status} · ${걸린}ms`, '주소는 닿습니다'));
    줄들.push(줄('no', '인증', `${r.status}`, '열쇠나 인증 방식(auth)을 보세요'));
  } else {
    줄들.push(줄('no', '도달', r.status ? `${r.status}` : '못 닿았습니다', r.error ?? null));
  }
  return { 줄들, 붙어봤나: true };
}
