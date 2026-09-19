// 슬래시 명령 — 연결을 다루는 것: 모델 갈아타기 · 컨텍스트 길이 · 출력 상한 · 모델 급.
// commands.js 에서 역할별로 나눠 옮겼다(2.0.0). 명령을 가르는 자리(handle)는 그대로 commands.js 에 있다.
import { c, say, rule, pad, mark, clip } from '../ui/ansi.js';
import { allowEndpoint } from '../safety/network.js';
import { 지금모드, 바깥인가, 나갈수있나 } from '../safety/runmode.js';
import { 주소가리기 } from '../safety/secrets.js';
import { pick, confirm } from '../ui/prompt.js';
import { load, resolveKey, upsert } from '../config.js';
import { 받기설정, 잊기 as 받은열쇠잊기 } from '../safety/authcmd.js';
// 열쇠받기 명령을 정책이 못박아 뒀을 수 있다 — 받기설정 이 그 값을 같이 본다.
import { 정책읽기 } from '../safety/policy.js';
import { 말 } from '../i18n/index.js';
import { 더할머리, 규격이름 } from '../backend/adapter.js';
import { 규격맞추기, 규격갈래 } from '../agent/session.js';
import { 잠잠기본, 무소식기본 } from '../backend/http.js';
import { 인증서설정 } from '../backend/clientcert.js';
import { spin } from '../ui/spinner.js';
import { 전선붙이기 } from '../backend/wire.js';
import { 설정남기기, 이연결의프로필 } from './common.js';

/**
 * 한 번에 받을 답 길이 상한.
 *
 *   /out            지금 값과 어디서 나온 값인지
 *   /out 32k        직접 지정
 *   /out auto       모른다고 두고 안전한 기본값으로 (16,384)
 *
 * 왜 따로 있나:
 *   컨텍스트(/ctx)와 다른 축이다. 컨텍스트가 655k 여도 '한 번에 뱉을 수 있는 답'
 *   은 대개 훨씬 작다. 그 두 값이 하나인 줄 알면 큰 파일이 왜 안 만들어지는지
 *   영영 알 수 없다 — 컨텍스트는 넉넉한데 답이 잘리기 때문이다.
 *
 *   전에는 이 기능이 /ctx out 안에 숨어 있었고, 게다가 **먹지도 않았다**
 *   (effort.js 의 클램프가 다시 조였다). 있는데 안 먹는 것이 가장 나쁘다 —
 *   문서에 적혀 있으니 사람이 그걸 믿고 쓴다.
 */
export async function 출력상한(session, arg = '') {
  const { parseSize } = await import('../backend/ctxsize.js');
  const 말 = String(arg ?? '').trim().toLowerCase();
  const cfg = load();
  const prof = 이연결의프로필(cfg, session);
  const 알아낸것 = session.conn.maxOut ?? null;

  if (말 === 'auto' || 말 === '자동') {
    session.conn.maxTokens = null;
    const 지웠나 = prof ? (delete prof.maxTokens, 설정남기기(cfg)) : false;
    say(`  ${mark.ok} 직접 정한 값을 지웠습니다. ${c.gray('이번 대화에 바로 먹습니다.')}`);
    /*
     * 프로필을 못 찾으면 다음에 켤 때 그 값이 되살아난다. 숨기면 안 된다.
     *
     * 다만 **못 찾은 것**과 **찾았는데 못 적은 것**을 갈라야 한다. 여기가
     * `if (!지웠나)` 라, 디스크가 차거나 홈이 읽기 전용일 때 설정남기기() 의
     * 「파일에 남기지 못했습니다 (EPERM…)」 바로 밑에 「설정에서 이 연결을 못
     * 찾아」 가 같이 떴다 — 뒤 줄은 사실이 아니어서, 권한을 볼 사람이 프로필
     * 설정을 뒤진다. ctxLength 의 남기기() 는 처음부터 `else if (!prof)` 였다.
     */
    if (!prof) say(`     ${mark.warn} ${c.yellow('설정에서 이 연결을 못 찾아 파일에는 못 남겼습니다 — 다음에 켜면 옛 값입니다.')}`);
    say(`     ${c.gray(알아낸것 ? `서버에서 알아낸 ${알아낸것.toLocaleString()} 토큰을 씁니다.` : '모르는 값이라 16,384 토큰으로 갑니다.')}`);
    say('');
    return;
  }

  if (말) {
    const 값 = parseSize(말);
    if (!값) {
      say(`  ${mark.no} 숫자를 못 읽었습니다: ${c.white(arg)}`);
      say(`     ${c.gray('이렇게 쓰세요 —')} ${c.cyan('/out 32k')}  ${c.cyan('/out 65536')}  ${c.cyan('/out auto')}`);
      say('');
      return;
    }
    session.conn.maxTokens = 값;
    if (prof) { prof.maxTokens = 값; 설정남기기(cfg); }
    say(`  ${mark.ok} 답 길이 상한 ${c.bold(값.toLocaleString())} 토큰`);
    // 위 auto 갈래와 /ctx 는 못 남겼다고 말하는데 이 갈래만 아무 말이 없었다 —
    // 초록 한 줄만 보고 남은 줄 알았다가 다음에 켜면 조용히 사라진다.
    if (!prof) say(`     ${mark.warn} ${c.yellow('설정에서 이 연결을 못 찾아 파일에는 못 남겼습니다 — 다음에 켜면 옛 값입니다.')}`);
    say(`     ${c.gray('모델이 못 내는 값을 넣으면 서버가 거절합니다. 거절당하면')} ${c.cyan('/out auto')} ${c.gray('로 되돌리세요.')}`);
    say('');
    return;
  }

  const 쓰는값 = session.conn.maxTokens ?? 알아낸것 ?? 16384;
  const 어디서 = session.conn.maxTokens ? '직접 정하신 값'
    : 알아낸것 ? '서버에서 알아낸 값'
      : '모르는 값이라 안전한 기본값';
  say('');
  rule('한 번에 받을 답 길이', 70);
  say(`  ${c.gray('지금 상한')}     ${c.white(쓰는값.toLocaleString())} ${c.gray(`토큰 — ${어디서}`)}`);
  say(`  ${c.gray('컨텍스트')}      ${c.white((session.conn.ctx ?? 0).toLocaleString())} ${c.gray('토큰')} ${c.gray('(다른 축입니다 — /ctx)')}`);
  say('');
  say(`  ${c.gray('이 값이 한 번에 만들 수 있는 파일 크기를 정합니다.')}`);
  say(`  ${c.gray('1,000줄짜리 HTML 이 대략 12,000~18,000 토큰입니다.')}`);
  say(`  ${c.gray('여기서 잘려도 받은 데까지는 파일에 쓰고 이어 붙입니다 — 다만 몇 번 더 오갑니다.')}`);
  say('');
  say(`  ${c.cyan('/out 32k')}      ${c.gray('직접 지정 (k 는 1024)')}`);
  say(`  ${c.cyan('/out auto')}     ${c.gray('직접 정한 값을 지우고 알아낸 값/기본값으로')}`);
  say('');
}

