// 슬래시 명령 — 하던 일을 다루는 것: 갈래 · 증거 · 그림 붙여넣기 · 리뷰 · 커밋 · 카드 · 못박기 · 배움 · 바뀐 것 보기.
// commands.js 에서 역할별로 나눠 옮겼다(2.0.0). 명령을 가르는 자리(handle)는 그대로 commands.js 에 있다.
import { existsSync } from 'node:fs';
import { 볼것, 리뷰받기 } from '../agent/review.js';
import { join } from 'node:path';
import { c, say, rule, pad, mark, clip } from '../ui/ansi.js';
import { 증거모으기, 증거적기 } from '../agent/evidence.js';
import { 커밋준비, 커밋실행 } from '../agent/commit.js';
import { confirm } from '../ui/prompt.js';
import { 말, 언어 } from '../i18n/index.js';
import { 알림채움, 알림말 } from '../backend/retry.js';
import { spin } from '../ui/spinner.js';
import { 전선붙이기, 전선말 } from '../backend/wire.js';
import { diffLines, renderDiff, shortStat } from '../ui/diff.js';
import { readTextFull } from '../tools/fsutil.js';
import { 클립보드그림, 그림앉히기 } from '../tools/clipboard.js';
import { 크기말 } from '../backend/vision.js';

/**
 * 대화 갈래.
 *
 * 여기서 하는 일은 화면과 말뿐이다. 갈래를 들고 있는 것은 agent/threads.js 다.
 */
export function 갈래명령(session, ctx, arg = '') {
  const 갈래 = ctx?.갈래;
  say('');
  if (!갈래) {
    // 한 번 돌리고 끝내는 자리(-p)에는 갈래가 없다. 없는 것을 있는 척하지 않는다.
    say(`  ${c.gray('이 자리에서는 갈래를 못 씁니다 — 대화 화면에서만 됩니다.')}`);
    say('');
    return;
  }

  const 말 = String(arg ?? '').trim();
  const [머리, ...나머지] = 말.split(/\s+/);
  const 뒷말 = 나머지.join(' ');
  const 알림 = (g) => {
    say(`  ${c.hcyan('⑂')} ${c.bold(g.이름)} ${c.gray('갈래로 왔습니다.')} `
      + c.gray(session.messages.length ? `오간 말 ${session.messages.length}개` : '빈 대화입니다'));
  };

  if (/^(new|새|새로)$/i.test(머리 ?? '')) {
    알림(갈래.새로(뒷말));
    say(`  ${c.gray('본줄기로 돌아가려면')} ${c.cyan('/thread 1')}`);
    say('');
    return;
  }

  if (/^(fork|갈라|분기)$/i.test(머리 ?? '')) {
    const g = 갈래.갈라내기(뒷말);
    say(`  ${c.hcyan('⑂')} ${c.bold(g.이름)} ${c.gray('로 갈라 나왔습니다.')} `
      + c.gray(`여기까지 오간 말 ${session.messages.length}개를 그대로 물려받았습니다.`));
    say(`  ${c.gray('여기서 무엇을 하든 본줄기는 그대로입니다.')}`);
    say('');
    return;
  }

  if (/^(close|닫기|끝)$/i.test(머리 ?? '')) {
    const r = 갈래.닫기(뒷말);
    if (!r.ok) say(`  ${c.red('못 닫았습니다')} ${c.gray(r.why)}`);
    else {
      say(`  ${mark.ok} ${c.gray(`${r.닫은것.이름} 갈래를 닫았습니다. 적어 둔 것은 남아 있습니다 —`)} ${c.cyan('/sessions')}`);
      알림(r.지금);
    }
    say('');
    return;
  }

  if (말) {
    const g = 갈래.옮기기(말);
    if (!g) {
      say(`  ${c.red('그런 갈래가 없습니다')} ${c.gray(말)}`);
      say(`  ${c.gray('/thread 만 치면 목록이 나옵니다.')}`);
    } else 알림(g);
    say('');
    return;
  }

  // 그냥 /thread — 목록.
  rule('대화 갈래', 70);
  for (const r of 갈래.목록()) {
    const 표 = r.지금 ? c.hcyan('▶') : c.gray(' ');
    const 이름 = r.지금 ? c.white(r.이름) : c.gray(r.이름);
    say(`  ${표} ${c.gray(String(r.번호))} ${pad(이름, 24)} ${c.gray(`말 ${String(r.말수).padStart(3)}개`)}`
      + (r.id ? `  ${c.gray(r.id)}` : ''));
  }
  say('');
  say(`  ${c.gray('/thread new [이름]')}   ${c.gray('빈 갈래로 나간다 — 곁가지 질문을 여기서')}`);
  say(`  ${c.gray('/thread fork [이름]')}  ${c.gray('지금까지를 물려받아 갈라 나간다')}`);
  say(`  ${c.gray('/thread <번호>')}       ${c.gray('그 갈래로 옮긴다')}`);
  say(`  ${c.gray('/thread close')}       ${c.gray('지금 갈래를 닫는다')}`);
  say('');
  say(`  ${c.gray('연결·모델·도구·되돌리기는 갈래끼리 같이 씁니다. 오간 말과 토큰만 따로입니다.')}`);
  say('');
}

/**
 * 증거 — 「다 됐습니다」 대신 검토할 수 있는 것.
 *
 * 화면에서 제일 중요한 것은 맨 아래 '증명 안 된 것' 이다. 바꾼 것을 늘어놓는
 * 일은 /diff 도 한다. 안 한 것을 말하는 자리는 여기뿐이다.
 */
