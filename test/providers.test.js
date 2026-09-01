// 붙일 곳들 — 열쇠를 뿌리지 않는가, 없는 것을 지어내지 않는가.
//
// ── 여기서 지키려는 것 ──────────────────────────────────────────────────
//
//   1. **열쇠를 여러 곳에 던지지 않는다.** 「어디 것인지 찾겠다」고 벤더마다
//      찔러 보면 Anthropic 열쇠가 OpenAI 서버로, 다시 Google 서버로 간다.
//      401 이 오고 끝이지만 열쇠는 이미 갔다. 앞머리로 짐작해 **한 곳만**
//      물어보고, 모르면 뿌리지 말고 사람에게 묻는다.
//   2. **겹치는 앞머리는 긴 쪽이 이긴다.** `sk-ant-` 는 `sk-` 로도 시작한다.
//      짧은 쪽이 먼저 집으면 Claude 열쇠를 OpenAI 로 보내게 된다.
//   3. **단가를 지어내지 않는다.** 옛 단가로 「$0.42」 를 찍으면 사람은 그
//      숫자를 믿고 큰 작업을 돌린다. 모르면 토큰만 적는다.
//   4. **막힌 까닭을 아는 것만 말한다.** 401(닿았는데 열쇠) · 404(주소가 아님)
//      을 「연결 실패」로 뭉개면 사람은 주소를 의심하며 엉뚱한 데를 판다.
//      그렇다고 모르는 것까지 지어내면 더 나쁘다 — 모르면 null 이다.
//   5. **목록은 울타리가 아니다.** 「주소를 직접」 이 늘 있고, 거기엔 규격도
//      인증도 안 적혀 있다 — 스캐너가 알아낼 몫이다.
import { readFileSync, readdirSync } from 'node:fs';
import { 제공자들, 제공자고르기, 어디것일까, 주소후보, 막힌까닭 } from '../src/providers/index.js';
import { 리전들 } from '../src/providers/bedrock.js';
import { AUTH_STYLES } from '../src/backend/http.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-열쇠를-뿌리지-않는가');

{
  /*
   * 앞머리로 알아보는 자리. 여기서 틀리면 **남의 서버에 내 열쇠가 남는다.**
   * 그래서 이 절의 검사가 이 파일에서 제일 무겁다.
   */
  const 것들 = [
    ['sk-ant-api03-abcdefghij', 'anthropic', 'Claude 열쇠'],
    ['sk-proj-abcdefghijklmno', 'openai', 'OpenAI 프로젝트 열쇠'],
    ['sk-abcdefghijklmnopqrst', 'openai', 'OpenAI 옛 꼴 열쇠'],
    ['AIzaSyD_abcdefghijklmno', 'gemini', 'Google 열쇠'],
  ];
  for (const [열쇠, 어디, 무엇] of 것들) {
    const r = 어디것일까(열쇠);
    check(`${무엇} → ${어디}`, r?.제공자.id === 어디, r ? r.제공자.id : '(모름)');
  }

  // 이 하나가 이 절의 핵심이다. `sk-ant-` 가 `sk-` 에 먼저 걸리면 안 된다.
  check('★ sk-ant- 를 sk- 가 먼저 집지 않는다',
    어디것일까('sk-ant-api03-abcdefghij')?.제공자.id === 'anthropic',
    어디것일까('sk-ant-api03-abcdefghij')?.제공자.id ?? '(모름)');

  /*
   * 모르는 열쇠는 **모른다고 한다.** 여기서 아무 데나 골라 주면, 그 순간
   * 열쇠가 엉뚱한 벤더로 나간다. 사람에게 묻는 것이 늘 싸다.
   */
  for (const 모르는것 of ['ABSK-사내발급-12345', 'bedrock-key-xyz', 'hf_abcdefg', '', null, undefined, '   ']) {
    check(`★ 모르는 열쇠는 짐작하지 않는다: ${JSON.stringify(모르는것)}`, 어디것일까(모르는것) === null,
      String(어디것일까(모르는것)?.제공자.id ?? 'null'));
  }

  // Bedrock 열쇠에는 알아볼 앞머리가 없다. 없는 것을 만들어 두면 그게 곧
  // 「Bedrock 열쇠인 줄 알고 AWS 로 남의 열쇠를 보내는」 길이 된다.
  check('★ Bedrock 은 앞머리를 안 지어낸다', 제공자고르기('bedrock').키앞머리.length === 0);
  check('직접 넣기도 앞머리가 없다', 제공자고르기('custom').키앞머리.length === 0);

  // 왜 그렇게 골랐는지를 사람에게 말할 수 있어야 한다. 못 말하면 못 고친다.
  check('왜 그렇게 봤는지 말한다', /sk-ant-/.test(어디것일까('sk-ant-x')?.왜 ?? ''),
    어디것일까('sk-ant-x')?.왜 ?? '');
}