/**
 * /grade — 모델 급.
 *
 * `/ctx` 와는 **다른 축**이다. 헷갈리기 쉬워서 화면에서도 나란히 보여 준다.
 *   /ctx    얼마나 담나        (창 크기)
 *   /grade  얼마나 알아서 하나 (능력)
 *
 * 창이 128k 인 3B 모델이 있고, 창이 32k 인 아주 좋은 모델도 있다. 둘을 같은
 * 값으로 다루면 하나는 붙들려 있고 하나는 놓쳐진다.
 *
 * 평소에는 안 건드려도 된다 — 이름으로 짐작하고, 대화가 돌수록 실제로 본 것
 * (인자 잘림·빈 답·편집 실패·되풀이)으로 고쳐 잡는다. 여기서 정하면 그것이
 * 이기고, `auto` 로 되돌리면 다시 스스로 잡는다.
 */
export function 모델급(session, arg = '') {
  const 값 = String(arg ?? '').trim().toLowerCase();
  const 별명 = {
    '작음': '작음', 'small': '작음', 's': '작음', '작': '작음',
    '보통': '보통', 'medium': '보통', 'm': '보통', '중': '보통',
    '큼': '큼', 'large': '큼', 'l': '큼', 'big': '큼', '대': '큼',
  };

  if (값 === 'auto' || 값 === '자동') {
    session.급정한것 = null;
    // 급은 턴마다 한 번만 맨다(session.js 의 급 머리말). 사람이 여기서 정한
    // 것은 다음 턴이 아니라 **지금** 먹어야 하니 빗장을 풀어 준다.
    session.급다시재기?.();
    const g = session.급();
    say('');
    say(`  ${c.cyan('◈')} 모델 급을 다시 ${c.bold('스스로 잡게')} 했습니다 — 지금은 ${c.white(g.급)}`);
    say(`     ${c.gray(g.왜)}`);
    return;
  }

  if (값 && Object.hasOwn(별명, 값)) {
    session.급정한것 = 별명[값];
    session.급다시재기?.();
    const v = session.급값();
    say('');
    say(`  ${c.cyan('◈')} 모델 급을 ${c.bold(별명[값])} 으로 정했습니다.`);
    say(`     ${c.gray(`한 번에 만들 파일 ${v.한번에쓸파일}개 · ${v.나눠쓰기줄}줄 넘으면 나눠 쓰기`)}`);
    say(`     ${c.gray('/grade auto 로 되돌리면 다시 스스로 잡습니다.')}`);
    return;
  }

  /*
   * 못 알아들은 값은 **못 알아들었다고 말한다.**
   *
   * 앞서는 `/grade 크게` 같은 오타가 오류 한 줄 없이 지금 상태 표로
   * 떨어졌다. 사람은 정해진 줄로 읽고 그대로 쓴다. 바로 옆 `/work` 는
   * 「그런 모드는 없습니다」 를 먼저 말한다 — 잣대를 같게 맞춘다.
   */
  if (값) {
    say('');
    say(`  ${mark.no} ${c.gray('그런 급은 없습니다:')} ${c.white(값)}`);
    say(`  ${c.gray('고를 수 있는 것:')} ${c.cyan('작음')} ${c.gray('·')} ${c.cyan('보통')} ${c.gray('·')} ${c.cyan('큼')} ${c.gray('·')} ${c.cyan('auto')}`);
  }

  // 인자가 없으면 지금 상태를 보여 준다.
  const g = session.급();
  const v = session.급값();
  const 본 = session.본것;
  say('');
  say(`  ${c.bold('모델 급')}  ${c.hcyan(g.급)}${g.짐작 ? c.gray('  (짐작)') : ''}`);
  say(`     ${c.gray(g.왜)}`);
  say('');
  say(`  ${c.gray('이 급에서 쓰는 값')}`);
  say(`     ${c.gray('한 번에 만들 파일')}   ${c.white(String(v.한번에쓸파일))}개`);
  say(`     ${c.gray('나눠 쓰기 기준')}     ${c.white(String(v.나눠쓰기줄))}줄`);
  say(`     ${c.gray('절차를 못 박나')}     ${v.절차를못박나 ? c.white('예') : c.gray('아니오 — 목표만 준다')}`);
  say(`     ${c.gray('하위 작업 권함')}     ${v.하위작업권함 ? c.white('예') : c.gray('아니오')}`);
  if (본 && 본.걸음) {
    say('');
    say(`  ${c.gray('이번 대화에서 실제로 본 것')} ${c.gray(`(${본.걸음}걸음)`)}`);
    const 줄 = [
      ['인자 잘림', 본.잘린인자], ['빈 답', 본.빈답],
      ['편집 실패', 본.편집실패], ['되풀이', 본.되풀이], ['도구 성공', 본.도구성공],
    ];
    say('     ' + 줄.map(([이름, n]) => `${c.gray(이름)} ${n ? c.white(String(n)) : c.gray('0')}`).join(c.gray('  ·  ')));
  }
  say('');
  say(`  ${c.gray('/ctx 와는 다른 축입니다 — /ctx 는 얼마나 담나, /grade 는 얼마나 알아서 하나.')}`);
  say(`  ${c.gray('직접 정하려면 /grade 작음|보통|큼 · 되돌리려면 /grade auto')}`);
}

/**
 * 컨텍스트 길이를 보고·다시 재고·직접 지정한다.
 *
 *   /ctx            지금 값과 어디서 나온 값인지
 *   /ctx auto       서버에 다시 물어 모델에 맞춘다
 *   /ctx 655360     직접 지정 (640k · 128k · 1m 도 받는다 — k 는 1024)
 *
 * 왜 필요한가: 이 숫자 하나가 프로그램 전체 크기를 정한다. 서버가 안 알려주면
 * 32,768 로 깔고 앉는데, 요즘 로컬 모델은 262,144 · 655,360 이 흔하다.
 * 그 상태로 쓰면 모델이 가진 것의 5% 만 쓰는 셈이다.
 *
 * 고른 값은 프로필에 남긴다 — 다음에 켤 때도 그대로여야 한다.
 */