export function 증거명령(session, ctx, arg = '') {
  const e = 증거모으기(session, { audit: ctx?.audit });
  const 말 = String(arg ?? '').trim();
  say('');
  rule('작업 증거', 70);

  /*
   * 기록이 새고 있으면 **목록보다 먼저** 말한다.
   *
   * 이 화면은 감사기록을 읽어서 만든다. 기록이 안 적히면 목록이 짧아지는
   * 게 아니라 「아무것도 안 했다」로 보인다 — 아래 이른 반환이 그 자리다.
   * 안 한 것을 말하라고 만든 화면이 안 한 것처럼 보이게 하면 안 된다.
   */
  if (e.기록못씀) {
    say(`  ${mark.warn} ${c.yellow(`감사기록 ${e.기록못씀.수}건이 안 적혔습니다`)} ${c.gray(`— ${clip(e.기록못씀.까닭, 60)}`)}`);
    say(`  ${c.gray('아래는 실제로 한 것보다 짧습니다.')}`);
    say('');
  }

  if (!e.바꾼것.length && !e.돌린것.length) {
    say(`  ${c.gray('이번 대화에서 아직 바꾸거나 돌린 것이 없습니다.')}`);
    say('');
    return;
  }

  if (e.바꾼것.length) {
    say(`  ${c.bold('바꾼 것')} ${c.gray(`— 파일 ${e.셈.파일}개 · +${e.셈.더한줄} / -${e.셈.뺀줄}`)}`);
    for (const x of e.바꾼것.slice(0, 12)) {
      const 표 = x.증명 ? c.green('✓') : c.yellow('?');
      const 뒤 = x.증명 ? c.gray(`← ${x.증명}`) : c.yellow('확인 안 됨');
      say(`    ${표} ${pad(x.파일, 34)} ${c.gray(`+${x.더한줄} -${x.뺀줄}`)}  ${뒤}`);
    }
    if (e.바꾼것.length > 12) say(`    ${c.gray(`… 그 밖에 ${e.바꾼것.length - 12}개`)}`);
    say('');
  }

  if (e.돌린것.length) {
    say(`  ${c.bold('돌린 것')} ${c.gray(`— ${e.셈.돌린것}개${e.셈.실패한것 ? `, 그중 ${e.셈.실패한것}개 실패` : ''}`)}`);
    for (const x of e.돌린것.slice(-10)) {
      const 표 = x.됐나 ? c.green('✓') : c.red('✗');
      say(`    ${표} ${clip(x.무엇 || x.도구, 44)} ${c.gray(clip(x.남긴말 ?? '', 24))}`);
    }
    say('');
  }

  // 여기가 요점이다.
  if (e.증명안된것.length) {
    say(`  ${c.yellow('증명 안 된 것')} ${c.gray(`— ${e.증명안된것.length}개`)}`);
    for (const x of e.증명안된것.slice(0, 8)) {
      say(`    ${c.yellow('·')} ${c.bold(x.파일)}`);
      say(`      ${c.gray(x.왜)}`);
    }
    say('');
    say(`  ${c.gray('돌려 볼 것이 있으면 지금 돌리고 다시 보세요.')}`);
  } else if (!e.바꾼것.length) {
    /*
     * 바꾼 파일이 없으면 「증명 안 된 것 없음」 은 맞는 말이지만 **엉뚱한 말**이다.
     *
     * 이 자리는 명령만 돌리고 파일은 안 건드린 판이다(둘 다 없으면 위에서
     * 일찍 끝난다). 초록 글씨에 「바꾼 것마다 그 뒤에 돌린 확인이 있습니다」
     * 가 붙으면 사람은 자기가 고친 것이 확인까지 됐다고 읽는다 — 고친 것이
     * 아예 없는데도. 빈 것을 두고 참이라고 말하는 자리다.
     */
    say(`  ${c.gray('바꾼 파일이 없습니다 — 증명할 것도 없습니다.')}`);
  } else {
    say(`  ${c.green('증명 안 된 것 없음')} ${c.gray('— 바꾼 것마다 그 뒤에 돌린 확인이 있습니다.')}`);
  }
  say('');

  if (/^(파일|file|저장|save)$/i.test(말)) {
    const 이름 = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;
    const 탈 = {};
    const 자리 = 증거적기(session.root, e, 이름, 탈);
    if (자리) say(`  ${mark.ok} ${c.gray('남겼습니다 —')} ${c.cyan(자리)}`);
    else {
      say(`  ${c.gray('파일로 못 남겼습니다. 화면 것만 쓰세요.')}`);
      if (탈.왜) say(`  ${c.gray(clip(탈.왜, 90))}`);
    }
    say('');
  } else {
    say(`  ${c.gray('파일로 남기려면')} ${c.cyan('/evidence 파일')}`);
    say('');
  }
}

/*
 * `/paste` — 클립보드에 든 화면 캡처를 붙인다 (tools/clipboard.js).
 *
 * 돌려주는 것은 `@경로` 한 줄이다. 그러면 바깥(repl.js)의 @-붙이기가 평소대로
 * 그림을 실어 보낸다 — 예산 셈도, 눈 없는 모델일 때의 처리도 그쪽에 이미
 * 있으니 두 벌로 만들지 않는다.
 *
 * 세 가지를 갈라 말한다. 「그림이 없다」(사람이 캡처를 다시 하면 된다),
 * 「못 꺼냈다」(까닭과 길을 준다), 「눈이 없는 모델이다」(붙여도 못 본다).
 * 셋을 뭉뚱그려 「안 됩니다」로 내면 사람은 무엇을 고쳐야 할지 모른다.
 */
