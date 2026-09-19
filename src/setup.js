// 첫 실행 마법사 + 진단 실행.
import { c, say, rule, mark, clip } from './ui/ansi.js';
import { 주소가리기 } from './safety/secrets.js';
import { ask, pick, confirm } from './ui/prompt.js';
import { spin } from './ui/spinner.js';
import { detect } from './backend/detect.js';
import { 규격이름 } from './backend/adapter.js';
import { probe } from './backend/probe.js';
import { renderHeader, renderLine, verdict, renderVerdict, plainReport } from './report.js';
import { load, save, upsert, slug, resolveKey, activeProfile, configPath, 소식줄들 } from './config.js';
import { 보관방식 } from './safety/keystore.js';
import { 애저풀기, 애저base } from './backend/azure.js';
import { allowEndpoint } from './safety/network.js';
import { 인증서설정, 인증서등록 } from './backend/clientcert.js';
import { 바깥인가, 봉인됐나 } from './safety/runmode.js';
import { 제공자들, 제공자고르기, 어디것일까, 주소후보, 막힌까닭, 열쇠다듬기 } from './providers/index.js';
import { writeFileSync } from 'node:fs';

export function banner() {
  say('');
  say(`  ${c.cyan('deel')} ${c.gray('— 로컬 모델 코딩 에이전트')}`);
  say('');
}

/**
 * 사람이 친 주소가 주소 꼴인가. 틀렸으면 까닭(사람 말), 멀쩡하면 null.
 * 스킴이 없으면 `http://` 를 붙여 본다 — connect 가 그렇게 붙어 보기 때문이다.
 */