export async function ctxLength(session, arg = '') {
  const { probeCtx, parseSize, fmtSize } = await import('../backend/ctxsize.js');
  const 말 = String(arg ?? '').trim().toLowerCase();
  const 지금 = session.conn.ctx ?? 0;

  const 남기기 = (값, 어디서) => {
    session.conn.ctx = 값;
    const cfg = load();
    const prof = 이연결의프로필(cfg, session);
    // 못 남기면 아래 「프로필에 저장했습니다」 가 거짓말이 된다. 살아있는지 들고 간다.
    const 남김 = prof ? (prof.ctx = 값, 설정남기기(cfg)) : false;
    const b = session.breakdown();
    say(`  ${mark.ok} 컨텍스트 ${c.bold(값.toLocaleString())} 토큰 ${c.gray(`(${fmtSize(값)}) — ${어디서}`)}`);
    say(`     ${c.gray('지금 찬 양')} ${c.white(b.used.toLocaleString())} ${c.gray('· 남음')} ${c.white(b.left.toLocaleString())}`);
    if (남김) say(`     ${c.gray('프로필에 저장했습니다. 다음에 켤 때도 이 값입니다.')}`);
    // 못 남긴 까닭이 '설정을 못 찾음' 이면 설정남기기() 가 아무 말도 안 한다.
    else if (!prof) say(`     ${mark.warn} ${c.yellow('설정에서 이 연결을 못 찾아 파일에는 못 남겼습니다 — 다음에 켜면 옛 값입니다.')}`);
    say('');
  };

  // 0) 답 길이 상한 — 이제 /out 이 본자리다. 여기서는 그리로 넘긴다.
  //    \b 가 아니라 공백·줄 끝으로 끊는다. 한글은 \w 가 아니라서
  //    `/^답\b/` 는 '답 32k' 에도 '답' 에도 안 맞는다(위 '배분' 과 같은 함정).
  if (/^(out|답|출력)(\s|$)/.test(말)) return await 출력상한(session, 말.replace(/^(out|답|출력)\s*/, ''));

  // 1) 직접 지정
  if (말 && !['auto', '자동', '다시', '자세히', 'detail', '-v'].includes(말)) {
    const 값 = parseSize(말);
    if (!값) {
      say(`  ${mark.no} 숫자를 못 읽었습니다: ${c.white(arg)}`);
      say(`     ${c.gray('이렇게 쓰세요 —')} ${c.cyan('/ctx 655360')}  ${c.cyan('/ctx 640k')}  ${c.cyan('/ctx 128k')}  ${c.cyan('/ctx auto')}`);
      say(`     ${c.gray('k 는 1024 입니다. 655,360 은 640k 이지 655k 가 아닙니다 — 헷갈리면 그냥 숫자로 쓰세요.')}`);
      say('');
      return;
    }
    남기기(값, '직접 지정');
    say(`  ${c.gray('서버가 실제로 올려 둔 길이보다 크게 잡으면 긴 대화에서 거절당합니다.')}`);
    say(`  ${c.gray('서버 쪽에서 올린 다음 맞추는 게 안전합니다 —')} ${c.cyan('/ctx auto')} ${c.gray('로 다시 잽니다.')}`);
    say('');
    return;
  }

  // 2) 다시 재기 (auto · 다시 · 자세히)
  if (말) {
    const 자세히 = /자세히|detail|-v/.test(말);
    const s = spin('모델에 걸린 길이를 서버에 묻는 중…');
    let r;
    try { r = await probeCtx(session.conn); }
    catch (err) { s.stop(`  ${mark.no} 못 물어봤습니다 — ${c.gray(String(err?.message ?? err))}`); say(''); return; }
    s.stop('');

    // 어디를 두드렸고 무엇이 나왔는지. 값이 이상할 때 사람이 원인을 짚을 수 있어야 한다.
    if (자세히) {
      say('');
      say(`  ${c.gray('두드린 자리')}`);
      for (const t of r.tried) {
        const 표 = t.ok ? c.green('응답함') : c.gray(`${t.status || '연결 실패'}`);
        say(`     ${c.gray(pad(t.label, 20))} ${표}  ${c.gray(clip(t.url, 60))}`);
      }
      say('');
      say(`  ${c.gray('읽어 낸 값')}`);
      say(`     ${c.gray(pad('모델 최대', 20))} ${r.max ? c.white(r.max.toLocaleString()) : c.gray('못 찾음')}`
        + (r.maxKey ? c.gray(`  ← ${r.maxKey}`) : ''));
      say(`     ${c.gray(pad('지금 올린 길이', 20))} ${r.loaded ? c.white(r.loaded.toLocaleString()) : c.gray('못 찾음')}`
        + (r.loadedKey ? c.gray(`  ← ${r.loadedKey}`) : ''));
      say(`     ${c.gray(pad('답 길이 상한', 20))} ${r.out ? c.white(r.out.toLocaleString()) : c.gray('못 찾음')}`
        + (r.outSource ? c.gray(`  ← ${r.outSource}`) : ''));
      say('');
    }

    // 답 길이 상한도 같이 알아냈으면 받아 둔다. 사람이 정한 값은 안 덮는다.
    if (r.out) session.conn.maxOut = r.out;

    if (!r.value) {
      // 못 알아낸 것을 아는 척하지 않는다. 조용히 32,768 로 깔고 앉으면
      // 655k 모델을 5% 만 쓰거나, 8k 서버에 128k 를 보내 조용히 잘린다.
      say(`  ${mark.warn} 서버가 컨텍스트 길이를 안 알려줍니다. ${c.gray(r.why ?? '')}`);
      if (!자세히) for (const t of r.tried) say(`     ${c.gray(pad(t.label, 20))} ${c.gray(t.ok ? '응답함(값 없음)' : `${t.status || '연결 실패'}`)}`);
      say(`     ${c.gray(`지금은 ${(session.conn.ctx ?? 0).toLocaleString()} 으로 잡혀 있습니다 — 이건 알아낸 값이 아니라 기본값입니다.`)}`);
      say(`     ${c.gray('직접 넣어 주세요 —')} ${c.cyan('/ctx 655360')}   ${c.gray('어디를 두드렸는지 보려면')} ${c.cyan('/ctx 자세히')}`);
      say('');
      return;
    }
    남기기(r.value, `${r.source ?? '서버'}에서 읽음`);
    if (r.max && r.loaded && r.max > r.loaded) {
      say(`  ${c.yellow('이 모델은')} ${c.bold(r.max.toLocaleString())} ${c.yellow('까지 되는데 지금')} ${c.bold(r.loaded.toLocaleString())} ${c.yellow('로 올려 두셨습니다.')}`);
      say(`     ${c.gray('서버(LM Studio 등)에서 컨텍스트를 더 올려 다시 올린 뒤')} ${c.cyan('/ctx auto')} ${c.gray('를 하시면 그만큼 씁니다.')}`);
      say('');
    }
    return;
  }

  // 3) 그냥 보기
  const b = session.breakdown();
  say('');
  rule('컨텍스트 길이', 70);
  say(`  ${c.bold(session.conn.model)}`);
  say(`  ${c.gray('지금 잡은 길이')}   ${c.white(지금.toLocaleString())} ${c.gray('토큰 (' + fmtSize(지금) + ')')}`);
  say(`  ${c.gray('찬 양')}           ${c.white(b.used.toLocaleString())} ${c.gray('· 남음 ' + b.left.toLocaleString())}`);
  say('');
  say(`  ${c.gray('이 값 하나가 프로그램 전체 크기를 정합니다 — 한 번에 읽힐 수 있는 파일 수,')}`);
  say(`  ${c.gray('대화가 접히는 시점, 한 번에 쓸 수 있는 답 길이가 모두 여기서 나옵니다.')}`);
  say('');
  say(`  ${c.cyan('/ctx auto')}      ${c.gray('서버에 다시 물어 모델에 맞춥니다')}`);
  say(`  ${c.cyan('/ctx 655360')}    ${c.gray('직접 지정 (640k · 128k · 1m 도 됩니다 — k 는 1024)')}`);
  say(`  ${c.cyan('/out 32k')}      ${c.gray('한 번에 받을 답 길이 상한 (지금 ' + (session.conn.maxTokens ?? session.conn.maxOut ?? 16384).toLocaleString() + ') — 다른 축입니다')}`);
  say('');
}