export function 붙여넣기명령(session, ctx, { 꺼내기 = 클립보드그림 } = {}) {
  // 꺼내기를 갈아 끼울 수 있게 열어 둔다 — 검사가 **사람의 진짜 클립보드를
  // 건드리지 않고** 세 갈래(그림 있음·없음·못 꺼냄)를 다 재려면 이 자리가 필요하다.
  const r = 꺼내기();
  if (!r.ok) {
    if (r.없음) {
      say(`  ${mark.warn} ${c.gray('클립보드에 그림이 없습니다. 화면을 캡처한 뒤 다시 /paste 하세요.')}`);
      say(`  ${c.gray('(윈도우: Win+Shift+S · 맥: Cmd+Ctrl+Shift+4)')}`);
    } else {
      for (const 줄 of String(r.왜).split('\n')) say(`  ${mark.warn} ${c.gray(줄)}`);
    }
    return { handled: true };
  }

  let 앉힌것;
  try {
    앉힌것 = 그림앉히기(r.buf, join(ctx?.scope?.root ?? session.root, '.deel'));
  } catch (err) {
    say(`  ${mark.warn} ${c.gray(`그림을 저장 못 했습니다: ${err.message}`)}`);
    return { handled: true };
  }

  const 보일 = ctx?.scope?.show ? ctx.scope.show(앉힌것.자리) : 앉힌것.자리;
  say(`  ${c.blue('◧')} ${c.gray('클립보드에서 가져와 앉혔습니다')} ${c.white(보일)} ${c.gray(`(${크기말(앉힌것.바이트)})`)}`);

  // 눈이 없는 모델이면 붙여도 못 본다. 보내기 전에 말한다 — 보내고 나서
  // "그림이 안 보인다" 는 답을 받으면 사람은 이 기능이 고장 난 줄 안다.
  if (!session.conn?.vision) {
    say(`  ${mark.warn} ${c.gray('지금 모델은 그림을 못 봅니다 — 파일은 남았지만 글로만 나갑니다.')}`);
  }
  return { handled: false, text: `@${보일}` };
}

/*
 * `/review` — 이번에 바꾼 것을 새 창에서 한 번 더 본다 (agent/review.js).
 *
 * 여기서는 **아무것도 안 고친다.** 찾은 것을 늘어놓고 끝이다. 고칠지 말지는
 * 사람이 정한다. 리뷰가 제 손으로 고치기 시작하면 사람이 무엇을 승인한 것인지
 * 흐려진다.
 */
export async function 리뷰명령(session, ctx) {
  const 것 = 볼것(session, ctx);
  if (!것.ok) {
    say('');
    say(`  ${c.gray(것.왜)}`);
    say('');
    return;
  }

  rule(`리뷰 — ${것.어디}`, 70);
  say(`  ${c.gray(것.통계.split(/\r?\n/).pop()?.trim() || `${것.파일들.length}개 파일`)}`);
  say(`  ${c.gray('지금 대화는 안 보냅니다 — 바뀐 코드만 새 창에서 봅니다.')}`);
  say('');

  const s = spin('보는 중...');
  const r = await 리뷰받기(session, 것, {
    signal: ctx.signal ?? null,
    onBackoff: (다시) => s.set?.(`서버가 잠깐 막아 ${Math.round((다시.wait ?? 0) / 1000)}초 기다리는 중...`),
  });
  s.stop('');

  if (!r.ok) {
    say(`  ${mark.no} ${c.red('못 봤습니다')} ${c.gray(`— ${r.왜}`)}`);
    say('');
    return;
  }

  /*
   * 가른 것이 없으면 **원문을 그대로** 보여 준다.
   *
   * 모델이 형식을 안 지켰다고 아무것도 안 보여 주면, 사람은 리뷰가 아무것도
   * 못 찾은 줄 안다. 우리가 못 읽은 것이지 모델이 침묵한 것이 아니다.
   */
  if (!r.찾은것.length) {
    for (const 줄 of r.글.split(/\r?\n/)) say(`  ${줄}`);
    say('');
    return;
  }

  const 색 = { 심각: c.red, 보통: c.yellow, 사소: c.gray };
  for (const f of r.찾은것) {
    const 칠 = 색[f.급] ?? c.white;
    say(`  ${칠(f.머리)}`);
    for (const 줄 of f.몸) if (줄.trim()) say(`    ${c.gray(줄.trim())}`);
    say('');
  }
  const 셈 = ['심각', '보통', '사소'].map((g) => [g, r.찾은것.filter((x) => x.급 === g).length]).filter(([, n]) => n);
  say(`  ${c.gray(셈.map(([g, n]) => `${g} ${n}`).join(' · '))}`);
  // 자리를 못 짚은 지적은 몇 개인지 적는다. 찾아갈 수 없는 지적은 값이 다르다.
  const 자리없음 = r.찾은것.filter((x) => !x.자리).length;
  if (자리없음) say(`  ${c.gray(`${자리없음}개는 파일:줄 을 안 짚었습니다 — 그만큼 확인하기 어렵습니다.`)}`);
  say(`  ${c.gray('아무것도 안 고쳤습니다. 고칠 것을 골라 시키세요.')}`);
  say('');
}

/**
 * /commit — 이번 대화가 바꾼 것을 커밋한다.
 *
 * 화면에서 지키는 것 두 가지.
 *
 *   1) **찍기 전에 다 보여 준다.** 메시지 전문과 `git status --short` 를
 *      먼저 낸다. 커밋은 남는 것이고, 남을 것을 안 보여 주고 남기면 사람은
 *      나중에 `git log` 에서 처음 읽게 된다. 그때는 이미 늦다.
 *   2) **놀랄 자리를 미리 말한다.** 남이 먼저 담아 둔 것(index)이 있으면
 *      그것도 같이 실린다고 적는다. 우리가 말없이 풀어 버리면 남의 준비가
 *      사라지고, 말없이 실으면 남의 변경이 이 커밋에 묻어 들어간다.
 *      둘 다 나쁘니 풀지 않고 알린다.
 *
 * push 는 안 한다. 그건 되돌릴 수 없는 자리라 사람이 직접 할 일이다.
 */