function 주소꼴탈(url) {
  if (/\s/.test(url)) return '빈칸이 들어 있습니다 — 예: http://127.0.0.1:11434/v1';
  const 스킴붙음 = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`;
  let u;
  try { u = new URL(스킴붙음); } catch { return '주소 꼴이 아닙니다 — 예: http://127.0.0.1:11434/v1 · localhost:8000 · http://[::1]:8000'; }
  if (!/^https?:$/.test(u.protocol)) return `http 나 https 만 됩니다 — 지금은 ${u.protocol}`;
  // 빈 호스트는 `u.hostname` 으로 못 잡는다 — 호스트가 비면 위 `new URL` 이 먼저 던진다.
  // 새는 꼴은 슬래시가 셋인 주소다: 파서가 경로를 호스트로 끌어올려 `/v1` 이 호스트 `v1` 이 된다.
  // 파서가 고쳐 놓은 값 말고 적힌 글자를 본다 (doctor.js 의 주소살펴보기와 쌍둥이).
  if (/^https?:\/\/\//i.test(스킴붙음)) return '호스트 이름이 없습니다 — 예: http://127.0.0.1:11434/v1';
  return null;
}

// 주소와 키를 받아 연결을 찾아낸다. 실패하면 null.
//
// 조용히 = 후보를 여럿 훑는 중이라, 실패해도 아직 화면에 안 적는다.
// 세 개를 줄줄이 시도하면서 실패 안내를 세 번 찍으면, 마지막에 성공해도
// 사람 눈에는 「뭔가 잔뜩 실패했다」 로 남는다.
async function connect(url, key, { 조용히 = false, 제공자: 어디 = null } = {}) {
  const s = spin(`${url} 확인 중...`);
  /*
   * 사용자가 방금 적어 넣은 주소다. 확인하는 동안만 문을 연다.
   *
   * 스킴을 안 적었으면 **두 가지 다 열어 둔다.** 자리마다 기본으로 붙이는
   * 스킴이 다르기 때문이다 — 로컬 서버를 찾는 쪽은 `http://` 를, Azure 쪽은
   * `https://` 를 붙인다. 한쪽만 열어 두면 우리가 만든 주소를 우리 자물쇠가
   * 막고, 화면에는 "허용되지 않은 주소" 만 뜬다. 여는 것은 사람이 적어 넣은
   * 그 호스트 하나뿐이라 넓어지는 것이 아니다.
   */
  allowEndpoint(/^https?:\/\//i.test(url) ? url : [`http://${url}`, `https://${url}`]);
  /*
   * 자물쇠가 막으면 **던져서 끝나지 않게** 받아 둔다.
   *
   * 봉인(offline)이 켜져 있으면 checkUrl 이 예외를 던진다. 예전에는 그것이
   * 여기를 그냥 지나쳐 `deel setup` 전체를 죽였다 — 화면에는 스택 자국이
   * 뜨고, 사람은 자기가 켜 둔 봉인 때문이라는 것을 알 길이 없다.
   *
   * 못 붙은 것으로 치고 그 말을 아래 「연결 실패」 자리에 그대로 싣는다.
   */
  let found;
  try { found = await detect(url, key); }
  catch (err) { found = { kind: null, tried: [url], status: 0, why: String(err?.message ?? err) }; }
  if (!found.kind) {
    if (조용히) { s.stop(''); return null; }
    s.stop(`  ${mark.no} ${c.red('연결 실패')}`);
    say('');
    /*
     * 무엇이 막았는지를 먼저 말한다 (providers/index.js 의 막힌까닭).
     *
     * 여태는 401 도 404 도 403 도 전부 「연결 실패」 한 마디였다. 그런데 이
     * 셋은 고칠 자리가 완전히 다르다 — 401 은 닿은 것이라 주소를 의심하면
     * 안 되고, 404 는 주소를 봐야 하고, Bedrock 의 AccessDenied 는 콘솔에서
     * 신청 버튼 한 번 누르면 되는 일이다. 뭉쳐 놓으면 사람은 셋 다 주소
     * 문제로 알고 엉뚱한 데를 판다.
     *
     * 모르는 것은 지어내지 않는다 — 그때는 아래 「확인할 것」 이 그대로 남는다.
     */
    const 까닭 = 막힌까닭(어디, { status: found.status ?? 0, 서버말: found.why ?? '' });
    /*
     * 표에 있는 말과 **받은 말을 둘 다** 낸다.
     *
     * 사람 말로 옮기는 표는 HTTP 상태코드가 있을 때만 쓸모가 있다. 닿지도
     * 못했을 때(status 0)가 오히려 원인이 또렷한 경우가 많다 — 봉인에 막힘 ·
     * 포트 닫힘 · 인증서 · 프록시. 그 한 줄을 버리면 화면에는 「연결 실패」
     * 네 글자만 남고, 정작 답이 적힌 문장을 우리가 지운 셈이 된다.
     *
     * 그래서 여태는 `if (까닭) … else if (found.why) …` 였는데, 그 else 가
     * 거의 안 돌았다. 공통까닭() 은 401·403·404·429·402 에 전부 답이 있어서
     * 표가 늘 먼저 이긴다. 그 바람에 detect.js 의 애저막힌말() 이 지은 세
     * 줄(401·403·404)이 한 줄도 화면에 못 왔다 — 404 의 「주소에
     * /openai/deployments/<배포이름> 까지 넣어 보세요」 까지 같이. 일반 문구는
     * 「주소를 다시 보세요」 로 끝나는데, 정작 **어디를 어떻게** 고치는지는
     * 덮인 쪽에만 적혀 있었다.
     *
     * 표는 고칠 갈래를 가르고(열쇠냐 주소냐 권한이냐), 받은 말은 그 갈래
     * 안에서 어디를 고치는지 짚는다. 둘은 겹치는 말이 아니다. 같은 말이면
     * 한 번만 낸다. 받은 말은 서버가 통째로 뱉은 본문일 수 있어 자른다 —
     * 안 자르면 JSON 한 덩이가 화면을 밀어내고 「확인할 것」 이 안 보인다.
     */
    const 받은말 = String(found.why ?? '').trim();
    if (까닭) say(`    ${mark.warn} ${c.yellow(까닭)}`);
    if (받은말 && 받은말 !== 까닭) say(`    ${mark.warn} ${c.yellow(clip(받은말, 160))}`);
    if (까닭 || 받은말) say('');
    say(`    시도한 주소:`);
    for (const t of found.tried) say(`      ${c.gray(주소가리기(t.includes('?') ? t : `${t}/models`))}`);
    say('');
    say(`    ${c.gray('확인할 것 — 주소·포트가 맞는지, 프록시가 필요한지,')}`);
    say(`    ${c.gray('사내 인증서라면 NODE_EXTRA_CA_CERTS 환경변수가 필요합니다.')}`);
    if (어디?.열쇠받는곳) say(`    ${c.gray('열쇠 받는 곳')} ${c.cyan(어디.열쇠받는곳)}`);
    say('');
    return null;
  }
  const kindName = found.kind === 'ollama' ? `Ollama ${found.version ?? ''}`.trim() : 규격이름(found.kind);
  s.stop(`  ${mark.ok} ${c.green('연결됨')} ${c.gray(`${kindName} · ${found.ms}ms`)}`);
  // 물음표 뒤에 열쇠를 싣는 앞단이 있다 (safety/secrets.js 의 주소가리기).
  say(`    ${c.gray('주소')} ${주소가리기(found.base)}`);
  say(`    ${c.gray('인증')} ${found.auth === 'none' ? '없음' : found.auth}`);
  say(`    ${c.gray('모델')} ${found.models.length}개 발견`);
  if (found.warn) say(`    ${mark.warn} ${c.yellow(found.warn)}`);
  return found;
}

async function chooseModel(found) {
  if (!found.models.length) {
    say('');
    say(`  ${mark.warn} ${c.yellow('모델 목록을 못 받았습니다.')} ${c.gray('이름을 직접 넣어 주세요.')}`);
    return (await ask('모델 이름')).trim();
  }
  const items = found.models.slice(0, 40).map((m) => ({ label: m.id, note: m.note ?? '' }));
  const i = await pick('사용할 모델', items);
  return items[i].label;
}

/*
 * 진단을 돌리고 결과를 화면에 그린다.
 *
 * **봉인은 진단에도 걸린다.** 여기가 빠져 있었다 — 관리자가 정책으로 밖을
 * 막아 둔 PC 에서도 `deel diagnose` 는 그냥 나갔다. 자물쇠가 명령 하나로
 * 열리면 자물쇠가 아니다. 사내망 주소는 봉인에서도 그대로 간다.
 *
 * 부르는 쪽 **셋 다** 이 말을 넘긴다 — 마법사(설정받기)·`deel diagnose`·`--url`.
 * 한 곳이라도 안 넘기면 그 명령 하나가 자물쇠를 통째로 연다. 마법사가 그랬다.
 */
export async function runProbe(conn, { out = null, 봉인 = false } = {}) {
  if (봉인 && 바깥인가(conn.base)) {
    say('');
    say(`  ${mark.no} ${c.red('봉인되어 있어 이 주소는 안 두드립니다.')} ${c.gray(conn.base)}`);
    say(`     ${c.gray('관리 정책이나 설정에 offline 이 켜져 있습니다. 사내망 주소는 그대로 됩니다.')}`);
    say('');
    return { facts: null, results: null, v: null, 봉인: true };
  }
  allowEndpoint(conn.base);   // 진단도 이 주소 하나로만 나간다
  renderHeader({ shape: conn.kind, base: conn.base, auth: conn.auth, model: conn.model });
  const { facts, results } = await probe(conn, renderLine);
  const v = verdict(facts, results);
  renderVerdict(v);
  if (out) {
    writeFileSync(out, plainReport(facts, results, v), 'utf8');
    say(`  ${mark.ok} 보고서 저장됨 ${c.cyan(out)}`);
    say(`     ${c.gray('사내망에서 돌렸다면 이 파일만 가져오시면 됩니다.')}`);
    say('');
  }
  return { facts, results, v };
}

/*
 * ── 어디에 붙일까 ───────────────────────────────────────────────────────
 *
 * 세 갈래가 다 같은 문으로 들어간다. 다른 것은 **사람이 채울 빈칸 개수**뿐이다.
 *
 *   열쇠만 있을 때        빈칸 1개 — 앞머리로 어디 것인지 알아본다
 *   아는 곳에서 고르기     빈칸 1~2개 — 주소를 대신 채워 준다
 *   주소를 직접 넣기       빈칸 2개 — 규격·인증은 스캐너가 알아낸다
 *
 * 「직접 넣기」 를 목록 위쪽에 둔다. 목록이 지원 명단처럼 보이면, 거기 없는
 * 회사는 안 되는 줄 알고 돌아선다 (providers/index.js 머리말).
 *
 * @returns {{제공자, 주소들: string[], 열쇠: string, 이름: string} | null}
 */
async function 붙일곳고르기() {
  const 목록 = [
    { id: '열쇠먼저', label: '열쇠만 있습니다 — 어디 것인지 알아봐 주세요', note: '빈칸 1개' },
    { id: 'custom', label: '주소를 직접 넣기', note: '사내 게이트웨이 · 목록에 없는 곳' },
    ...제공자들.filter((p) => p.id !== 'custom').map((p) => ({
      id: p.id,
      label: p.이름,
      note: `빈칸 ${p.빈칸.length}개 (${p.빈칸.join(' + ')})`
        + (p.규격됐나 === false ? ' · 규격 붙이는 중' : ''),
    })),
  ];
  const i = await pick('어디에 붙일까요?', 목록, { def: 1 });
  const 고른 = 목록[i];

  // ── 열쇠 먼저 ────────────────────────────────────────────────────────
  //
  // 열쇠를 여러 곳에 던져 보고 200 이 오는 데를 찾지 **않는다.** 그러면 남의
  // 서버에 내 열쇠가 남는다. 앞머리로 짐작해 한 곳만 묻고, 모르면 물어본다.
  let 제공자 = null;
  let 열쇠 = '';
  if (고른.id === '열쇠먼저') {
    열쇠 = 열쇠다듬기(await ask('API 키', { mask: true }));
    if (!열쇠) { say(`  ${mark.no} 열쇠가 비었습니다.`); return null; }
    const 짚은것 = 어디것일까(열쇠);
    if (짚은것) {
      제공자 = 짚은것.제공자;
      say(`  ${mark.ok} ${c.bold(제공자.이름)} 열쇠로 보입니다. ${c.gray(`(${짚은것.왜})`)}`);
      say(`     ${c.gray('여기 말고 다른 데는 안 물어봅니다 — 열쇠를 여기저기 던지지 않습니다.')}`);
    } else {
      say(`  ${mark.warn} ${c.yellow('어디 열쇠인지 모르겠습니다.')}`);
      say(`     ${c.gray('짐작으로 여기저기 보내지 않습니다. 어디 것인지 골라 주세요.')}`);
      const 나머지 = 제공자들.map((p) => ({ label: p.이름, note: p.한줄 }));
      제공자 = 제공자들[await pick('어디 열쇠인가요?', 나머지, { def: 0 })];
    }
  } else {
    제공자 = 제공자고르기(고른.id);
  }
  if (!제공자) return null;

  /*
   * 아직 말할 줄 모르는 규격은 여기서 멈춘다.
   *
   * 열쇠를 받고, 연결도 되고, 저장까지 해 놓고 첫 한마디에서 400 이 나면
   * 그 화면으로는 무엇이 잘못됐는지 알 길이 없다. 못 하는 것은 못 한다고
   * 지금 말하는 편이 언제나 싸다.
   */
  if (제공자.규격됐나 === false) {
    say('');
    say(`  ${mark.no} ${c.yellow(`${제공자.이름} 는 규격을 아직 다 못 붙였습니다.`)}`);
    say(`     ${c.gray('주소와 열쇠는 아는데 말을 아직 못 합니다. 붙는 대로 열립니다.')}`);
    say(`     ${c.gray('지금 쓰시려면 OpenAI 호환 창구가 있는 곳(Gemini · Bedrock)을 골라 주세요.')}`);
    say('');
    return null;
  }

  // ── 리전 ─────────────────────────────────────────────────────────────
  //
  // 리전을 고르면 그 자리에서 진짜로 물어본다. 표에 「서울에 무슨 모델이
  // 있다」 를 박아 두지 않는다 — 그 표는 반드시 낡는다.
  let 리전 = null;
  if (제공자.리전들) {
    const 것들 = [...제공자.리전들.map((r) => ({ label: `${r.id}  ${r.어디}`, note: r.왜 })),
      { label: '직접 입력', note: '목록은 낡습니다 — 빠져나갈 구멍을 늘 둡니다' }];
    const j = await pick('어느 리전인가요?', 것들, { def: 0 });
    리전 = j < 제공자.리전들.length
      ? 제공자.리전들[j].id
      : (await ask('리전 (예: ap-northeast-2)')).trim();
  }

  // ── 주소 ─────────────────────────────────────────────────────────────
  let 주소들 = 주소후보(제공자, { 리전 });
  if (!주소들.length) {
    if (제공자.리전들 && 리전) {
      say(`  ${mark.no} ${c.yellow(`리전 이름이 이상합니다: ${리전}`)} ${c.gray('(예: us-east-1 · ap-northeast-2)')}`);
      return null;
    }
    const url = (await ask('주소 (Base URL)')).trim();
    if (!url) { say(`  ${mark.no} 주소가 비었습니다.`); return null; }
    /*
     * 틀린 주소는 **받은 자리에서** 알린다.
     *
     * `http://` · `https://` · `::1` · 빈칸 든 주소가 여기를 그냥 지나가, 열쇠를 묻고 이름을 묻고
     * 붙어 볼 때에야 「Invalid URL」 이라는 날것의 말로 죽었다(`deel setup` 이 통째로 던졌다).
     * 열쇠를 찾아 붙여넣은 수고가 버려진다. 스킴을 안 적은 `127.0.0.1:11434` 는 여태처럼 받는다 —
     * 붙는 쪽(connect)이 스킴을 붙여 본다.
     */
    const 주소탈 = 주소꼴탈(url);
    if (주소탈) {
      say(`  ${mark.no} ${c.yellow('주소가 올바르지 않습니다:')} ${url}`);
      say(`     ${c.gray(주소탈)}`);
      return null;
    }
    주소들 = [url];
  } else {
    say(`  ${c.gray('주소')} ${주소들.map((u) => 주소가리기(u)).join(c.gray('  ·  '))}`);
  }

  // ── 열쇠 ─────────────────────────────────────────────────────────────
  if (!열쇠) {
    if (제공자.열쇠받는곳) say(`  ${c.gray('열쇠 받는 곳')} ${c.cyan(제공자.열쇠받는곳)}`);
    열쇠 = 열쇠다듬기(await ask('API 키', { mask: true }));
  }

  const 기본이름 = 제공자.id === 'custom' ? '사내게이트웨이' : 제공자.이름;
  const 이름 = (await ask('이름', { def: 기본이름 })).trim() || 기본이름;
  return { 제공자, 주소들, 열쇠, 이름 };
}

/*
 * ── 답할 사람이 없는데 목록 한가운데서 0 으로 끝났다 ────────────────────
 *
 * 표준입력이 닫힌 채(파이프 · CI · `deel setup < /dev/null`) 켜면 첫 물음에서
 * 받을 글자가 영영 안 온다. 물음은 끝나지 않는 약속으로 남고, 이벤트 루프가
 * 비면 Node 는 **그냥 0 으로** 나간다. 화면에는 「어디에 붙일까요? › 번호 [2]」
 * 까지만 찍히고 설정은 없다. 스크립트는 설정이 된 줄 알고 다음 줄로 간다.
 *
 * reset.js 는 같은 자리에서 「물어볼 자리가 없습니다」 로 1 을 낸다. 여기도 그렇게
 * 한다. 다만 **미리 막지는 않는다** — 답을 파이프로 흘려 넣어 setup 을 돌리는
 * 쓰임이 있다. 답이 모자라서 입력이 끝났을 때만 멈춘다. 'end' 는 물음이 입력을
 * 읽는 동안에만 날 수 있으므로(prompt.js 는 물음 사이에 입력을 멈춘다), 답을 다
 * 받은 뒤 붙는 중에 끊기는 일은 없다.
 */
const 입력끝남 = Symbol('입력끝남');

export async function runSetup(flags = {}) {
  let 알리기 = null;
  const 끝남 = new Promise((풀기) => { 알리기 = () => 풀기(입력끝남); });
  const 표준입력 = process.stdin;
  if (!표준입력.isTTY) 표준입력.once('end', 알리기);
  try {
    const r = await Promise.race([설정받기(flags), 끝남]);
    if (r !== 입력끝남) return r;
    say('');
    say(`  ${mark.no} ${c.yellow('표준입력이 닫혀 답을 더 받을 수 없습니다.')} ${c.gray('아무것도 저장하지 않았습니다.')}`);
    say(`     ${c.gray('터미널에서')} ${c.cyan('deel setup')} ${c.gray('을 다시 하거나, 이 PC 에 로컬 모델이 떠 있으면')} ${c.cyan('deel scan --save')}`);
    say('');
    return 1;
  } finally {
    표준입력.off('end', 알리기);
  }
}

async function 설정받기(flags = {}) {
  banner();
  // 설정에 적어 둔 api-version 을 **붙기 전에** 읽는다. load() 가 애저정하기()를
  // 부른다. 이걸 뒤에서 하면 사내에서 판을 고정해 둔 곳이 확인만 GA판으로 하고,
  // 문서에 적어 둔 대로 안 도는 셈이 된다.
  const 첫설정 = load();
  /*
   * 모아 둔 소식을 여기서 비운다. `deel setup` 은 설정을 만지는 문인데
   * 넷 중 하나도 안 비우고 있었다 — 열쇠를 방금 잠갔다는 말도, 이 폴더
   * 설정을 안 읽었다는 말도, 관리 정책이 깨졌다는 말도 다 사라졌다.
   * (config.js 의 소식줄들 머리말)
   */
  for (const 줄 of 소식줄들(첫설정)) say(줄);
  say(`  ${c.gray('모델 연결을 설정합니다.')}`);
  // 빈칸 0개짜리 길을 제일 먼저 알려 준다. 이 PC 에 이미 모델이 떠 있는데
  // 주소를 손으로 치게 만드는 것은 우리 잘못이다.
  say(`  ${c.gray('이 PC 에 로컬 모델이 떠 있다면')} ${c.cyan('deel scan --save')} ${c.gray('가 빈칸 없이 찾아 줍니다.')}`);

  const 고른것 = await 붙일곳고르기();
  if (!고른것) return 1;
  const { 제공자: 붙일곳, 주소들, 열쇠: key, 이름: name } = 고른것;

  say('');
  /*
   * ── 봉인은 이 문에도 걸린다 ───────────────────────────────────────────
   *
   * 위 runProbe 머리말이 「봉인은 진단에도 걸린다 … 자물쇠가 명령 하나로 열리면
   * 자물쇠가 아니다」 라고 적어 두고, 정작 이 문은 그 말을 한 번도 안 넘겼다.
   * 관리 정책이나 설정에 offline 을 켜 둔 PC 에서도 `deel setup` 은 후보 주소를
   * 그대로 두드렸다 — 방금 적어 넣은 열쇠까지 실려서. 두드리기 **전에** 거른다.
   * 사내망 주소는 봉인에서도 그대로 간다. 스킴을 안 적은 주소는 connect() 가
   * 붙이는 것과 같은 꼴로 재 준다 — 안 맞추면 `127.0.0.1:11434` 가 바깥으로 샌다.
   */
  // 깃발도 같이 본다. `--help` 는 `--offline` 을 「기억해 둔 허가까지 무시하고 막습니다」
  // 라고 적는데, 여기가 `{ cfg }` 만 넘겨서 그 깃발이 조용히 버려졌다 — 설정·정책에
  // 적어 둔 봉인만 걸리고, 사람이 그 자리에서 친 `deel setup --offline` 은 안 걸렸다.
  // 깃발을 믿고 사내 게이트웨이 주소를 넣은 사람은 방금 적은 열쇠까지 실어 보낸 셈이 된다.
  // (diagnose 는 같은 판에서 `깃발: flags.offline` 을 넘긴다 — 두 문이 갈려 있었다.)
  const 봉인 = 봉인됐나({ 깃발: flags?.offline, prof: null, cfg: 첫설정 });
  const 두드릴것 = 봉인
    ? 주소들.filter((u) => !바깥인가(/^https?:\/\//i.test(u) ? u : `http://${u}`))
    : 주소들;
  if (봉인 && !두드릴것.length) {
    say('');
    say(`  ${mark.no} ${c.red('봉인되어 있어 이 주소는 안 두드립니다.')} ${c.gray(주소들.map((u) => 주소가리기(u)).join('  ·  '))}`);
    say(`     ${c.gray('관리 정책이나 설정에 offline 이 켜져 있습니다. 사내망 주소는 그대로 됩니다.')}`);
    say('');
    return 1;
  }

  /*
   * 후보를 앞에서부터 두드린다. 하나라도 붙으면 그것으로 간다.
   *
   * Bedrock 처럼 창구가 여럿인 곳이 있고, 리전·계정마다 열린 창구가 다르다.
   * 표를 믿고 하나만 쓰면 그 표가 낡은 날 「연결 실패」 만 남는다 —
   * 물어보면 되는 것을 짐작으로 정하지 않는다.
   */
  let found = null;
  for (const [n, url] of 두드릴것.entries()) {
    const 마지막 = n === 두드릴것.length - 1;
    found = await connect(url, key, { 조용히: !마지막, 제공자: 붙일곳 });
    if (found) break;
  }
  if (!found) return 1;

  const model = await chooseModel(found);
  if (!model) { say(`  ${mark.no} 모델이 비었습니다.`); return 1; }

  /*
   * Azure 는 모델 이름이 **주소 안에** 있다.
   *
   * 목록에서 다른 배포를 골랐으면 주소도 그 배포로 바꿔야 한다. 안 바꾸면
   * 화면에는 고른 이름이 보이는데 요청은 처음 주소의 배포로 나간다 —
   * 사람이 알아챌 방법이 없는 어긋남이다.
   */
  if (found.azure) {
    const 푼것 = 애저풀기(found.base);
    if (푼것) found.base = 애저base(푼것.origin, model, 푼것.판);
  }

  const conn = { kind: found.kind, base: found.base, auth: found.auth, key, model };
  const { facts } = await runProbe(conn, { 봉인 });
  // 봉인에 막혀 한 줄도 못 재 본 연결은 저장하지 않는다 — 안 재 본 값을 파일에 적는 셈이 된다.
  if (!facts) return 1;

  /*
   * ── 「나가도 된다」 를 여기서 명시적으로 받는다 ───────────────────────
   *
   * 주소와 허가를 뗀 것이 이번 자물쇠의 요점이다(safety/runmode.js). 주소는
   * 설정 파일에 그대로 있고 손으로도 고칠 수 있지만, 허가는 **사람이 고른
   * 자리에서만** 붙는다. 그래서 둘 다 있어야 나간다 — 설정 파일 한 줄을
   * 고쳐서는 못 나간다.
   *
   * 여기서 안 받아도 대화 화면이 첫 켤 때 다시 묻는다. 그러니 이건 막는
   * 자리가 아니라, **지금 사실을 알려 주는** 자리다. 주소를 방금 친 사람이
   * 그 주소가 바깥이라는 것을 제일 잘 알아들을 자리이기도 하다.
   */
  let 나가도되나 = false;
  if (바깥인가(found.base)) {
    say('');
    say(`  ${c.yellow('↗')} ${c.bold(주소가리기(found.base))} ${c.gray('는 이 컴퓨터 밖입니다.')}`);
    say(`     ${c.gray('쓰면 시킨 말과, 모델이 읽은 파일의 내용이 그리로 갑니다.')}`);
    나가도되나 = await confirm('이 연결로 바깥에 나가도 될까요?', true);
    if (!나가도되나) {
      say(`  ${c.gray('허락 없이 저장합니다 — 이 연결로 처음 켤 때 다시 물어봅니다.')}`);
    }
  }

  const id = slug(name);
  const cfg = load();
  upsert(cfg, {
    id, name,
    kind: found.kind,
    baseUrl: found.base,
    auth: found.auth,
    apiKey: key,
    model,
    // 어디 것인지 적어 둔다. 요금표 주소·열쇠 받는 곳처럼 「이 회사에만 해당되는
    // 안내」를 나중에 꺼내 쓸 때 이 한 칸이 없으면 주소를 보고 다시 짐작해야 한다.
    제공자: 붙일곳.id,
    /*
     * 이 칸은 **허락을 받았을 때만** 붙는다.
     *
     * 없다고 이 안이라는 뜻은 아니다 — 바깥 주소인데 사람이 「아니오」 를
     * 고른 판도 없다. 바깥인지 아닌지는 언제나 **주소로** 가른다(바깥인가).
     * 화면의 연결 목록도 그렇게 적는다(아래 `↗ 바깥 · 켤 때 물어봄`).
     * 읽는 쪽은 전부 `online === true` 만 본다 — 없는 것과 false 는 같다.
     */
    ...(나가도되나 ? { online: true } : {}),
    ctx: facts.ctx ?? null,
    streaming: facts.streaming ?? false,
    tools: facts.tools ?? false,
    json: facts.json ?? false,
    think: facts.think ?? false,
    vision: facts.vision ?? false,
  });
  cfg.active = id;
  const p = save(cfg);

  say(`  ${mark.ok} 저장됨 ${c.cyan(p)}`);
  if (key) {
    // 열쇠가 파일에 '어떤 꼴로' 들어갔는지를 그대로 적는다. 잠겼는지 아닌지를
    // 사람이 짐작하게 두면, 안 잠긴 파일을 잠긴 줄 알고 아무 데나 둔다.
    const 저장한것 = activeProfile(load())?.apiKey ?? null;
    say(`     ${c.gray(`열쇠 보관 — ${보관방식(저장한것)}`)}`);
    say(`     ${c.gray('파일에 아예 안 남기려면 환경변수 DEEL_API_KEY 로 넣으세요 — 그쪽이 우선합니다.')}`);
  }
  say('');
  return 0;
}

// 저장된 프로필 또는 인자로 받은 값으로 진단만 다시 돌린다.
export async function runDiagnose(flags) {
  banner();
  let conn;
  let 쓴설정 = null;
  let 쓴프로필 = null;

  if (flags.url) {
    쓴설정 = load();      // 설정의 api-version 을 먼저 읽는다 (runSetup 과 같은 이유)
    /*
     * 봉인은 **두드리기 전에** 본다.
     *
     * 아래 runProbe 도 봉인을 보지만 그건 붙은 뒤다 — 그때는 connect() 가
     * 이미 그 주소로 나갔다(`/models` 를 후보마다 두드린다). 봉인을 켜 둔
     * 사람이 「안 나갔겠지」 하는 동안 열쇠까지 실려 나간 셈이 된다. 설정에
     * 없는 주소를 그 자리에서 치는 이 길이 오히려 제일 위험하다 —
     * 아래 머리말이 그렇게 적어 두고도 정작 여기를 안 막고 있었다.
     *
     * 스킴을 안 적은 주소는 connect() 가 붙이는 것과 같은 꼴로 재 준다.
     * 안 맞추면 `127.0.0.1:11434` 가 바깥으로 세어져 이 안까지 막힌다.
     */
    if (봉인됐나({ 깃발: flags.offline, prof: null, cfg: 쓴설정 })
      && 바깥인가(/^https?:\/\//i.test(flags.url) ? flags.url : `http://${flags.url}`)) {
      say('');
      say(`  ${mark.no} ${c.red('봉인되어 있어 이 주소는 안 두드립니다.')} ${c.gray(주소가리기(flags.url))}`);
      say(`     ${c.gray('관리 정책이나 설정에 offline 이 켜져 있습니다. 사내망 주소는 그대로 됩니다.')}`);
      say('');
      return 1;
    }
    const key = flags.key ?? process.env.DEEL_API_KEY ?? '';
    const found = await connect(flags.url, key);
    if (!found) return 1;
    const model = flags.model ?? (found.models[0]?.id ?? '');
    if (!model) { say(`  ${mark.no} 모델을 지정해 주세요 (--model).`); return 1; }
    conn = { kind: found.kind, base: found.base, auth: found.auth, key, model };
  } else {
    const cfg = load();
    const prof = activeProfile(cfg);
    쓴설정 = cfg;
    쓴프로필 = prof;
    if (!prof) {
      say(`  ${mark.warn} 저장된 연결이 없습니다. ${c.cyan('deel setup')} 을 먼저 실행하세요.`);
      say(`     ${c.gray('또는')} deel diagnose --url <주소> --key <키> --model <모델>`);
      say('');
      return 1;
    }
    say(`  ${c.gray('프로필')} ${c.bold(prof.name)} ${c.gray(configPath())}`);
    /*
     * 이 게이트웨이가 우리 인증서를 요구하면 여기서도 매어 둔다.
     *
     * 대화·배치·에디터는 전선붙이기() 가 지나는데 진단은 그 길을 안 지난다.
     * 그래서 여기가 빠지면 **진단만** TLS 악수에서 죽는다 — 사람은 게이트웨이가
     * 죽은 줄 알고, 정작 대화는 멀쩡히 된다. 그 어긋남이 제일 헷갈린다.
     */
    인증서등록(prof.baseUrl, 인증서설정(prof));
    conn = {
      kind: prof.kind, base: prof.baseUrl, auth: prof.auth,
      key: resolveKey(prof), model: flags.model ?? prof.model,
    };
  }

  /*
   * 봉인은 --url 로 주소를 직접 준 갈래에도 걸린다. 오히려 그쪽이 더 위험하다
   * — 설정에 없는 주소를 그 자리에서 두드리는 길이기 때문이다.
   */
  const { v, 봉인: 막혔나 } = await runProbe(conn, { out: flags.out ?? null, 봉인: 봉인됐나({ 깃발: flags.offline, prof: 쓴프로필, cfg: 쓴설정 }) });

  /*
   * ── 끝값은 판정을 그대로 옮긴다 ───────────────────────────────────────
   *
   * 여기가 무조건 `return 0` 이었다. 화면에는 빨간 「연결실패」 가 찍히는데 끝값은
   * 0 이라, 사내에 넣기 전에 이 명령부터 돌리는 스크립트는 붙은 줄 알고 다음 줄로
   * 갔다. 봉인에 막혀 **한 줄도 못 재 본** 판도 똑같이 0 이었다. 스크립트가 읽는
   * 것은 화면 글이 아니라 이 숫자다 — 여기가 0 이면 진단을 돌린 뜻이 없다.
   *
   * 「돌아는 간다」(ready · limited)까지가 0 이다. blocked 는 도구 호출이 막힌
   * 것이라 이 도구로 할 일 자체가 안 된다 — 사람에게는 실패로 알린다.
   */
  if (막혔나 || !v) return 1;
  return v.level === 'ready' || v.level === 'limited' ? 0 : 1;
}

export async function showStatus() {
  banner();
  const cfg = load();
  if (!cfg.profiles.length) {
    say(`  ${c.gray('아직 연결이 없습니다.')}`);
    say('');
    say(`    ${c.cyan('deel setup')}   ${c.gray('연결 설정하기')}`);
    say('');
    return 0;
  }
  rule('연결 목록', 74);
  for (const p of cfg.profiles) {
    const here = p.id === cfg.active ? c.cyan(' ← 지금') : '';
    const caps = [
      p.tools ? c.green('도구') : c.red('도구'),
      p.streaming ? c.green('스트림') : c.gray('스트림'),
      p.json ? c.green('스키마') : c.gray('스키마'),
      p.think ? c.green('추론') : c.gray('추론'),
    ].join(c.gray('·'));
    say(`  ${c.bold(p.name)}  ${c.gray(p.model)}  ${caps}${here}`);
    /*
     * 바깥으로 나가는 연결인지, 그리고 허락이 붙어 있는지를 같이 적는다.
     *
     * 주소만 보고는 모른다 — `gw.회사.com` 이 사내인지 바깥인지는 사람이
     * 헷갈리는 자리다. 그리고 허락이 없으면 켤 때 물어본다는 사실도 여기서
     * 미리 알려 준다. 안 그러면 "왜 갑자기 물어보지" 가 된다.
     */
    const 바깥 = 바깥인가(p.baseUrl);
    const 표 = 바깥
      ? `${c.yellow('↗ 바깥')}${p.online ? c.gray(' · 나가도 됨') : c.gray(' · 켤 때 물어봄')}`
      : c.green('⌂ 이 안');
    say(`    ${c.gray(주소가리기(p.baseUrl))}  ${표}`);
  }
  say('');
  say(`  ${c.gray('설정 파일')} ${configPath()}`);
  say('');
  return 0;
}