/*
 * ── 규격이 바뀌면 대화도 **그 규격으로** 옮겨 적는다 ────────────────────
 *
 * 연결적용() 은 「대화는 그대로 둔다」 였다. 규격이 같을 때는 맞는 말이다.
 * 다르면 옛 모양이 그대로 나가서 첫 마디가 400 이다 — 화면에는 「대화는
 * 이어집니다」 가 적힌 채로.
 *
 *   OpenAI → Anthropic   `role:'tool'` · `content:null` · tool_calls 가 나간다
 *   Anthropic → OpenAI   tool_use · tool_result 블록이 나간다
 *   Ollama → OpenAI      id 없는 부름, 문자열이 아닌 인자가 나간다
 *
 * 옮기는 규칙은 session.js 의 규격맞추기 한 곳에 둔다 — 이어받기(threads.js)도
 * 같은 것을 부른다. 여기서는 **다른 갈래**까지 옮기고 저장 파일도 갈아 끼운다.
 * 갈래 표에 옛 모양으로 남겨 두면 그 갈래로 옮겨 가는 순간 같은 400 이다.
 *
 * @returns {{바꾼것:number, 뺀것:{그림:number, 생각:number}}|null}  같은 규격이면 null
 */
function 대화옮기기(session, 옛규격, 새규격, ctx) {
  if (!새규격 || 규격갈래(옛규격) === 규격갈래(새규격)) return null;
  // 못 적은 것을 세어 둔다 — 조용히 삼키면 다음 --resume 이 옛 모양과 섞인다(아래 catch).
  const 셈 = { 바꾼것: 0, 뺀것: { 그림: 0, 생각: 0 }, 못적음: [] };
  const 옮기기 = (ms) => {
    const r = 규격맞추기(ms, 새규격);
    셈.바꾼것 += r.바꾼것;
    셈.뺀것.그림 += r.뺀것.그림;
    셈.뺀것.생각 += r.뺀것.생각;
    return r;
  };
  const 갈래 = ctx?.갈래 ?? null;
  const 지금 = 옮기기(session.messages);
  if (지금.바꾼것) {
    session.messages = 지금.messages;
    // 파일도 새 모양으로. 안 갈아 끼우면 --resume 이 옛 모양과 새 모양이 섞인 대화를 연다.
    /*
     * 적는 데 실패해도 **이번 대화는** 이어진다 — 그건 맞다. 그런데 조용히
     * 삼키면 안 된다. 파일은 옛 모양 그대로 남고, 바로 위 주석이 적어 둔 그 일이
     * 다음 `--resume` 에서 그대로 일어난다: 옛 모양과 새 모양이 섞인 대화를
     * 열고 서버가 400 으로 거절한다. 이 함수가 막으려던 바로 그 고장이다.
     * 그때 사람은 오늘 여기서 무슨 일이 있었는지 알 길이 없다.
     */
    try { 갈래?.현재store?.()?.replace(session.messages, `규격 바꿈 — ${옛규격} → ${새규격}`); }
    catch (e) { 셈.못적음.push(String(e?.message ?? e)); }
  }
  (갈래?.갈래들 ?? []).forEach((g, i) => {
    if (i === 갈래.자리 || !Array.isArray(g?.messages)) return;
    const r = 옮기기(g.messages);
    if (!r.바꾼것) return;
    g.messages = r.messages;
    try { g.store?.replace?.(r.messages, `규격 바꿈 — ${옛규격} → ${새규격}`); }
    catch (e) { 셈.못적음.push(String(e?.message ?? e)); }   // 위와 같다
  });
  return 셈;
}

/** 옮겨 적었으면 그렇다고 말한다. 뺀 것이 있으면 무엇을 뺐는지까지. */
function 옮김알리기(셈, 새규격) {
  if (!셈?.바꾼것) return;
  say(`     ${c.gray(`${규격이름(규격갈래(새규격))} 에 맞게 대화 ${셈.바꾼것}개를 새 규격으로 옮겨 적었습니다 — 옛 모양 그대로 보내면 서버가 거절합니다.`)}`);
  if (셈.뺀것.그림) say(`     ${mark.warn} ${c.gray(`그림 ${셈.뺀것.그림}장은 이 규격으로 못 옮겨 글만 남겼습니다.`)}`);
  if (셈.뺀것.생각) say(`     ${c.gray(`앞 모델의 생각 블록 ${셈.뺀것.생각}개는 새 규격에 실을 자리가 없어 뺐습니다.`)}`);
  /*
   * 파일에 못 적은 것은 **말한다.** 이번 대화는 멀쩡하니 조용히 넘어가고 싶지만,
   * 값을 치르는 것은 다음에 `--resume` 하는 사람이다 — 그때는 까닭이 아무 데도 없다.
   */
  if (셈.못적음?.length) {
    say(`     ${mark.warn} ${c.yellow(`그중 ${셈.못적음.length}곳은 파일에 못 적었습니다 — 이번 대화는 그대로 이어지지만, --resume 으로 다시 열면 옛 모양이 섞여 서버가 거절할 수 있습니다.`)}`);
    say(`     ${c.gray(`까닭: ${셈.못적음[0]}`)}`);
  }
}