export async function 커밋명령(session, ctx, arg = '') {
  const 말한것 = String(arg ?? '').trim();
  /*
   * `전부` 뒤에 제목을 같이 적을 수 있다.
   *
   * 앞서는 `^(전부|all)$` 라 `/commit 전부 버그 수정` 이 **둘 다** 어긋났다 —
   * 전부가 거짓이 되어 폴더째 바뀐 파일이 빠지고, `전부 버그 수정` 이 통째로
   * 커밋 제목이 됐다. 어느 쪽도 화면에 안 적힌다.
   */
  const 전부친것 = /^(전부|all)(\s+|$)/i.exec(말한것);
  const 전부 = !!전부친것;
  const 남은말 = 전부 ? 말한것.slice(전부친것[0].length).trim() : 말한것;
  const 미리보기 = /^(미리보기|preview|dry|--dry-run)$/i.test(남은말);
  const 준제목 = 미리보기 ? null : (남은말 || null);

  say('');
  rule('커밋', 70);

  const 도는말 = '메시지를 짓는 중…';
  let 돌림 = spin(도는말);
  const r = await 커밋준비(session, ctx, {
    전부,
    제목: 준제목,
    onBackoff: (알림) => {
      돌림.stop((알림.미리
              ? `  ${c.yellow('⏸')} ${c.gray(말(알림말(알림), { 초: 알림채움(알림).초 }))}`
              : `  ${c.yellow('↻')} ${c.gray(말('loop.backoff', 알림채움(알림)))}`));
      돌림 = spin(도는말);
    },
  });

  if (!r.ok) {
    돌림.stop(`  ${c.gray(r.why)}`);
    say('');
    return;
  }
  돌림.stop(`  ${c.bold('담은 것')} ${c.gray(`— 파일 ${r.파일들.length}개`)}`);

  for (const f of r.파일들.slice(0, 12)) say(`    ${c.gray('·')} ${c.white(f)}`);
  if (r.파일들.length > 12) say(`    ${c.gray(`… 그 밖에 ${r.파일들.length - 12}개`)}`);
  if (r.살림뺌) {
    say(`    ${c.gray('· .deel/ 은 안 담았습니다 — 열쇠와 감사기록이 든 곳입니다')}`);
  }
  if (r.폴더통째?.length) {
    say('');
    say(`  ${c.yellow('폴더째 바뀐 자리는 안 담았습니다')} ${c.gray(`— ${r.폴더통째.slice(0, 4).join(', ')}`)}`);
    say(`  ${c.gray('그 안에는 남이 고치던 파일도 있습니다. 통째로 담으려면')} ${c.cyan('/commit 전부')}`);
  }
  if (r.딴저장소?.length) {
    say('');
    say(`  ${c.yellow('딴 저장소 안에서 바뀐 것은 안 담았습니다')} ${c.gray(`— ${r.딴저장소.slice(0, 4).join(', ')}`)}`);
    say(`  ${c.gray('서브모듈·안쪽 저장소는 그 폴더에서 따로 커밋해야 합니다.')}`);
  }
  /*
   * 만들었다 지워서 git 이 이름조차 못 본 파일 (8회차 커밋2 · agent/commit.js 의 모르는이름).
   *
   * 커밋준비() 가 그 이름들을 돌려주는데 찍는 자리는 여기뿐이었다. 안 찍으면 담을 것이
   * **같이 있는** 판에서 커밋은 그냥 되고 그 이름들만 조용히 빠진다 — 「만들었다 지운
   * 것뿐」 인 판만 why 로 말하고 있었다. 위 폴더통째·딴저장소와 같은 까닭이라 같은 꼴로 적는다.
   */
  if (r.모르는이름?.length) {
    say('');
    say(`  ${c.yellow('만들었다 지운 파일은 안 담았습니다')} ${c.gray(`— ${r.모르는이름.slice(0, 4).join(', ')}`)}`);
    say(`  ${c.gray('git 이 한 번도 본 적 없는 이름이라 담을 수가 없습니다.')}`);
  }
  if (r.남의것.length) {
    say('');
    say(`  ${c.yellow('먼저 담겨 있던 것도 같이 실립니다')} ${c.gray(`— ${r.남의것.slice(0, 6).join(', ')}`)}`);
    say(`  ${c.gray('빼려면 `git restore --staged <파일>` 뒤에 다시 부르세요.')}`);
  }

  say('');
  say(`  ${c.bold('메시지')}`);
  for (const line of r.메시지.trimEnd().split('\n')) {
    say(`    ${line.trim() ? c.white(clip(line, 76)) : ''}`);
  }
  if (r.사실로만) {
    say('');
    say(`  ${c.yellow('모델이 메시지를 못 만들어 바뀐 것만 적었습니다.')}`);
  }
  /*
   * diff 를 못 읽고 지은 메시지라면 그렇다고 적는다.
   *
   * 담긴 것이 64MB 를 넘으면 git 이 몸통을 못 뱉는다. 파일 목록은 멀쩡해서
   * 커밋은 그대로 이어지는데, 그때 메시지는 **내용을 한 줄도 안 보고** 지은
   * 것이다. 그 사실이 화면에 없으면 사람은 여느 메시지와 똑같이 믿는다.
   */
  if (r.diff못읽음) {
    say('');
    say(`  ${c.yellow('내용(diff)을 못 읽고 지은 메시지입니다')} ${c.gray(`— ${clip(r.diff못읽음, 60)}`)}`);
    say(`  ${c.gray('파일 이름과 줄 수만 보고 썼습니다. 찍기 전에 한 번 읽어 주세요.')}`);
  }

  const 상태줄 = r.상태 ? r.상태.split('\n') : [];
  if (상태줄.length) {
    say('');
    say(`  ${c.bold('git status --short')}`);
    for (const line of 상태줄.slice(0, 10)) say(`    ${c.gray(clip(line, 76))}`);
    if (상태줄.length > 10) say(`    ${c.gray(`… 그 밖에 ${상태줄.length - 10}줄`)}`);
  }
  say('');

  if (미리보기) {
    /*
     * ── 「찍지 않았습니다」 가 「아무것도 안 했습니다」 로 읽혔다 ──────────
     *
     * 이 줄까지 오는 사이에 커밋준비() 는 이미 `git add` 를 돌렸다
     * (agent/commit.js 의 담기). 그래야 담긴 것을 기준으로 diff 를 뜨고
     * 메시지를 지을 수 있다 — 미리보기가 진짜 커밋과 **같은 것**을 보여
     * 주려면 그 길밖에 없다.
     *
     * 그런데 화면은 「찍지 않았습니다」 한 줄이었다. 사람은 아무 일도 안
     * 난 줄 알고 나가는데, 작업 폴더의 index 는 바뀌어 있다. 그 뒤에
     * `git status` 나 손으로 `git commit` 을 하면 제가 담은 적 없는 것이
     * 담겨 있다.
     *
     * 바로 아래 엄격 모드 무름 갈래는 같은 일을 하고 **적는다** —
     * 「안 찍었습니다. 담은 것은 그대로 둡니다.」 여기만 안 적었다.
     * 적는 쪽으로 맞춘다.
     */
    say(`  ${c.gray('미리보기입니다 — 찍지 않았습니다.')} ${c.gray('메시지를 지으려고 담기(git add)까지는 했습니다 — 담은 것은 그대로 둡니다.')}`);
    say(`  ${c.gray('그대로 찍으려면')} ${c.cyan('/commit')}${c.gray(', 담은 것을 풀려면')} ${c.cyan('git reset')}`);
    say('');
    return;
  }

  // 엄격 모드에서만 묻는다. 여기서 무르면 담은 것은 그대로 둔다 —
  // 사람이 메시지만 다시 받고 싶을 수도 있는데, 담은 것까지 풀면 처음부터다.
  if (session.mode === 'strict') {
    const 예 = await confirm('이대로 커밋할까요?', true);
    if (!예) {
      say(`  ${c.gray('안 찍었습니다. 담은 것은 그대로 둡니다.')}`);
      say('');
      return;
    }
    // 묻는 사이에 담긴 것이 바뀌었을 수 있다(다른 창·다른 도구). 보여 준 것과
    // 다른 것을 찍으면, 승인을 받은 의미가 없어진다.
    const 지금 = r.다시확인();
    if (JSON.stringify(지금) !== JSON.stringify(r.파일들)) {
      say(`  ${c.yellow('묻는 사이에 담긴 것이 바뀌었습니다')} ${c.gray(`— 보여 준 ${r.파일들.length}개 → 지금 ${지금.length}개`)}`);
      say(`  ${c.gray('안 찍었습니다. 다시')} ${c.cyan('/commit')} ${c.gray('으로 확인하세요.')}`);
      say('');
      return;
    }
  }

  const 찍음 = 커밋실행(r.뿌리, r.메시지, { audit: ctx?.audit, 파일들: r.파일들, 제목: r.제목 });
  if (!찍음.ok) {
    say(`  ${c.red('✗')} ${c.gray(clip(찍음.why, 90))}`);
    /*
     * 찍기는 실패했어도 담기(git add)는 이미 했다 (2.0.0 6회차 · Gemini 커밋6t V3).
     * 미리보기·엄격 무름 갈래는 그렇다고 적는데 여기만 git 오류 한 줄로 끝났다 —
     * 훅이 막은 뒤 사람이 손으로 커밋하면 에이전트가 담은 것이 같이 실린다.
     * 푸는 것은 사람 몫이다: 훅을 고치고 다시 /commit 하면 담은 것을 그대로 쓴다.
     */
    say(`  ${c.gray('찍지 못했습니다 — 담은 것(git add)은 그대로 둡니다. 풀려면')} ${c.cyan('git reset')}`);
    say('');
    return;
  }
  say(`  ${mark.ok} ${c.green(찍음.hash)} ${c.white(clip(r.제목, 60))}`);
  if (r.미확인 > 0) say(`     ${c.yellow(`검증: ${r.확인}건 확인 · ${r.미확인}건 미확인`)} ${c.gray('— 메시지에도 적었습니다')}`);
  say(`     ${c.gray('push 는 안 했습니다. 되돌리려면')} ${c.cyan('git reset --soft HEAD~1')}`);
  say('');
}