trace('2-주소를-지어내지-않는가');

{
  check('OpenAI 주소', 주소후보(제공자고르기('openai'))[0] === 'https://api.openai.com/v1');
  check('Anthropic 주소', 주소후보(제공자고르기('anthropic'))[0] === 'https://api.anthropic.com');
  // 문서로 확인한 주소다 (ai.google.dev/gemini-api/docs/openai).
  check('Gemini 는 OpenAI 호환 창구',
    주소후보(제공자고르기('gemini'))[0] === 'https://generativelanguage.googleapis.com/v1beta/openai/');

  /*
   * Bedrock 은 리전이 주소에 들어간다. 그래서 리전을 안 주거나 이상한 것을
   * 주면 **주소를 안 만든다.** 여기서 대충 만들어 내면 있지도 않은 호스트로
   * 나가고, 화면에는 「연결 실패」 만 남는다 — 리전을 잘못 적었다는 것을
   * 알려 줄 기회를 놓친다.
   */
  const 서울 = 주소후보(제공자고르기('bedrock'), { 리전: 'ap-northeast-2' });
  check('Bedrock 리전이 주소에 들어간다', 서울.every((u) => u.includes('ap-northeast-2')), 서울[0]);
  check('Bedrock 후보를 여럿 준다 — 어느 것이 되는지는 물어본다', 서울.length >= 2, String(서울.length));
  check('문서에 있는 창구가 첫 후보다',
    서울[0] === 'https://bedrock-runtime.ap-northeast-2.amazonaws.com/v1', 서울[0]);
  for (const 이상한리전 of ['서울', 'seoul', '', 'us-east', '../../etc', 'ap-northeast-2 ; rm']) {
    check(`★ 이상한 리전으로는 주소를 안 만든다: ${JSON.stringify(이상한리전)}`,
      주소후보(제공자고르기('bedrock'), { 리전: 이상한리전 }).length === 0);
  }
  // null 은 「이상한 값」이 아니라 「안 골랐다」 는 뜻이다. 그때는 기본 리전으로 간다.
  check('리전을 안 주면 기본 리전으로', 주소후보(제공자고르기('bedrock')).length >= 2);
  check('리전에 null 을 줘도 안 고른 것으로 본다',
    주소후보(제공자고르기('bedrock'), { 리전: null })[0]?.includes('us-east-1') === true,
    주소후보(제공자고르기('bedrock'), { 리전: null })[0] ?? '(없음)');

  /*
   * 「주소를 직접」 은 주소도 규격도 인증도 안 적는다.
   *
   * 스캐너(backend/detect.js)가 알아낼 몫이다. 여기에 적어 두면, 적어 둔
   * 것이 틀린 날 스캐너가 알아낼 수 있는 것까지 못 붙게 만든다.
   */
  const 직접 = 제공자고르기('custom');
  check('★ 직접 넣기는 주소·규격·인증이 다 비어 있다',
    주소후보(직접).length === 0 && 직접.규격 === null && 직접.인증 === null);
  check('목록에 「직접 넣기」 가 있다 — 목록은 울타리가 아니다',
    제공자들.some((p) => p.id === 'custom'));
}

trace('3-단가를-지어내지-않는가');