/** 지금 연결을 이 프로필로 갈아끼운다. 대화는 규격이 같으면 그대로, 다르면 옮겨 적는다(대화옮기기). */
function 연결적용(session, p, ctx = null) {
  const 옛규격 = session.conn.kind;
  Object.assign(session.conn, {
    kind: p.kind, base: p.baseUrl, auth: p.auth, key: resolveKey(p), model: p.model,
    ctx: p.ctx, maxTokens: p.maxTokens ?? null,
    streaming: p.streaming, tools: p.tools, json: p.json, think: p.think,
    // 프로필마다 다를 수 있다 — 사내 게이트웨이는 잠잠 상한이 크고 로컬은 작다.
    잠잠: p.잠잠 ?? p.streamIdleMs ?? 잠잠기본,
    // 바이트는 오는데 내용이 안 올 때의 전체 상한 (backend/http.js 의 무소식기본).
    무소식: p.무소식 ?? p.streamNoNewsMs ?? 무소식기본,
    // 프로필마다 인증서가 다르다. 안 갈아 끼우면 옛 프로필의 신원으로 붙는다.
    인증서: 인증서설정(p),
    /*
     * ── 이 두 줄이 없어서 회사 토큰이 남의 창구로 나갔다 ────────────────
     *
     * conn 을 짓는 자리는 넷이다 — repl.js · oneshot.js · acp/serve.js, 그리고
     * 여기. 앞의 셋은 이 둘을 넣는데 여기만 빠져 있었다. 그래서 `/model` 로
     * 갈아타면 **옛 프로필의 것이 그대로 남았다.**
     *
     *   회사 프로필(열쇠받기로 SSO 토큰을 받아 온다) → /model 남의창구
     *     · 살아 있는 회사 토큰이 `Authorization` 에 실려 남의 host 로 간다
     *     · 새 프로필의 제 열쇠(conn.key)는 **쓰이지도 않는다** —
     *       adapter.js 의 머리말짓기 는 열쇠받기가 있으면 그쪽을 쓴다
     *     · 남의 창구는 그 토큰을 모르니 401, 그러면 로그인 명령을 다시 돌린다
     *
     * 반대쪽도 같다. 맨 프로필에서 회사 프로필로 옮기면 열쇠받기가 null 로
     * 남아 401 뒤에 열쇠를 다시 받는 길이 잠긴다(adapter.js 의 열쇠다시받을까).
     *
     * vision 도 같은 값이다 — 안 옮기면 그림을 못 보는 모델에 그림을 보낸다.
     */
    열쇠받기: 받기설정(p, { 정책값: 정책읽기().값 }),
    vision: p.vision ?? false,
  });
  /*
   * 들고 있던 토큰도 버린다.
   *
   * 열쇠받기 설정을 새것으로 갈아도, authcmd.js 가 **모듈 전역 하나**에
   * 받은 토큰을 들고 있다(받은것). 어느 프로필 것인지는 안 적혀 있다. 그래서
   * 안 버리면 새 창구의 첫 요청에 옛 회사 토큰이 그대로 실려 나간다 — 위에서
   * 고친 것을 캐시가 도로 되돌리는 셈이다.
   *
   * 이 함수의 머리말이 「검사와 `/model` 갈아타기가 부른다」 라고 적혀 있었는데
   * 부르는 곳이 검사밖에 없었다. 이제 적힌 대로가 된다.
   */
  받은열쇠잊기();
  /*
   * 급도 다시 맨다.
   *
   * 급은 conn 을 보고 매긴다(agent/grade.js 의 매김). 모델을 갈아탔는데 앞
   * 모델로 매긴 급을 턴 끝까지 들고 있으면, 화면에 적힌 급과 프롬프트에 실린
   * 급이 서로 다른 모델 이야기가 된다.
   */
  session.급다시재기?.();
  // 자물쇠도 같이 옮긴다. 이걸 빼먹으면 옛 주소가 열린 채로 남고 새 주소는 막혀
  // 다음 한마디에서 바로 "허용되지 않은 주소" 가 난다.
  allowEndpoint(p.baseUrl);
  // 어디 것인지도 같이 옮긴다. 요금표 주소 같은 안내가 옛 회사 것으로 남으면
  // 사람이 엉뚱한 요금표를 보러 간다.
  session.제공자 = p.제공자 ?? null;

  /*
   * 전선 카드도 **다시 달아 준다** (backend/wire.js).
   *
   * 안 다시 달면 옛 창구의 카드가 그대로 붙어 있다. 그것만으로 이런 일이
   * 난다 — Anthropic 으로 옮겼는데 카드는 `생각형식:'effort'` 라 생각이 안
   * 켜지고, `캐시:'열쇠'` 라 **캐시 표식이 한 자리도 안 붙는다.** 반대로
   * OpenAI 호환으로 옮기면 `스트림usage:false` 가 남아 usage 가 영영 안 와서
   * 상태줄의 ↑↓ 가 멈춰 선다. 그러면서 `/status` 는 옛 카드를 그대로 적는다 —
   * 화면과 전선이 어긋나는 것, 이 모듈이 없애겠다고 만든 바로 그 고장이다.
   *
   * 지우고 새로 단다. 안 지우면 `배운칸` 이 따라붙어서, 옛 창구가 거절한
   * 칸이 새 창구에서 「배운 것」 으로 남는다.
   */
  session.conn.전선 = null;
  전선붙이기(session.conn, ctx?.배움 ?? null);
  // 규격이 바뀌었으면 대화도 옮겨 적는다. 무엇을 옮겼는지는 부르는 쪽이 화면에 말한다.
  return 대화옮기기(session, 옛규격, p.kind, ctx);
}

/**
 * 지금 붙어 있는 서버가 내주는 모델 목록.
 *
 * 저장된 프로필에는 등록할 때 고른 모델 하나만 있다. 그런데 서버 한 대가
 * 모델을 여럿 내주는 경우가 대부분이다 — 특히 프록시나 게이트웨이가 그렇다.
 * 그래서 서버에 직접 물어본다. 자리를 새로 여는 게 아니라 이미 열린 자리다.
 */
async function 서버모델들(conn) {
  const { req, headersFor } = await import('../backend/http.js');
  if (conn.kind === 'ollama') {
    const r = await req(`${conn.base.replace(/\/v1\/?$/, '')}/api/tags`, { timeout: 4000 });
    /*
     * **못 받은 것**과 **안 내주는 것**은 다르다.
     *
     * req 는 통신 실패에 안 던지고 `{ok:false, status, error}` 를 준다. 여기만
     * 그 ok 를 안 보고 빈 배열을 돌려줘서, 404·500·시간초과·프록시 거절이
     * 전부 「이 서버는 모델 목록을 내주지 않습니다」 가 됐다. 다른 갈래는
     * 아래처럼 null 을 준다 — 같은 함수가 갈래마다 다른 약속을 하고 있었다.
     */
    if (!r.ok) return null;
    return (r.json?.models ?? []).map((m) => m.name ?? m.model).filter(Boolean);
  }
  /*
   * Azure 는 모델 목록이 `/models` 가 아니라 `/openai/deployments` 에 있다.
   * 여기를 안 고쳐 두면 `/model` 로 배포를 바꾸려는 순간
   * `.../deployments/gpt-4o?api-version=2024-10-21/models` 를 두드리고 404 다 —
   * 붙는 길만 고치고 바꾸는 길을 안 고치면 반쪽이다.
   */
  const { 애저인가, 애저풀기, 배포목록 } = await import('../backend/azure.js');
  if (애저인가(conn.base)) {
    const 푼것 = 애저풀기(conn.base);
    const a = await req(푼것.목록주소,
      { headers: headersFor(conn.auth ?? 'none', conn.key, 더할머리(conn.kind)), timeout: 4000 });
    if (!a.ok) return null;
    return 배포목록(a.json).map((m) => m.id);
  }
  /*
   * 판 머리를 같이 얹는다 (adapter.js 의 더할머리).
   *
   * Anthropic 은 `anthropic-version` 이 없으면 400 이다. 이 자리가 그것을
   * 빠뜨리고 있어서, 그 창구에서는 `/model` 이 목록을 못 받아 왔다 — 그리고
   * 목록을 못 받으면 화면은 「모델이 없습니다」 라고 적는다. 있는데.
   */
  const r = await req(`${conn.base.replace(/\/$/, '')}/models`, {
    headers: headersFor(conn.auth ?? 'none', conn.key, 더할머리(conn.kind)), timeout: 4000,
  });
  if (!r.ok) return null;
  const list = r.json?.data ?? r.json?.models ?? [];
  return Array.isArray(list)
    ? list.map((m) => (typeof m === 'string' ? m : m.id ?? m.name ?? m.model)).filter(Boolean)
    : null;
}