/**
 * 모델 카드 — 겪어 본 버릇과, 그 때문에 deel 이 바꾼 것.
 *
 * 여기서 중요한 것은 아래쪽 '그래서 바꾼 것' 이다. 위쪽 숫자만 보여 주면
 * 그냥 통계지만, 무엇이 달라졌는지까지 보여야 사람이 판단할 수 있다 —
 * "이 모델을 계속 쓸까, 다른 걸 받을까" 가 실제로 묻는 것이다.
 */
export function 카드명령(session, ctx) {
  const 장 = ctx?.카드다시?.() ?? ctx?.카드 ?? null;
  say('');
  if (!장) {
    say(`  ${c.gray('이 자리에서는 못 봅니다 — 대화 화면에서만 됩니다.')}`);
    say('');
    return;
  }

  rule('모델 카드', 70);
  say(`  ${c.bold(장.모델 || '(이름 없음)')}  ${c.gray(`· 같이 걸어 본 걸음 ${장.걸음}`)}`);
  /*
   * 미리 아는 모델이면 이름표 한 줄 (agent/preset.js). 겪어서 안 것이 아니라
   * 공개 문서로 아는 것이라, '겪어 본 버릇' 과 섞이지 않게 따로 선다.
   */
  if (장.내장) {
    const 표지 = 언어() === 'en' ? 'known model' : '아는 모델';
    say(`  ${c.hcyan('◆')} ${c.bold(장.내장.이름)} ${c.gray(`· ${표지}`)}`);
    if (장.내장.한줄) say(`    ${c.gray(장.내장.한줄)}`);
  }
  say('');

  const 줄 = (이름, v) => {
    if (!v?.n) return;
    const 센가 = v.율 >= 0.15;
    const 표 = 센가 ? c.yellow('●') : c.gray('○');
    say(`    ${표} ${pad(이름, 18)} ${pad(String(v.n), 5, 'right')} ${c.gray(`(${Math.round(v.율 * 100)}%)`)}`);
  };
  say(`  ${c.bold('겪어 본 버릇')}`);
  줄('인자가 잘림', 장.버릇.잘린인자);
  줄('빈 답', 장.버릇.빈답);
  줄('편집이 빗나감', 장.버릇.편집실패);
  줄('같은 것 되풀이', 장.버릇.되풀이);
  if (!Object.values(장.버릇).some((v) => v.n)) say(`    ${c.gray('아직 걸린 것이 없습니다.')}`);
  if (장.보정 && Math.abs(장.보정 - 1) > 0.01) {
    say(`    ${c.gray(pad('토큰 추정 보정', 18))} ${pad(`×${장.보정.toFixed(2)}`, 5, 'right')}`);
  }
  say('');

  say(`  ${c.bold('그래서 바꾼 것')}`);
  if (장.아직모름) {
    say(`    ${c.gray('아직 판단하지 않습니다 — 몇 걸음 안 걸어 보고 바꾸면 멀쩡한 모델을 붙들어 맵니다.')}`);
  } else if (!장.왜.length) {
    say(`    ${c.gray('바꾼 것 없음. 이 모델은 그대로 두어도 괜찮습니다.')}`);
  } else {
    for (const w of 장.왜) say(`    ${c.hcyan('→')} ${w}`);
  }
  say('');
  say(`  ${c.gray('이 카드는 프롬프트에 안 실립니다 — deel 이 제 행동을 바꾸는 것이라 모델에게 말할 필요가 없습니다.')}`);
  say('');
}