{
  /*
   * 단가는 반드시 낡는다. 낡은 값을 확인한 낯으로 내밀면, 사람은 싸다고 믿고
   * 큰 작업을 돌린다 — 0원으로 찍는 것 다음으로 나쁜 것이 이것이다.
   *
   * 그래서 아는 것이 없으면 **비워 둔다.** 이 검사는 나중에 누가 표를 채울
   * 때 기준 날짜 없이 못 채우게 막는 자물쇠이기도 하다.
   */
  for (const p of 제공자들) {
    const 값들 = Object.keys(p.요금 ?? {});
    check(`${p.id}: 단가를 적었으면 기준 날짜가 있다`, 값들.length === 0 || !!p.요금기준,
      `${값들.length}개 · 기준 ${p.요금기준 ?? '없음'}`);
  }
  // 지금은 아무 데도 안 적혀 있어야 한다. 확인한 값이 없기 때문이다.
  const 적힌것 = 제공자들.filter((p) => Object.keys(p.요금 ?? {}).length);
  check('★ 확인 못 한 단가는 아예 안 적어 뒀다', 적힌것.length === 0,
    적힌것.map((p) => p.id).join(' '));
  // 대신 어디서 보는지는 알려 준다. 「모릅니다」 로만 끝나면 손을 못 쓴다.
  for (const p of 제공자들.filter((x) => x.id !== 'custom')) {
    check(`${p.id}: 요금표 주소를 알려 준다`, /^https:\/\//.test(p.요금표주소 ?? ''), p.요금표주소 ?? '');
  }
}

trace('4-막힌-까닭을-읽는가');

{
  const P = (id) => 제공자고르기(id);

  // 401 을 「연결 실패」로 뭉개던 것이 이번에 고치는 자리다. 401 은 닿은 것이라
  // 주소를 의심하면 안 된다 — 사람이 엉뚱한 데를 파는 것이 여기서 시작한다.
  check('★ 401 은 「닿았다」 고 말한다', /닿았습니다/.test(막힌까닭(P('openai'), { status: 401, 서버말: 'invalid' }) ?? ''),
    막힌까닭(P('openai'), { status: 401, 서버말: 'invalid' }) ?? '');
  check('★ 만료는 만료라고 말한다', /만료/.test(막힌까닭(P('openai'), { status: 401, 서버말: 'token has expired' }) ?? ''),
    막힌까닭(P('openai'), { status: 401, 서버말: 'token has expired' }) ?? '');
  check('404 는 주소 문제라고 말한다', /주소/.test(막힌까닭(P('openai'), { status: 404, 서버말: '' }) ?? ''));
  check('403 은 권한이라고 말한다', /권한/.test(막힌까닭(P('openai'), { status: 403, 서버말: '' }) ?? ''));

  // Bedrock 의 첫 실패는 거의 늘 이것이다 — 열쇠도 주소도 맞는데 모델을 안 열어 둔 것.
  check('★ Bedrock 모델 접근을 콕 집어 말한다',
    /모델 접근/.test(막힌까닭(P('bedrock'), { status: 403, 서버말: 'AccessDeniedException: ...' }) ?? ''),
    막힌까닭(P('bedrock'), { status: 403, 서버말: 'AccessDeniedException' }) ?? '');
  check('Bedrock 이 리전을 짚어 준다',
    /리전/.test(막힌까닭(P('bedrock'), { status: 400, 서버말: 'ValidationException: model not found' }) ?? ''));

  // 사내에서 흔한 두 가지. 둘 다 「연결 실패」로 보이지만 고칠 자리가 다르다.
  check('사내 인증서를 짚어 준다',
    /NODE_EXTRA_CA_CERTS/.test(막힌까닭(P('custom'), { status: 0, 서버말: 'self signed certificate in chain' }) ?? ''));
  check('프록시를 짚어 준다',
    /프록시|VPN/.test(막힌까닭(P('custom'), { status: 0, 서버말: 'getaddrinfo ENOTFOUND gw.x' }) ?? ''));
  check('로그인 페이지를 알아본다',
    /로그인/.test(막힌까닭(P('custom'), { status: 200, 서버말: '<!DOCTYPE html><html>' }) ?? ''));

  check('Gemini 스키마 거절을 알아본다',
    /스키마/.test(막힌까닭(P('gemini'), { status: 400, 서버말: 'Invalid JSON payload: unknown schema' }) ?? ''));

  /*
   * 모르는 것은 **null 이다.** 여기서 그럴듯한 말을 지어내면 사람이 그 말을
   * 믿고 엉뚱한 데를 판다. 모르면 서버가 한 말을 그대로 보여 주는 편이 낫다.
   */
  for (const [id, status, 말] of [['openai', 500, 'internal error'], ['bedrock', 502, 'bad gateway'], ['gemini', 503, '']]) {
    check(`★ 모르는 ${status} 는 지어내지 않는다`, 막힌까닭(P(id), { status, 서버말: 말 }) === null,
      String(막힌까닭(P(id), { status, 서버말: 말 })));
  }
}

trace('5-데이터-위생');

{
  const 필수 = ['id', '이름', '한줄', '주소들', '빈칸', '키앞머리', '요금'];
  for (const p of 제공자들) {
    const 빠진 = 필수.filter((k) => p[k] === undefined);
    check(`${p.id}: 칸이 다 있다`, 빠진.length === 0, 빠진.join(' '));
    // 규격·인증은 우리가 실제로 말할 줄 아는 것이어야 한다. 오타 하나가
    // 「연결은 되는데 첫 한마디가 400」 이 된다.
    check(`${p.id}: 인증 방식이 진짜 있는 것`,
      p.인증 === null || AUTH_STYLES.some((a) => a.id === p.인증), String(p.인증));
    check(`${p.id}: 규격이 아는 것`, p.규격 === null || ['openai', 'ollama', 'anthropic'].includes(p.규격),
      String(p.규격));
  }
  check('id 가 겹치지 않는다', new Set(제공자들.map((p) => p.id)).size === 제공자들.length);

  /*
   * Anthropic 규격은 아직 안 붙었다. 그 사실을 숨기지 않는다.
   *
   * 숨기면 이렇게 된다 — 목록에 Claude 가 보이고, 열쇠를 넣고, 연결도 되고,
   * 첫 한마디에서 400 이 난다. 그 화면으로는 무엇이 잘못됐는지 알 길이 없다.
   */
  check('★ 아직 못 하는 규격은 그렇다고 적어 둔다', 제공자고르기('anthropic').규격됐나 === false);
  check('할 수 있는 것들은 그 표가 없다',
    ['openai', 'gemini', 'bedrock'].every((id) => 제공자고르기(id).규격됐나 === undefined));

  // 리전 목록은 짧게. 길면 고르는 데 시간이 들고, 어차피 「직접 입력」이 있다.
  check('Bedrock 리전이 다섯 이하', 리전들.length <= 5, String(리전들.length));
  check('리전마다 왜 목록에 있는지 적혀 있다', 리전들.every((r) => r.어디 && r.왜));
  check('서울이 있다 — 자료를 국내에 남기는 것이 사내 도입의 관건',
    리전들.some((r) => r.id === 'ap-northeast-2'));

  /*
   * 파일이 제공자마다 하나씩이다. 늘리는 일이 「파일 하나 + 줄 하나」 여야
   * 남이 PR 하기도, 회사가 제 것을 보태기도 쉽다.
   */
  const 파일들 = readdirSync(new URL('../src/providers/', import.meta.url)).filter((f) => f.endsWith('.js'));
  check('파일 = 제공자 수 + 차례 하나', 파일들.length === 제공자들.length + 1, 파일들.join(' '));
  const 차례 = readFileSync(new URL('../src/providers/index.js', import.meta.url), 'utf8');
  check('차례에 코드 분기가 없다 — 데이터 한 장이다',
    !/if \(제공자\.id ===|switch \(제공자/.test(차례));
}

trace('6-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n붙일 곳 검사  ${D}(열쇠를 뿌리지 않는가 · 없는 것을 지어내지 않는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