/**
 * /model — 연결·모델 바꾸기.
 *
 *   /model            골라 바꾸기 (연결 목록 + '이 서버의 다른 모델')
 *   /model <이름>     바로 바꾸기. 연결 이름이든 모델 이름이든 일부만 쳐도 된다
 *   /model list       무엇이 등록돼 있는지만 보기
 *   /model models     지금 서버가 내주는 모델을 물어보기
 */
export async function switchModel(session, ctx, arg = '') {
  const cfg = load();
  if (!cfg.profiles.length) {
    say(`  ${c.gray('저장된 연결이 없습니다.')} ${c.cyan('deel setup')} ${c.gray('또는')} ${c.cyan('deel scan --save')}`);
    say('');
    return;
  }
  const 말 = arg.trim();

  if (말 === 'list' || 말 === '목록') return 연결목록(cfg, session);
  if (말 === 'models' || 말 === '모델') return await 서버모델고르기(session, ctx, cfg);

  // 이름으로 바로 바꾸기 — 메뉴를 안 거친다.
  if (말) {
    const 찾은 = 이름으로찾기(cfg.profiles, 말);
    if (찾은.length === 1) return await 골라적용(session, cfg, 찾은[0], ctx);
    if (찾은.length > 1) {
      say(`  ${mark.warn} ${c.white(말)} ${c.gray('에 맞는 것이 여럿입니다.')}`);
      for (const p of 찾은.slice(0, 12)) say(`    ${c.cyan(p.name)}  ${c.gray(p.model)}`);
      say('');
      return;
    }
    // 등록된 것에 없으면, 지금 서버가 내주는 모델 중에 있는지 본다.
    const 있는것 = await 서버모델들(session.conn);
    const 맞는것 = 모델이름으로찾기(있는것, 말);
    if (맞는것.length === 1) return await 모델만바꾸기(session, cfg, 맞는것[0], ctx);
    if (맞는것.length > 1) {
      say(`  ${mark.warn} ${c.white(말)} ${c.gray('에 맞는 모델이 여럿입니다.')}`);
      for (const m of 맞는것.slice(0, 12)) say(`    ${c.cyan(m)}`);
      say('');
      return;
    }
    // 목록을 **못 받은** 것을 「없다」 로 적으면, 사람은 있는 모델을 찾아 헤맨다.
    if (있는것 == null) {
      say(`  ${mark.warn} ${c.white(말)} ${c.gray('에 맞는 연결이 없고, 서버에는 물어봤지만 목록을 못 받았습니다.')}`);
    } else {
      say(`  ${mark.warn} ${c.white(말)} ${c.gray('에 맞는 연결도 모델도 없습니다.')}`);
    }
    say(`  ${c.gray('무엇이 있는지 보려면')} ${c.cyan('/model list')}${c.gray(', 서버에 물어보려면')} ${c.cyan('/model models')}`);
    say('');
    return;
  }

  // 인자 없이 — 골라 바꾸기. 물어볼 수 없는 자리면 목록만 보여준다.
  if (!ctx?.ask) return 연결목록(cfg, session);

  const items = cfg.profiles.map((p) => ({
    label: `${pad(p.name, 22)} ${c.gray(p.model)}`,
    note: p.id === cfg.active ? '지금' : '',
  }));
  items.push({ label: c.cyan('이 서버의 다른 모델 고르기'), note: '서버에 물어봅니다' });

  const i = await pick('연결·모델 고르기', items, {
    def: Math.max(0, cfg.profiles.findIndex((p) => p.id === cfg.active)),
    ask: ctx?.ask,
  });
  if (i === cfg.profiles.length) return await 서버모델고르기(session, ctx, cfg);
  return await 골라적용(session, cfg, cfg.profiles[i], ctx);
}

function 이름으로찾기(profiles, 말) {
  const q = 말.toLowerCase();
  const 정확 = profiles.filter((p) => p.name.toLowerCase() === q || p.model.toLowerCase() === q || p.id.toLowerCase() === q);
  if (정확.length) return 정확;
  return profiles.filter((p) => `${p.name} ${p.model} ${p.id}`.toLowerCase().includes(q));
}

/**
 * 서버가 내주는 이름 중에서 고른다 — **정확히 같은 이름이 있으면 그것 하나다.**
 *
 * 프로필 쪽(바로 위 이름으로찾기)은 처음부터 정확한 것을 먼저 봤는데 이 길만
 * 안 봤다. 그래서 서버에 `gpt-4o` 와 `gpt-4o-mini` 가 같이 있으면
 * `/model gpt-4o` 가 「맞는 모델이 여럿입니다」 로 막혔다 — 사람이 있는 이름을
 * 그대로 적었는데 아무 일도 안 일어난다. 같은 자리에서 같은 규칙을 쓴다.
 * (2.0.0 6회차 모델고르기6cw-b)
 *
 * @param {string[]|null|undefined} 있는것 서버가 내준 이름들
 * @param {string} 말 사람이 적은 것
 */
export function 모델이름으로찾기(있는것, 말) {
  const q = String(말 ?? '').trim().toLowerCase();
  const 목록 = (있는것 ?? []).filter((m) => typeof m === 'string' && m);
  if (!q) return [];
  const 정확 = 목록.filter((m) => m.toLowerCase() === q);
  if (정확.length) return 정확;
  return 목록.filter((m) => m.toLowerCase().includes(q));
}

/*
 * 이 프로필로 갈아타면 바깥으로 나가는가. 나가면 한 번 묻는다.
 *
 * 켤 때 지나는 문(repl.js)과 **같은 문**이다. 여기를 안 지키면 자물쇠가
 * 반쪽이 된다 — 로컬로 켜서 물음을 지나친 다음, /model 로 바깥 프로필에
 * 갈아타는 순간 아무것도 안 묻고 나간다. 실제로 그렇게 쓴다: 한 시간쯤
 * 로컬로 하다가 「이건 큰 모델이 낫겠다」 하고 옮긴다.
 *
 * 허락은 프로필에 적힌다. 갈아탈 때마다 묻지 않는다.
 */
async function 나가도되나묻기(session, p) {
  const 모드 = session.실행모드 ?? 지금모드({});
  const 나감 = 나갈수있나(모드, { 바깥: 바깥인가(p.baseUrl), 허가: p.online === true });
  if (나감.되나) return true;

  const 어디 = 주소가리기((() => { try { return new URL(p.baseUrl).host; } catch { return String(p.baseUrl); } })());
  if (!나감.물어볼까) {
    // 봉인이다. 여기서 바꿔 주면 다음 한마디에서 막히는데, 그 화면만 보고는
    // 왜 막혔는지 알 수 없다 — 바꾸기 전에 말하는 편이 언제나 낫다.
    say(`  ${mark.warn} ${c.gray(`${어디} 는 이 컴퓨터 밖입니다. 지금은`)} ${c.white('봉인(--offline)')} ${c.gray('이라 안 바꿉니다.')}`);
    say('');
    return false;
  }
  say('');
  say(`  ${c.yellow('↗')} ${c.bold(어디)} ${c.gray('는 이 컴퓨터 밖입니다.')}`);
  say(`     ${c.gray('바꾸면 시킨 말과, 모델이 읽은 파일의 내용이 그리로 갑니다.')}`);
  const 예 = await confirm('나가도 될까요? (한 번 허락하면 이 연결은 다음부터 안 묻습니다)', true);
  if (!예) {
    say(`  ${c.gray('안 바꿨습니다. 아무것도 안 보냈습니다.')}`);
    say('');
    return false;
  }
  p.online = true;
  return true;
}