/**
 * 못 박기.
 *
 * 여기서 하는 일은 화면과 말뿐이다. 들고 있는 것은 agent/pins.js 이고,
 * 그것이 session 에 붙어 있어서 접기·요약이 닿지 못한다.
 */
export function 못박기명령(session, ctx, arg = '') {
  const 못 = session?.못박은것;
  say('');
  if (!못) {
    say(`  ${c.gray('이 자리에서는 못 씁니다 — 대화 화면에서만 됩니다.')}`);
    say('');
    return;
  }

  const 적어두기 = () => { try { ctx?.갈래?.현재store?.()?.못박기목록(못.직렬화()); } catch { /* 못 적어도 대화는 계속된다 */ } };
  const 말 = String(arg ?? '').trim();
  const [머리, ...나머지] = 말.split(/\s+/);

  /*
   * ── 지우기는 **뒤에 오는 것까지** 봐야 한다 (8회차 그밖 명령5) ──────────
   *
   * 머리 낱말만 봤다. 그래서 `/pin 지우기 전에 백업 필수` 같은 **규칙**이 지우기 갈래로 새고,
   * 못은 안 박힌 채 화면에는 「번호를 적거나 `전부` 라고 하세요」 가 떴다. 못 박기는 사람이
   * 「이것만은 지켜라」 를 적는 자리라, 안 박힌 것을 박힌 줄 알고 넘어가는 것이 제일 비싸다.
   * 지우기가 받는 것은 번호와 `전부` 뿐이니(agent/pins.js 의 지우기), 뒤가 그 둘이 아니면
   * 지우라는 말이 아니라 **지우기로 시작하는 규칙**이다.
   */
  const 뒤 = 나머지.join(' ').trim();
  const 지우라는말 = /^(지우기|빼기|clear|rm|remove)$/i.test(머리 ?? '')
    && (!뒤 || /^(\d+|전부|다|all|\*)$/i.test(뒤));
  if (지우라는말) {
    const r = 못.지우기(뒤 || '전부');
    if (!r.ok) say(`  ${c.red(r.why)}`);
    else if (typeof r.뺀것 === 'number') say(`  ${mark.ok} ${c.gray(`못 박아 둔 것 ${r.뺀것}개를 뺐습니다.`)}`);
    else say(`  ${mark.ok} ${c.gray('뺐습니다 —')} ${r.뺀것}`);
    적어두기();
    say('');
    return;
  }

  if (말) {
    const r = 못.더하기(말);
    if (!r.ok) {
      say(`  ${c.red(r.why)}`);
      say('');
      return;
    }
    적어두기();
    // 사람이 친 원문이 아니라 **박힌 말**을 보여 준다. 한 줄 상한을 넘겨 잘렸으면 그렇다고 말한다(agent/pins.js 의 더하기).
    say(`  ${c.hcyan('📌')} ${c.bold(`${r.번호}.`)} ${r.말}`);
    if (r.잘렸나) say(`  ${c.yellow('한 줄이 길어 뒤를 잘라 박았습니다 — 위에 보이는 데까지만 지켜집니다. 긴 규칙은 AGENTS.md 같은 규칙 파일에 적으세요.')}`);
    say(`  ${c.gray('접거나 요약해도 안 지워집니다. 빼려면')} ${c.cyan(`/pin 지우기 ${r.번호}`)}`);
    say('');
    return;
  }

  const 목록 = 못.목록();
  rule('못 박은 것', 70);
  if (!목록.length) {
    say(`  ${c.gray('아직 없습니다. 대화 내내 지켜야 할 말을 박아 두세요.')}`);
    say(`  ${c.gray('예:')} ${c.cyan('/pin 운영 DB 는 건드리지 마라')}`);
    say('');
    return;
  }
  for (const x of 목록) say(`  ${c.hcyan(`${x.번호}.`)} ${x.말}`);
  say('');
  const 실린것 = 못.실린것();
  say(`  ${c.gray(`매 턴 프롬프트에 실립니다 — 지금 ${실린것.개수}개, ${실린것.토큰}토큰.`)}`);
  if (!실린것.다실렸나) {
    say(`  ${c.yellow(`자리가 모자라 뒤의 ${목록.length - 실린것.개수}개는 안 실립니다.`)} ${c.gray('짧게 줄이거나 빼세요.')}`);
  }
  say('');
}