async function 골라적용(session, cfg, p, ctx = null) {
  if (!await 나가도되나묻기(session, p)) return;
  cfg.active = p.id;
  설정남기기(cfg);
  const 옮김 = 연결적용(session, p, ctx);
  say(`  ${mark.ok} ${c.bold(p.name)} ${c.gray(p.model)} 로 바꿨습니다. 대화는 이어집니다.`);
  옮김알리기(옮김, p.kind);
  say('');
}

/**
 * 새 프로필을 지을 때 **무엇을 통째로 베낄지** 고른다.
 *
 * 통째로다 — 열쇠도, 헤더도, 인증서 경로도 같이 간다. 그래서 여기서 엉뚱한
 * 것을 고르면 「지금 붙어 있는 주소에 **남의 서버 열쇠**가 달린 프로필」 이
 * 하나 새로 생기고, 다음에 켤 때 그대로 그 주소로 그 열쇠를 보낸다.
 *
 * 여태 `find(p => p.id === cfg.active) ?? cfg.profiles[0]` 였다. 두 갈래 다
 * **지금 붙어 있는 주소를 안 본다.** 설정 파일이 대화 도중 밖에서 바뀌거나
 * (다른 창에서 `/conn` 을 만졌거나, 파일을 손으로 고쳤거나) 지운 프로필이
 * active 로 남아 있으면, 남의 서버 프로필을 통째로 베낀다.
 *
 * 그래서 주소로 고른다. active 가 맞고 **주소도 같을 때**만 그것을 쓰고,
 * 아니면 같은 주소의 다른 프로필을 찾는다. 그것도 없으면 null 이다 —
 * 남의 열쇠를 베끼느니 아무것도 안 베끼는 편이 낫다(부르는 쪽이 `지금?.`
 * 으로 받는다).
 *
 * @param {object} cfg
 * @param {object} session
 * @returns {object|null} 베낄 프로필. 없으면 null.
 */
export function 베낄프로필(cfg, session) {
  const 있는것 = Array.isArray(cfg?.profiles) ? cfg.profiles : [];
  const 주소 = session?.conn?.base;
  return 있는것.find((p) => p.id === cfg?.active && p.baseUrl === 주소)
    ?? 있는것.find((p) => p.baseUrl === 주소)
    ?? null;
}

/**
 * 같은 서버에서 모델만 바꾼다.
 *
 * 등록된 연결이 아니어도 된다 — 서버가 내준다면 쓸 수 있어야 한다.
 * 다음에도 쓰도록 프로필로 남겨 둔다. 그래야 /model 목록에서 다시 보인다.
 */
async function 모델만바꾸기(session, cfg, 모델, ctx = null) {
  const 지금 = 베낄프로필(cfg, session);
  const 이미 = cfg.profiles.find((p) => p.baseUrl === session.conn.base && p.model === 모델);
  /*
   * 베낄 것이 없으면 **안 바꾼다.**
   *
   * 아래가 `{ ...지금, … }` 이었다. 베낄프로필() 머리말은 「없으면 null 이다 —
   * 부르는 쪽이 `지금?.` 으로 받는다」 고 적어 뒀는데, 받는 자리는 `지금?.id` ·
   * `지금?.name` 둘뿐이고 펼치기는 그대로였다. `{ ...null }` 은 빈 것이라
   * kind · auth · apiKey · streaming · tools · json · think · vision 이 하나도
   * 없는 프로필이 나왔고, 그것이 upsert 로 설정에 박히고 active 까지 됐다.
   * 화면은 초록 한 줄이었다 — 규격이 없어 openai 로 굳고(Anthropic·Ollama
   * 창구면 다음 한마디부터 400), 열쇠도 없어 401, 그리고 다음에 켤 때도 그 모양이다.
   *
   * 남의 열쇠를 안 베끼기로 한 것과 같은 까닭이다 — 반쪽을 짓느니 안 짓는다.
   */
  if (!이미 && !지금) {
    say(`  ${mark.no} ${c.gray('지금 붙어 있는 연결이 설정에 없어 새 프로필을 지을 수 없습니다.')}`);
    say(`  ${c.gray('  베낄 것이 없으면 규격·인증·열쇠가 빈 프로필이 남습니다 —')} ${c.cyan('deel setup')} ${c.gray('으로 이 연결을 먼저 등록하세요.')}`);
    say('');
    return;
  }
  const p = 이미 ?? {
    ...지금,
    id: `${(지금?.id ?? 'conn').replace(/-[^-]*$/, '')}-${String(모델).replace(/[^a-zA-Z0-9._-]+/g, '-')}`.slice(0, 60).toLowerCase(),
    name: `${(지금?.name ?? '연결').split(' · ')[0]} · ${모델}`,
    baseUrl: session.conn.base,
    model: 모델,
    // 컨텍스트 길이는 물려받지 않는다. 모델마다 다르다 —
    // 32k 짜리에서 655k 짜리로 옮겼는데 32k 로 깔고 앉으면 새 모델의 5% 만 쓴다.
    // 반대로 큰 데서 작은 데로 옮기면 긴 대화에서 서버가 거절한다. 아래에서 다시 잰다.
    ctx: null,
  };
  // 서버는 그대로지만 문은 같이 지난다. 등록 안 된 서버로 옮겨 가는 길도
  // 여기라서, 여기를 열어 두면 자물쇠에 구멍이 하나 남는다.
  if (!await 나가도되나묻기(session, p)) return;
  /*
   * 새로 만든 프로필도 **지금 쓰는 것**으로 못 박는다.
   *
   * upsert 는 active 가 비어 있을 때만 채운다. 여기서는 이미 차 있으므로,
   * 새 프로필을 넣기만 하고 active 는 옛 모델에 그대로 남았다 — 화면에는
   * 「모델을 X 로 바꿨습니다」 라고 적히고, 다음에 켜면 옛 모델로 돌아온다.
   * 이미 있는 프로필로 갈아탈 때(아래 갈래)는 제대로 하고 있었다.
   */
  if (!이미) upsert(cfg, p);
  cfg.active = p.id;
  설정남기기(cfg);
  const 옮김 = 연결적용(session, p, ctx);
  say(`  ${mark.ok} 모델을 ${c.bold(모델)} 로 바꿨습니다. ${c.gray('서버는 그대로입니다.')}`);
  옮김알리기(옮김, p.kind);
  await 길이맞추기(session, cfg, p);
  say('');
}