/**
 * 쓰면서 저절로 알게 된 것.
 *
 * 보여 주는 것이 중요하다. 프롬프트에 몰래 들어가는 글이 있으면 사람은
 * 모델이 왜 그렇게 답했는지 알 수 없게 된다 — 여기서 통째로 볼 수 있어야
 * '자동으로 쌓인다' 가 무섭지 않은 말이 된다. 지우는 길도 같이 둔다.
 */
export function 배움명령(session, ctx, arg = '') {
  const 배움 = ctx?.배움;
  say('');
  if (!배움) {
    say(`  ${c.gray('이 자리에서는 못 봅니다 — 대화 화면에서만 됩니다.')}`);
    say('');
    return;
  }

  /*
   * ── 전선만 지우는 길 ────────────────────────────────────────────────────
   *
   * 전선 모양은 틀리게 배울 수 있는 유일한 것이고(backend/wire.js), 틀리면
   * 멀쩡한 기능이 꺼진 채 굳는다. 그런데 되돌릴 길이 「전부 비우기」 하나라,
   * 몇 주 쌓은 명령 겪음까지 같이 날아갔다 — 그게 아까워서 사람은 안 비우고,
   * 안 비우니 꺼진 기능을 그냥 안고 쓴다. 전선만 지우면 잃을 것이 없다.
   */
  /*
   * 지우는 말은 **반드시 적어야** 한다.
   *
   * 앞서는 `\s*(…)?` 라 `/learned 전선` 만 쳐도 곧바로 지웠다. 화면이 알려
   * 주는 명령은 `/learned 전선 지우기` 라 그 짧은 꼴은 어디에도 안 적혀
   * 있는데, 「전선에서 뭘 배웠나 보자」 는 마음으로 치면 그것이 지우는
   * 명령이 됐다. 지우는 명령은 지우겠다고 적었을 때만 지운다.
   */
  if (/^(전선|wire)$/i.test(String(arg).trim())) {
    say(`  ${c.gray('전선에서 배운 것만 비우려면')} ${c.cyan('/learned 전선 지우기')}`);
    say(`  ${c.gray('쌓인 것을 보려면')} ${c.cyan('/learned')}`);
    say('');
    return;
  }
  if (/^(전선|wire)\s+(지우기|clear|forget|비우기)$/i.test(String(arg).trim())) {
    배움.지우기('전선');
    if (session.conn) 전선붙이기(session.conn, 배움);
    say(`  ${mark.ok} ${c.gray('전선에서 배운 것만 비웠습니다 — 다음 요청부터 짐작으로 다시 시작합니다.')}`);
    say(`  ${c.gray('겪어 본 명령과 토큰 보정은 그대로 둡니다.')}`);
    say('');
    return;
  }

  if (/^(지우기|clear|forget|비우기)$/i.test(String(arg).trim())) {
    배움.지우기('전부');
    session.배움요약 = null;
    say(`  ${mark.ok} ${c.gray('쌓아 둔 것을 비웠습니다. 다시 겪으면서 새로 쌓습니다.')}`);
    say('');
    return;
  }

  const { 명령, 모델, 모델이름 } = 배움.현황(session.conn.model);
  rule('겪어 본 것', 70);

  if (!명령.length && !모델) {
    say(`  ${c.gray('아직 쌓인 것이 없습니다. 명령을 돌리고 대화를 나눌수록 여기가 찹니다.')}`);
    say('');
    return;
  }

  if (명령.length) {
    say(`  ${c.bold('이 폴더에서 돌려 본 명령')}`);
    for (const r of 명령.slice(0, 12)) {
      // 표도 **판정을 그대로 따른다**. 여기서 `no === 0` 으로 따로 셈했더니, 한 번
      // 돼 본 것(아직 못 미더워 안 싣는 것)과 셈이 삭아 0·0 이 된 것에까지 초록 ✓ 가
      // 붙어, 한 줄 안에서 「✓」 와 「아직 안 싣습니다」 가 같이 보였다 (6회차 일거리6cv-c).
      const 표 = r.판정 === '된다' ? c.green('✓') : r.판정 === '안된다' ? c.red('✗') : c.yellow('~');
      /*
       * 언제 겪었는지와 **지금 실리는지**를 같이 적는다.
       *
       * 셈은 삭는다 (agent/confidence.js). 그래서 「됨 3 · 안 됨 0」 두 줄이 화면에
       * 똑같이 보여도 한 줄은 프롬프트에 실리고 다른 줄은 안 실릴 수 있다.
       * 특히 「안 된다」 는 스스로를 봉인하던 자리라, 그것이 지금 입을 다물고
       * 있다는 사실이야말로 사람이 봐야 하는 것이다.
       *
       * 판정은 배움이 낸 것을 그대로 받는다 — 여기서 다시 계산하면 언젠가
       * 한쪽만 고쳐지고, 그때부터 화면이 실제와 다른 말을 한다.
       */
      const 셈 = (n) => (Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '?');
      const 날 = Number.isFinite(r.나이) ? `${Math.floor(r.나이)}일 전` : '언제인지 모름';
      const 말 = r.판정 === '모름' ? `${날} — 아직 안 싣습니다` : `${날} · 프롬프트에 실림`;
      say(`    ${표} ${pad(r.이름, 24)} ${c.gray(`됨 ${셈(r.ok)} · 안 됨 ${셈(r.no)}`)}`
        + `  ${c.gray(말)}`);
    }
    say('');
  }

  if (모델) {
    say(`  ${c.bold('이 모델에 대해')} ${c.gray(모델이름)}`);
    const 걸음 = 모델.걸음 ?? 0;
    const 줄 = (이름, n) => {
      if (!n) return;
      const 비율 = 걸음 ? Math.round((n / 걸음) * 100) : 0;
      say(`    ${c.gray(pad(이름, 24))} ${pad(String(n), 5, 'right')} ${c.gray(걸음 ? `(${비율}%)` : '')}`);
    };
    say(`    ${c.gray(pad('같이 걸어 본 걸음', 24))} ${pad(String(걸음), 5, 'right')}`);
    줄('인자가 잘림', 모델.잘린인자);
    줄('빈 답', 모델.빈답);
    줄('편집이 빗나감', 모델.편집실패);
    if (모델.보정) say(`    ${c.gray(pad('토큰 추정 보정', 24))} ${pad(`×${모델.보정.toFixed(2)}`, 5, 'right')}`);
    say('');
  }

  const 실린것 = 배움.요약(session.conn.model);
  if (실린것) {
    say(`  ${c.bold('이 중 프롬프트에 실리는 것')}`);
    for (const l of 실린것.split('\n').slice(1)) say(`  ${c.gray(l)}`);
  } else {
    say(`  ${c.gray('아직 프롬프트에 실을 만큼 확실한 것은 없습니다 — 두 번 이상 겪어야 싣습니다.')}`);
  }
  /*
   * ── 전선에서 배운 것도 여기 보인다 ──────────────────────────────────────
   *
   * 쌓인 것 중 **제일 크게 작용하는 것**이 전선 모양인데(무엇을 실어 보낼지
   * 가 여기서 갈린다) 이 화면에 아예 안 떴다. 그래서 잘못 배운 판에서 사람이
   * 「배운 것을 보자」 고 여기를 열면, 정작 문제인 줄만 안 보였다.
   */
  const 전선 = session.conn?.전선;
  if (전선) {
    const 배운칸 = 전선.배운칸 ?? [];
    say(`  ${c.bold('이 창구에 실어 보내는 모양')}`);
    say(`    ${c.gray(전선말(전선))}`);
    if (배운칸.length) {
      say(`    ${c.gray('「배움」 은 짐작이 아니라 서버가 거절해서 고친 자리입니다 — 틀릴 수도 있습니다.')}`);
    }
    say('');
  }

  say('');
  say(`  ${c.gray('지우려면')} ${c.cyan('/learned 지우기')}`);
  if (전선?.배운칸?.length) {
    say(`  ${c.gray('전선에서 배운 것만 되돌리려면')} ${c.cyan('/learned 전선 지우기')}`);
  }
  say('');
}

/**
 * 이번 대화에서 무엇이 바뀌었는지 보여 준다.
 *
 *   /diff           바뀐 파일 목록과 늘고 준 줄 수
 *   /diff src/a.js  그 파일이 처음과 지금 사이에 어떻게 달라졌는지
 *
 * 파일 하나를 볼 때는 이번 대화의 '맨 처음' 모습과 견준다. 세 번 고쳤어도
 * 사람이 알고 싶은 것은 '내가 시키기 전과 지금이 뭐가 다른가' 이지
 * 마지막 한 번이 아니다. 되돌리기 이력이 그 맨 처음 모습을 들고 있다.
 */
export function 바뀐것보기(session, ctx, arg = '') {
  const 말 = String(arg ?? '').trim();
  say('');

  if (!말) {
    const 목록 = [...session.changes.entries()];
    if (!목록.length) {
      say(`  ${c.gray('이번 대화에서 바뀐 파일이 없습니다.')}`);
      say(`  ${c.gray('파일을 고치고 나면 여기에 무엇이 얼마나 바뀌었는지 모입니다.')}`);
      say('');
      return;
    }
    rule('이번 대화에서 바뀐 파일', 70);
    let a = 0;
    let r = 0;
    for (const [p, v] of 목록) {
      a += v.added;
      r += v.removed;
      const 몇번 = v.times > 1 ? c.gray(`  ${v.times}번`) : '';
      say(`  ${pad(clip(ctx.scope.show(p), 46), 46)} ${c.hgreen(pad(`+${v.added}`, 6, 'right'))} ${c.hred(pad(`−${v.removed}`, 6, 'right'))}${몇번}`);
    }
    say(`  ${c.gray('─'.repeat(60))}`);
    say(`  ${pad(`${목록.length}개 파일`, 46)} ${c.hgreen(pad(`+${a}`, 6, 'right'))} ${c.hred(pad(`−${r}`, 6, 'right'))}`);
    say('');
    say(`  ${c.gray('한 파일을 자세히 보려면')} ${c.cyan('/diff <파일>')}${c.gray(', 되돌리려면')} ${c.cyan('/undo')}`);
    say('');
    return;
  }

  let abs;
  try { abs = ctx.scope.resolve(말); }
  catch (err) { say(`  ${mark.warn} ${err.message}`); say(''); return; }

  // 이번 대화에서 이 파일을 처음 건드리기 직전의 모습.
  const 처음 = ctx.history.all().find((x) => x.path === abs);
  if (!처음) {
    say(`  ${c.gray('이번 대화에서 안 바꾼 파일입니다:')} ${ctx.scope.show(abs)}`);
    say(`  ${c.gray('바뀐 것들을 보려면')} ${c.cyan('/diff')}`);
    say('');
    return;
  }

  const 옛것 = 처음.before === null ? null
    : (처음.enc === 'b64' ? Buffer.from(처음.before, 'base64').toString('utf8') : 처음.before);
  let 지금 = null;
  if (existsSync(abs)) {
    try { 지금 = readTextFull(abs).text; }
    catch (err) { say(`  ${mark.warn} 지금 내용을 못 읽습니다: ${err.message}`); say(''); return; }
  }

  const d = diffLines(옛것, 지금);
  rule(ctx.scope.show(abs), 70);
  if (!d.changed) {
    say(`  ${c.gray('고쳤다가 되돌아와서, 처음과 지금이 같습니다.')}`);
    say('');
    return;
  }
  if (d.isNew) say(`  ${c.gray('이번 대화에서 새로 만든 파일입니다.')}`);
  if (d.isGone) say(`  ${c.gray('이번 대화에서 없어진 파일입니다.')}`);
  say(`  ${shortStat(d)}`);
  say('');
  for (const l of renderDiff(d, { maxLines: session.level === '개발자' ? 200 : 60 })) say(l);
  say('');
  say(`  ${c.gray('되돌리려면')} ${c.cyan('/undo')}`);
  say('');
}