/**
 * 바뀐 모델에 맞춰 컨텍스트 길이를 다시 잰다.
 *
 * 모델을 바꾸는 순간은 이미 서버와 이야기하는 중이라 한 번 더 물어봐도 티가 안 난다.
 * 여기서 안 재면 새 모델을 옛 모델의 길이로 쓰게 된다 — 화면에는 아무 표시도 안 나고
 * 그냥 조용히 작아진다. 그런 고장이 가장 늦게 발견된다.
 */
export async function 길이맞추기(session, cfg, prof) {
  const { probeCtx, fmtSize, 기본값 } = await import('../backend/ctxsize.js');
  let r = null;
  // 물어보다 **터진 것**과 서버가 값을 **안 준 것**은 다르다. 아래에서 갈라 적는다.
  let 못물어본까닭 = null;
  try { r = await probeCtx(session.conn, { timeout: 8000 }); }
  catch (e) { 못물어본까닭 = String(e?.message ?? e); }
  /*
   * 적혀 있던 값은 **덮어쓰기 전에** 집어 둔다.
   *
   * 아래에서 `prof.ctx` 에 값을 써 넣고 나면 그 칸은 언제나 차 있다. 그 뒤에
   * `prof?.ctx` 를 보면 「이 프로필에 적혀 있던 값」 이 늘 참이 되어, 갓 만든
   * 프로필(ctx: null)에 서버가 길이를 안 알려 준 판까지 **적힌 적 없는 값을
   * 적혀 있던 값**이라고 말한다. 아래 머리말이 갈라 적겠다고 한 셋 중 하나가
   * 그렇게 통째로 죽어 있었다.
   */
  const 적혀있던 = prof?.ctx ?? null;
  const 값 = r?.value ?? 적혀있던 ?? 기본값;
  session.conn.ctx = 값;
  if (prof) {
    prof.ctx = 값;
    설정남기기(cfg);
  }
  /*
   * 어디서 온 값인지 **세 가지를 갈라** 적는다.
   *
   * 앞서는 물어보다 터진 것도, 서버가 안 준 것도, 프로필에 적혀 있던 값을
   * 물려받은 것도 전부 「서버가 안 알려줘 기본값」 이었다. 값이 655,360 인데
   * 출처는 「기본값」 이라고 적히는 판이 실제로 난다 — /ctx 화면은 출처를
   * 정성껏 가르는데 이 줄만 뭉갰다.
   */
  const 어디서 = r?.source ? r.source + '에서 읽음'
    : 못물어본까닭 ? '못 물어봤습니다 — ' + clip(못물어본까닭, 50)
      : r?.value == null && 적혀있던 ? '이 프로필에 적혀 있던 값'
        : '서버가 안 알려줘 기본값';
  say(`     ${c.gray('컨텍스트')} ${c.white(값.toLocaleString())} ${c.gray('토큰 (' + fmtSize(값) + ') — ' + 어디서)}`);
  if (r?.max && r?.loaded && r.max > r.loaded) {
    say(`     ${c.yellow('이 모델은 ' + r.max.toLocaleString() + ' 까지 됩니다.')} ${c.gray('서버에서 더 올린 뒤')} ${c.cyan('/ctx auto')}`);
  } else if (!r?.value) {
    say(`     ${c.gray('맞지 않으면')} ${c.cyan('/ctx 655360')} ${c.gray('처럼 직접 지정하세요.')}`);
  }
}

function 연결목록(cfg, session) {
  rule('등록된 연결', 70);
  for (const p of cfg.profiles) {
    const 지금 = p.id === cfg.active;
    say(`  ${지금 ? c.hgreen('●') : c.gray('·')} ${지금 ? c.bold(c.white(pad(p.name, 26))) : pad(p.name, 26)}${c.gray(p.model)}`);
    say(`      ${c.gray(p.baseUrl)}`);
  }
  say('');
  say(`  ${c.gray('바꾸려면')} ${c.cyan('/model <이름 일부>')}${c.gray(' — 연결 이름이든 모델 이름이든 됩니다.')}`);
  say(`  ${c.gray('이 서버가 내주는 다른 모델을 보려면')} ${c.cyan('/model models')}`);
  say('');
}

async function 서버모델고르기(session, ctx, cfg) {
  const s = spin('서버에 모델 목록을 물어보는 중…');
  let 있는것;
  /*
   * 무엇 때문에 못 받았는지를 **버리지 않는다.**
   *
   * 여기 catch 는 오프라인 잠금(NetBlocked)까지 삼켰다. 그러면 자물쇠가 막은
   * 것을 「이 서버는 목록을 안 내줍니다」 라고 서버 탓으로 돌리게 된다 —
   * 잠금이 화면에서 사라지는 것은 이 저장소가 여러 군데서 막으려던 그 꼴이다.
   */
  let 못받은까닭 = null;
  try { 있는것 = await 서버모델들(session.conn); }
  catch (e) { 있는것 = null; 못받은까닭 = String(e?.message ?? e); }
  s.stop('');
  if (!있는것 || !있는것.length) {
    if (못받은까닭) say(`  ${mark.warn} 모델 목록을 못 받았습니다 ${c.gray('— ' + clip(못받은까닭, 70))}`);
    else if (있는것 == null) say(`  ${mark.warn} 모델 목록을 못 받았습니다 ${c.gray('— 서버가 답을 안 주거나 주소·열쇠가 안 맞습니다.')}`);
    else say(`  ${mark.warn} 이 서버는 모델 목록을 내주지 않습니다.`);
    say(`  ${c.gray('목록이 없는 게이트웨이도 있습니다. 그때는')} ${c.cyan('deel setup')} ${c.gray('에서 모델 이름을 직접 넣으세요.')}`);
    say('');
    return;
  }
  // 물어볼 수 없는 자리면 목록만 보여주고 끝낸다.
  //
  // 여기서 그냥 pick 을 부르면 표준입력을 붙잡고 영영 안 끝난다.
  // 파이프로 넣거나 검사에서 돌릴 때가 그렇다 — 멈춘 것처럼 보이고 끊는 수밖에 없다.
  if (!ctx?.ask) {
    rule(`이 서버의 모델 (${있는것.length}개)`, 70);
    for (const m of 있는것) say(`  ${m === session.conn.model ? c.hgreen('●') : c.gray('·')} ${m === session.conn.model ? c.bold(m) : m}`);
    say('');
    say(`  ${c.gray('바꾸려면')} ${c.cyan('/model <이름 일부>')}`);
    say('');
    return;
  }

  const i = await pick(`이 서버의 모델 (${있는것.length}개)`, 있는것.map((m) => ({
    label: m, note: m === session.conn.model ? '지금' : '',
  })), {
    def: Math.max(0, 있는것.indexOf(session.conn.model)),
    ask: ctx.ask,
  });
  const 고른것 = 있는것[i];
  if (고른것 === session.conn.model) {
    say(`  ${c.gray('그대로 둡니다.')}`);
    say('');
    return;
  }
  await 모델만바꾸기(session, cfg, 고른것, ctx);
}
