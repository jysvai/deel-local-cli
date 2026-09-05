// 슬래시 명령. 이름은 Claude Code / Codex 관례에 맞춘다.
import { writeFileSync, existsSync, statSync } from 'node:fs';
import { 볼것, 리뷰받기 } from './agent/review.js';
import { 마지막할당량, 할당량말, 아슬아슬한가 } from './backend/quota.js';
import { 세션요금, 돈셈, 돈말, 어디서온값, 요금적는법 } from './backend/price.js';
import { join } from 'node:path';
import { c, say, rule, pad, bar, mark, width, clip } from './ui/ansi.js';
import { compact } from './agent/compact.js';
import { 증거모으기, 증거적기 } from './agent/evidence.js';
import { 커밋준비, 커밋실행 } from './agent/commit.js';
import { allowEndpoint } from './safety/network.js';
import { 지금모드, 바깥인가, 나갈수있나 } from './safety/runmode.js';
import { 주소가리기 } from './safety/secrets.js';
import { pick, confirm } from './ui/prompt.js';
import { load, save, 저장시도, resolveKey, upsert, 열쇠보관, configPath } from './config.js';
import { 지금상태 as 지금열쇠상태 } from './safety/authcmd.js';
import { 제공자고르기 } from './providers/index.js';
import { 종, 알릴만한초 } from './ui/notify.js';
/*
 * 화면 말 표.
 *
 * `옮긴말` 이라는 이름을 하나 더 둔다. `/think` 처리 자리에서 지역 변수
 * `말`(사람이 친 인자)이 이 함수를 가리기 때문이다 — 그 블록 안에서는
 * 화면에 말을 걸 수가 없어서, 여태 그 자리만 한국어가 소스에 박혀 있었다.
 */
import { 말, 말 as 옮긴말, 언어, 언어들, 언어정하기, 언어고르기, 옮긴만큼, 지시말, 지시말정하기, 지시말따로정했나 } from './i18n/index.js';
import { 프로필찾기, 쓸수있나, 연결만들기, 알릴말, 목록보기 } from './agent/models.js';
import { allowTemporarily } from './safety/network.js';
import { chat, 규격이름, 더할머리 } from './backend/adapter.js';
import { 알림채움 } from './backend/retry.js';
import { 프록시고르기, 프록시설정 } from './backend/proxy.js';
import { 정한셸 } from './tools/shell.js';
import { TOOLS, 영어설명 } from './tools/index.js';
import { 둘러보기, 프로젝트갈래 } from './lsp/servers.js';
import { 지금것들 } from './lsp/client.js';
import { 보고서적기 } from './ui/export.js';
import { loadCommand, discover } from './skills/discover.js';
import { install, list, remove, pack } from './plugins/manage.js';
import { spin } from './ui/spinner.js';
import { 그림고르기설정, 끔설정 } from './ui/motion.js';
import { 사무실설정, 최소높이, 최소폭 } from './ui/office.js';

/**
 * 설정에 적힌 그림을 화면 쪽에 물린다.
 *
 * 켤 때(repl·oneshot)와 `/motion` 으로 바꿀 때가 **같은 길을 타야** 한다.
 * 갈라 두면 명령으로 바꾼 것이 다음에 켤 때 안 살아나거나 그 반대가 된다.
 *
 * 사무실은 그림 하나가 아니라 화면 아래를 통째로 쓰는 것이라 따로 켠다.
 * '사무실' 을 골랐으면 상자 안 그림은 조용한 돌림표로 돌아간다 — 둘 다
 * 같은 것을 말하므로 나란히 두면 같은 소리를 두 번 하는 셈이다.
 */
export function 적용하기(고른것) {
  const 값 = String(고른것 ?? '기본');
  사무실설정(값 === '사무실');
  그림고르기설정(값 === '사무실' ? '기본' : 값);
  // 환경변수(DEEL_NO_MOTION)는 안 건드린다 — 사람이 직접 넣어 둔 것을 명령이
  // 지워 버리면, 껐다고 믿는 자리에서 그림이 다시 돈다. 설정용 값은 따로 둔다.
  끔설정(값 === '끔');
}
import { PROFILES, LEVELS as THINK_LEVELS, normalizeProfile, table as effortTable, 가벼운강도, shiftLevel } from './agent/effort.js';
import { 전선붙이기, 전선말, 눈금맞추기 } from './backend/wire.js';
import { scanLocal, toProfiles } from './backend/scan.js';
import { list as listSessions } from './agent/store.js';
import { MODES as WORK_MODES, ORDER as WORK_ORDER, DEFAULT as WORK_DEFAULT, normalize as normWork, get as getWork, canWrite, 보일이름, 보일한줄 } from './agent/modes.js';
import { LEVELS, ORDER as LEVEL_ORDER, DEFAULT as LEVEL_DEFAULT, normalize as normLevel, shows as levelShows } from './ui/level.js';
import { diffLines, renderDiff, shortStat } from './ui/diff.js';
import { readTextFull } from './tools/fsutil.js';
import { 띄우기, 브라우저로 } from './preview/serve.js';
import { 클립보드그림, 그림앉히기 } from './tools/clipboard.js';
import { 크기말 } from './backend/vision.js';
import { 명령들 } from './cmdnames.js';
const MODES = {
  auto: '자율 — 전부 알아서. 되돌리기가 안전망',
  confirm: '확인 — 되돌릴 수 없는 것만 물어봄',
  strict: '엄격 — 파일 변경·명령 전부 물어봄',
};


/**
 * 화면에 낼 명령표. desc·arg 는 볼 때마다 지금 언어로 읽는다.
 *
 * @type {Record<string, {desc: string, arg?: string}>}
 */
export const COMMANDS = Object.fromEntries(Object.entries(명령들).map(([이름, 꼴]) => {
  const 것 = { get desc() { return 말(`cmd.${이름}.desc`); } };
  if (꼴.arg) Object.defineProperty(것, 'arg', { get: () => 말(`cmd.${이름}.arg`), enumerable: true });
  return [이름, 것];
}));


/**
 * 이 줄이 명령이 아니라 '경로' 인가.
 *
 * 슬래시로 시작한다고 다 명령은 아니다. `/usr/local/bin` 이나 `/mnt/d/일감`
 * 같은 것을 치면 그동안은 통째로 명령으로 먹혀서 "모르는 명령" 만 나오고
 * 모델에게 닿지도 않았다. 경로를 아예 못 적는 셈이었다.
 *
 * 가르는 기준은 간단하다 — 명령 이름에는 슬래시가 없다.
 * 플러그인 명령도 `/플러그인:이름` 이라 콜론을 쓰지 슬래시를 안 쓴다.
 * 그러니 첫 낱말 안에 슬래시가 또 있으면 그건 경로다.
 */
function 경로처럼보이나(line) {
  const 첫낱말 = line.slice(1).split(/\s+/)[0] ?? '';
  if (첫낱말.includes('/') || 첫낱말.includes('\\')) return true;
  // `/tmp` 처럼 슬래시가 하나뿐이어도, 실제로 있는 자리면 경로로 본다.
  if (첫낱말 && !COMMANDS[첫낱말.toLowerCase()]) {
    try { if (existsSync(line.slice(1).trim())) return true; } catch { /* 못 보면 아닌 걸로 */ }
  }
  return false;
}

// 반환: { handled, exit? }  handled=false 면 모델에게 보낸다.

/**
 * 설정을 남기고, 못 남겼으면 화면에 한 줄 (config.js 의 저장시도).
 *
 * 여태 아홉 자리가 전부 `try { save(cfg) } catch {}` 였다. 못 남겨도 이번 판에는
 * 먹으니 대화는 계속되는데, 바로 다음 줄에서 화면은 `✓ 바꿨습니다` 를 찍는다.
 * 사람은 정해진 줄 알고 창을 닫았다가 다음에 옛 값을 보고, 그때는 무엇 때문인지
 * 알 길이 없다 — 홈이 읽기 전용인지, 디스크가 찼는지.
 *
 * @returns {boolean} 남겼나
 */
function 설정남기기(cfg, 옵션 = {}) {
  const r = 저장시도(cfg, 옵션);
  if (!r.ok) say(`  ${mark.warn} ${c.yellow(말('common.cfgSaveFailed', { 왜: clip(r.왜, 70) }))}`);
  return r.ok;
}

/** /mode 아래에 규칙을 늘어놓는다. 아무것도 안 걸려 있으면 아무 말도 안 한다. */
function 규칙보이기(규칙들) {
  if (!규칙들) return;
  const 있나 = (규칙들.allow?.length ?? 0) + (규칙들.deny?.length ?? 0);
  if (!있나 && !규칙들.정책곳 && !규칙들.탈) return;
  say('');
  say(`  ${c.gray('적어 둔 규칙 — 이건 모드보다 셉니다')}`);
  for (const r of 규칙들.deny ?? []) say(`    ${c.red('✗')} ${c.white(r.원문)}  ${c.gray(r.출처)}`);
  for (const r of 규칙들.allow ?? []) say(`    ${c.green('✓')} ${c.white(r.원문)}  ${c.gray(r.출처)}`);
  if (규칙들.정책곳) say(`    ${c.gray(`관리 정책 ${규칙들.정책곳} — 이 파일은 고칠 수 없습니다`)}`);
  if (규칙들.baseUrl) say(`    ${c.gray(`주소가 정책으로 못박혀 있습니다: ${규칙들.baseUrl}`)}`);
  if (규칙들.offline) say(`    ${c.gray('정책으로 오프라인이 켜져 있습니다 — 끌 수 없습니다')}`);
  if (규칙들.탈) say(`    ${mark.warn} ${c.yellow(규칙들.탈)}`);
}

export async function handle(line, session, ctx) {
  if (!line.startsWith('/')) return { handled: false };
  if (경로처럼보이나(line)) return { handled: false };
  const [raw, ...rest] = line.slice(1).trim().split(/\s+/);
  const name = raw.toLowerCase();
  const arg = rest.join(' ');

  switch (name) {
    case 'help': return help(session), { handled: true };
    case 'level': return showLevel(session, arg), { handled: true };

    /*
     * 종소리 · 창 제목.
     *
     * 끄는 길을 굳이 명령으로 둔 이유가 있다. 사무실에서 소리가 나면 곤란한
     * 사람이 있고, 그런 사람은 알림 자체를 못 쓰게 되는 것이 아니라 **그 자리에서
     * 껐다 켤 수 있어야** 한다. 환경변수만 두면 프로그램을 껐다 켜야 한다.
     */
    /*
     * 화면 말 — 한국어 / English.
     *
     * 코드는 한국어로 둔다. 함수 이름도 변수 이름도 한글이고 그게 이 저장소의
     * 뜻이다. 바꾸는 것은 **화면에 나가는 말**뿐이다.
     *
     * 얼마나 옮겼는지를 숨기지 않고 그대로 적는다. 다 된 척하는 것보다
     * "298개 중 47개는 아직 한국어" 가 낫다 — 그래야 안 옮긴 자리를 봤을 때
     * 사람이 고장으로 안 읽고, 도와줄 사람도 어디를 도울지 안다.
     */
    /*
     * 다른 모델에게 한 번 물어보기.
     *
     * ── 왜 따로 두나 ────────────────────────────────────────────────────
     *
     * 로컬에서는 모델 하나를 골라도 늘 어딘가 아쉽다. 7B 는 계획을 잘 세우는데
     * 파일 열 개를 고치다 창이 차고, 1.5B 는 창은 넉넉한데 무엇을 할지를 못
     * 정한다. 그런데 지금까지는 다른 것에게 물어보려면 /model 로 **갈아타야**
     * 했고, 갈아타면 하던 대화가 그 모델의 것이 된다 — 한마디 물어보자고
     * 판을 통째로 옮기는 셈이었다.
     *
     * ── 무엇을 보내나 ───────────────────────────────────────────────────
     *
     * **친 질문만** 보낸다. 지금 대화를 통째로 딸려 보내지 않는다.
     *
     * 이건 편의가 아니라 경계선 문제다. 대화에는 이 폴더의 소스가 통째로
     * 들어 있는데, 그것이 어느 서버로 가는지는 사람이 정할 일이지 명령 하나가
     * 조용히 정할 일이 아니다. 필요한 배경은 질문에 적으면 된다.
     *
     * 답은 화면에 보여 주고 **대화에도 넣는다.** 안 넣으면 사람이 그 답을
     * 손으로 옮겨 적어야 하는데, 그러면 이건 다른 창에서 물어보는 것과 다를
     * 것이 없다. 다만 누가 한 말인지 표를 달아 넣는다 — 지금 쓰는 모델이
     * 제가 한 말로 착각하면 안 된다.
     */
    case 'consult': {
      const 조각 = String(arg ?? '').trim().split(/\s+/);
      const 이름 = 조각.shift() ?? '';
      const 질문 = 조각.join(' ').trim();
      const 목록 = 목록보기();

      if (!이름) {
        say('');
        rule(말('consult.title'), 70);
        if (!목록.length) {
          say(`  ${c.gray(말('consult.noProfiles'))}`);
        } else {
          for (const p of 목록) {
            const 표 = p.로컬 ? c.hgreen('⌂') : c.hyellow('↗');
            say(`  ${표} ${c.cyan(pad(p.id, 16))} ${c.white(pad(p.model, 26))} ${c.gray(p.어디)}${p.지금 ? c.gray(` ${말('consult.current')}`) : ''}`);
          }
        }
        say('');
        say(`  ${c.gray(말('consult.usage'))}`);
        say(`  ${c.gray(말('consult.questionOnly'))}`);
        say('');
        return { handled: true };
      }

      const 찾음 = 프로필찾기(이름);
      if (!찾음.ok) {
        say(`  ${c.gray(찾음.why)}`);
        if (찾음.후보.length) say(`  ${c.gray(말('consult.candidates'))} ${찾음.후보.map((p) => c.cyan(p.id)).join(c.gray(' · '))}`);
        else if (목록.length) say(`  ${c.gray(말('consult.have'))} ${목록.map((p) => c.cyan(p.id)).join(c.gray(' · '))}`);
        say('');
        return { handled: true };
      }
      const 되나 = 쓸수있나(찾음.prof);
      if (!되나.ok) { say(`  ${c.yellow('!')} ${c.gray(되나.why)}`); say(''); return { handled: true }; }
      if (!질문) {
        say(`  ${c.gray(말('consult.needQuestion', { 이름: 찾음.prof.id }))}`);
        say('');
        return { handled: true };
      }

      const 새conn = 연결만들기(찾음.prof);
      // 물어보러 가는 자리에도 전선 카드를 달아 준다 (backend/wire.js) —
      // 없으면 이 한 번만 생각 칸이 짐작으로 나가고, Opus 5 계열에서는 400 이다.
      전선붙이기(새conn, ctx?.배움);
      const 알림 = 알릴말(session.conn, 새conn);
      say('');
      say(알림.밖으로
        ? `  ${c.hyellow('↗')} ${c.hyellow(알림.말)} ${c.gray(말('consult.goesOut'))}`
        : `  ${c.hgreen('⌂')} ${c.gray(알림.말)}`);

      // 그 한 번 동안만 연다. 끝나면 반드시 닫는다.
      const 닫기 = 알림.다른자리 ? allowTemporarily(새conn.base) : null;
      let 돌림 = spin(말('consult.asking', { 모델: 새conn.model }));
      let 답 = null;
      let 탈 = null;
      const 잰때 = Date.now();
      try {
        const m = await chat(새conn, {
          messages: [
            { role: 'system', content: 말('consult.system') },
            { role: 'user', content: 질문 },
          ],
          temperature: 0.3,
          // 서버가 잠깐 막으면 돌림표 뒤에 숨기지 않고 말한다 — 왜 오래 걸리는지 보여야 한다.
          onBackoff: (알림) => {
            돌림.stop(`  ${c.yellow('↻')} ${c.gray(말('loop.backoff', 알림채움(알림)))}`);
            돌림 = spin(말('consult.asking', { 모델: 새conn.model }));
          },
        });
        답 = String(m?.content ?? '').trim();
      } catch (err) {
        탈 = String(err?.message ?? err);
      } finally {
        돌림.stop();
        try { 닫기?.(); } catch { /* 닫다 터져도 이번 대화는 이어간다 */ }
      }

      if (탈) {
        say(`  ${c.yellow('!')} ${c.gray(말('consult.failed', { 왜: clip(탈, 120) }))}`);
        say('');
        return { handled: true };
      }
      if (!답) {
        say(`  ${c.gray(말('consult.empty'))}`);
        say('');
        return { handled: true };
      }

      const 초 = ((Date.now() - 잰때) / 1000).toFixed(1);
      say(`  ${c.gray('─'.repeat(2))} ${c.gray(`${찾음.prof.id} · ${초}초`)}`);
      say('');
      for (const l of 답.split('\n')) say(`  ${l}`);
      say('');

      /*
       * 대화에 넣을 때 **누가 한 말인지 표를 단다.**
       *
       * 안 달면 지금 쓰는 모델이 제가 아까 한 말로 읽는다. 작은 모델이 대충
       * 답한 것을 제 판단으로 삼아 그 위에 쌓으면, 틀린 자리가 어디서 왔는지
       * 아무도 못 찾는다.
       */
      session.push({
        role: 'user',
        content: `[${찾음.prof.id} (${새conn.model}) 에게 따로 물어본 결과다. 네가 한 말이 아니다.]\n`
          + `물음: ${질문}\n답: ${답}`,
      });
      ctx.audit.tool('Consult', { 프로필: 찾음.prof.id, 모델: 새conn.model, 질문: clip(질문, 200) },
        { summary: `${알림.말} · ${답.length}자` });
      say(`  ${c.gray(말('consult.added'))}`);
      say('');
      return { handled: true };
    }

    case 'lang': {
      /*
       * 두 축이다 — 화면 말, 그리고 **모델에게 시키는 말**.
       *
       *   /lang en       둘 다 영어
       *   /lang ko en    화면은 한국어, 시키는 말만 영어  ← "영어로 시키고 한국어로 받기"
       *   /lang ko auto  다시 하나로 (시키는 말이 화면 말을 따라간다)
       *
       * 굳이 나눈 이유는 값이다. 한글은 글자당 약 1토큰이고 영문은 약 3.6자당
       * 1토큰이라(session.js 의 estimateTokens), 시키는 말만 영어로 돌려도
       * 고정 몫이 눈에 띄게 준다. 작은 창일수록 그 차이가 크다.
       * 답은 그대로 한국어로 온다 — 기본규칙() 이 그 한 줄을 따로 못 박는다.
       */
      const 쪼갠것 = String(arg ?? '').trim().split(/\s+/).filter(Boolean);
      const 값 = 쪼갠것[0] ?? '';
      const 시킬말 = 쪼갠것[1] ?? null;
      const 이름 = (l) => 말(`lang.${l}`);
      if (!값) {
        const p = 옮긴만큼();
        say('');
        say(`  ${c.gray(말('lang.now', { 이름: 이름(언어()) }))}`);
        say(`  ${c.gray(말('lang.promptNow', {
          이름: 지시말따로정했나() ? 이름(지시말()) : 말('lang.follows'),
        }))}`);
        say(`  ${c.gray(말('lang.progress', { 언어: 언어(), 옮김: p.옮김, 전체: p.전체 }))}`);
        if (p.남음) say(`  ${c.gray(말('lang.partial'))}`);
        say(`  ${c.gray(말('lang.codeStays'))}`);
        // 고를 수 있는 말은 언어들 에서 그대로 만든다 — 손으로 적으면 새 말을
        // 넣고 여기를 안 고쳐서, 있는 말이 없는 것처럼 보인다.
        say(`  ${c.gray(말('lang.howto'))} ${언어들.map((l) => c.cyan(`/lang ${l}`)).join(c.gray(' · '))}`);
        /*
         * 예시는 **지금 쓰는 말**로 만든다.
         *
         * 못 박아 두면 일본어 화면에서 "/lang ko en" 을 치라고 하게 되는데,
         * 그대로 치면 화면이 한국어로 바뀐다. 알려 준 대로 했더니 엉뚱한
         * 데로 가는 안내는 없느니만 못하다.
         */
        // 화면이 이미 영어면 「영어로 시키고 …로 받기」가 뜻이 없다.
        // 그때 이 줄을 그대로 내면 "/lang en en" 이라는 헛말이 나온다.
        if (언어() !== 'en') say(`  ${c.gray(말('lang.splitHowto'))} ${c.cyan(`/lang ${언어()} en`)}`);
        say(`  ${c.gray(말('lang.envHint'))}`);
        say('');
        return { handled: true };
      }
      if (!언어고르기(값)) {
        say(`  ${c.gray(말('lang.unknown'))}`);
        say('');
        return { handled: true };
      }
      // 시킬 말을 같이 줬으면 그것부터 본다 — 화면 말만 바꿔 놓고 거절하면
      // 사람이 시킨 것의 절반만 먹은 채로 끝난다.
      if (시킬말 !== null && !지시말정하기(시킬말)) {
        say(`  ${c.gray(말('lang.unknown'))}`);
        say('');
        return { handled: true };
      }
      언어정하기(값);
      const cfg = load();
      cfg.lang = 언어();
      // 따로 안 정했으면 설정에서도 지운다. 남겨 두면 다음에 켤 때
      // 「화면 말을 따라간다」 가 아니라 옛 값이 되살아난다.
      if (지시말따로정했나()) cfg.promptLang = 지시말();
      else delete cfg.promptLang;
      설정남기기(cfg);
      const p = 옮긴만큼();
      say('');
      say(`  ${mark.ok} ${말('lang.changed', { 이름: 이름(언어()) })}`);
      if (지시말() !== 언어()) {
        say(`     ${c.gray(말('lang.promptChanged', { 이름: 이름(지시말()), 답: 이름(언어()) }))}`);
      }
      say(`     ${c.gray(말('lang.progress', { 언어: 언어(), 옮김: p.옮김, 전체: p.전체 }))}`);
      if (p.남음) say(`     ${c.gray(말('lang.partial'))}`);
      say('');
      return { handled: true };
    }

    /*
     * 언어 서버 — 무엇이 깔려 있고, 지금 무엇이 떠 있나.
     *
     * 이 화면이 필요한 이유는 하나다. Def·Refs 는 서버가 없으면 **목록에 아예
     * 안 나온다.** 그러면 사용자 눈에는 "왜 어떤 프로젝트에서는 되고 어떤
     * 데서는 안 되지" 로 보인다. 여기서 그 까닭과 깔 방법을 대신 말해 준다.
     *
     * 대신 **여기서도 안 깔아 준다.** 깔 명령을 글자로 보여 줄 뿐이고,
     * 칠지 말지는 사람이 정한다 (lsp/servers.js 머리말).
     */
    /*
     * 대화 → 보고서 한 장 (ui/export.js).
     *
     * 폐쇄망에는 세션 공유 링크가 없다. 이 자리의 공유는 파일이다 —
     * 결재는 첨부로 돌고, 보고는 한 장으로 한다.
     */
    case 'export': {
      const 자리 = 보고서적기(ctx.scope.root, session, { scope: ctx.scope, audit: ctx.audit });
      say('');
      if (자리) {
        say(`  ${mark.ok} ${말('export.saved')} ${c.white(ctx.scope.show(자리))}`);
        say(`     ${c.gray(말('export.openHint'))}`);
      } else {
        say(`  ${c.red('✗')} ${말('export.failed')}`);
      }
      say('');
      return { handled: true };
    }

    case 'lsp': {
      const 값 = String(arg ?? '').trim().toLowerCase();
      if (값 === 'off' || 값 === '끔' || 값 === '꺼') {
        if (ctx?.lsp) ctx.lsp.켬 = false;
        say('');
        say(`  ${mark.ok} ${말('lsp.diagOff')}`);
        say('');
        return { handled: true };
      }
      if (값 === 'on' || 값 === '켬' || 값 === '켜') {
        if (ctx?.lsp) ctx.lsp.켬 = true;
        say('');
        say(`  ${mark.ok} ${말('lsp.diagOn')}`);
        say('');
        return { handled: true };
      }

      const { 있는것, 없는것 } = 둘러보기();
      const 뿌리것 = ctx?.scope?.root ? 프로젝트갈래(ctx.scope.root) : null;
      const 떠있는것 = 지금것들();
      say('');
      if (있는것.length) {
        say(`  ${c.hcyan('◈')} ${c.white(말('lsp.found', { 수: 있는것.length }))}`);
        for (const it of 있는것) say(`     ${c.hgreen('✓')} ${c.white(it.갈래.padEnd(5))} ${c.gray(it.이름)}`);
      } else {
        say(`  ${c.gray(말('lsp.none'))}`);
      }
      say('');
      say(`  ${c.gray(말('lsp.thisFolder'))} ${뿌리것 ? c.hcyan(뿌리것.갈래) + c.gray(` · ${말('lsp.fileCount', { 수: 뿌리것.개수 })}`) : c.gray(말('lsp.noneHere'))}`);
      say(`  ${c.gray(말('lsp.tools'))} ${session.lsp ? c.hgreen('Def · Refs') : c.gray(말('lsp.toolsHidden'))}`);
      say(`  ${c.gray(말('lsp.diag'))} ${ctx?.lsp?.켬 === false ? c.gray(말('lsp.stateOff')) : c.hgreen(말('lsp.stateOn'))}`);
      if (떠있는것.length) {
        for (const it of 떠있는것) {
          const 꼴 = it.죽음 ? c.yellow(it.죽음) : (it.준비 ? c.hgreen(말('lsp.ready')) : c.gray(말('lsp.starting')));
          say(`     ${c.gray('·')} ${c.white(it.이름 ?? it.갈래)} ${꼴}`);
        }
      }
      if (없는것.length && !있는것.length) {
        say('');
        say(`  ${c.gray(말('lsp.installHint'))}`);
        for (const it of 없는것.slice(0, 4)) say(`     ${c.gray(`${it.갈래.padEnd(5)} ${it.깔기}`)}`);
        say(`  ${c.gray(말('lsp.neverInstalls'))}`);
      }
      say(`  ${c.gray(말('lsp.howto'))} ${c.cyan('/lsp on')} ${c.gray('·')} ${c.cyan('/lsp off')}`);
      say('');
      return { handled: true };
    }

    /*
     * 이 터미널이 무슨 바이트를 보내나 (repl.js 의 키확인).
     *
     * 줄바꿈이 안 된다는 말은 여러 판째 나왔는데, 그때마다 문서에 "터미널
     * 설정을 바꾸세요" 라고만 적었다. 그건 고친 것이 아니다 — 사람은 제
     * 터미널에서 무엇이 오는지 볼 길이 없었다. 여기서는 짐작 대신 눌러 본다.
     */
    case 'keys': {
      if (typeof ctx?.키확인 !== 'function') {
        say('');
        say(`  ${c.gray('키 확인은 상자 화면에서만 됩니다 (--no-tui 나 파이프에서는 못 씁니다).')}`);
        say('');
        return { handled: true };
      }
      await ctx.키확인();
      return { handled: true };
    }

    case 'bell': {
      const cfg = load();
      const 켜는말 = ['on', '켬', '켜', '켜기', 'y', 'yes', 'ㅇ'];
      const 끄는말 = ['off', '끔', '꺼', '끄기', 'n', 'no', 'ㄴ'];
      const 값 = String(arg ?? '').trim().toLowerCase();
      if (!값) {
        const 켜져있나 = cfg.bell !== false;
        const 상태 = 켜져있나 ? c.hgreen(말('bell.stateOn')) : c.gray(말('bell.stateOff'));
        say('');
        say(`  ${c.gray(말('bell.now', { 상태 }))}`);
        say(`  ${c.gray(말('bell.when', { 초: 알릴만한초 }))}`);
        say(`  ${c.gray(말('bell.title'))}`);
        say(`  ${c.gray(말('bell.howto'))} ${c.cyan('/bell on')} ${c.gray('·')} ${c.cyan('/bell off')}`);
        if (!process.stdout.isTTY && !process.stderr.isTTY) say(`  ${c.gray(말('bell.notATty'))}`);
        say('');
        return { handled: true };
      }
      if (!켜는말.includes(값) && !끄는말.includes(값)) {
        say(`  ${c.gray(말('bell.needOnOff'))}`);
        say('');
        return { handled: true };
      }
      cfg.bell = 켜는말.includes(값);
      설정남기기(cfg);
      say('');
      say(`  ${mark.ok} ${말(cfg.bell ? 'bell.turnedOn' : 'bell.turnedOff')}`);
      // 켤 때는 한 번 울려 준다. "켰다는데 소리가 나나?" 를 그 자리에서 확인하게.
      if (cfg.bell) { 종(); say(`     ${c.gray(말('bell.justRang'))}`); }
      say(`     ${c.gray(말('bell.appliesNow'))}`);
      say('');
      return { handled: true };
    }
    /*
     * 일하는 동안 뭐가 도나.
     *
     * 예전에는 DEEL_MOTION 과 DEEL_OFFICE 두 환경변수였다. 켜 보려면 터미널을
     * 껐다 켜야 했고, 이름도 둘을 따로 외워야 했다 — 재미로 넣은 것을 켜는 데
     * 그만한 품이 들면 아무도 안 켠다. 명령 하나로 합치고 그 자리에서 바뀐다.
     */
    case 'motion': {
      const cfg = load();
      const 고를것 = [
        { 값: '기본',   별명: ['기본', 'default', 'plain', '돌림표'], 설명: 말('motion.plain') },
        { 값: '기사',   별명: ['기사', 'knight'],                     설명: 말('motion.knight') },
        { 값: '동물',   별명: ['동물', 'animal', 'animals'],          설명: 말('motion.animal') },
        { 값: '사무실', 별명: ['사무실', 'office'],                   설명: 말('motion.office') },
        { 값: '끔',     별명: ['끔', 'off', '꺼', '끄기', 'none'],    설명: 말('motion.off') },
      ];
      const 지금값 = cfg.motion ?? '기본';
      const 값 = String(arg ?? '').trim().toLowerCase();

      if (!값) {
        say('');
        say(`  ${c.gray(말('motion.now'))} ${c.hcyan(지금값)}`);
        say('');
        for (const 것 of 고를것) {
          const 표 = 것.값 === 지금값 ? c.hgreen('●') : c.gray('○');
          // padEnd 가 아니라 pad — 한글은 한 글자가 두 칸이라
          // 글자 수로 채우면 '사무실' 줄만 두 칸 밀린다.
          say(`  ${표} ${c.cyan(pad(`/motion ${것.값}`, 18))} ${c.gray(것.설명)}`);
        }
        say('');
        // 사무실은 화면이 좁거나 낮으면 안 뜬다. 켜 놓고 안 보이면 고장으로
        // 보이므로, 지금 이 터미널이 되는지를 여기서 미리 말해 준다.
        const 줄 = process.stdout.rows ?? 0;
        const 칸 = process.stdout.columns ?? 0;
        if (줄 && 칸 && (줄 < 최소높이 || 칸 < 최소폭)) {
          say(`  ${c.yellow(mark.warn)} ${c.gray(말('motion.tooSmall', { 줄, 칸, 최소줄: 최소높이, 최소칸: 최소폭 }))}`);
          say('');
        }
        if (process.env.DEEL_MOTION || process.env.DEEL_OFFICE) {
          say(`  ${c.gray(말('motion.envWins'))}`);
          say('');
        }
        return { handled: true };
      }

      const 고른것 = 고를것.find((것) => 것.별명.includes(값));
      if (!고른것) {
        say('');
        say(`  ${c.gray(말('motion.unknown', { 값: arg }))}`);
        say(`  ${c.gray(말('motion.pickOne'))} ${고를것.map((것) => c.cyan(것.값)).join(c.gray(' · '))}`);
        say('');
        return { handled: true };
      }

      cfg.motion = 고른것.값;
      설정남기기(cfg);
      적용하기(cfg.motion);

      say('');
      say(`  ${mark.ok} ${말('motion.set', { 것: 고른것.값 })} ${c.gray('— ' + 고른것.설명)}`);
      // 사무실을 골랐는데 이 터미널이 작으면 아무 일도 안 일어난 것처럼 보인다.
      // 켰다고 말해 놓고 안 보이면 그게 고장이다. 그래서 그 자리에서 말한다.
      if (고른것.값 === '사무실') {
        const 줄 = process.stdout.rows ?? 0;
        const 칸 = process.stdout.columns ?? 0;
        if (줄 && 칸 && (줄 < 최소높이 || 칸 < 최소폭)) {
          say(`     ${c.yellow(mark.warn)} ${c.gray(말('motion.tooSmall', { 줄, 칸, 최소줄: 최소높이, 최소칸: 최소폭 }))}`);
        }
        /*
         * 맥 기본 터미널에서 방이 갈라져 보이는 것은 우리가 못 고친다.
         *
         * 방은 한 칸에 픽셀 둘을 넣는다 — 위는 글자색, 아래는 배경색, 글자는
         * 반칸(▀). 그런데 기본 터미널은 줄 간격이 1.0 보다 넓게 잡혀 있어서
         * 칸과 칸 사이에 빈 띠가 남는다. 색이 꽉 차야 할 자리에 가로줄이
         * 그어지는 것이 그 모습이다. 우리가 무엇을 보내든 그 틈은 안 메워진다.
         *
         * 그래서 고치는 자리를 알려 준다. iTerm2 에서 멀쩡한 것도 같은 이유다 —
         * 거기는 줄 간격이 기본 1.0 이다.
         */
        if (process.env.TERM_PROGRAM === 'Apple_Terminal') {
          say(`     ${c.yellow(mark.warn)} ${c.gray(말('motion.appleTerminal'))}`);
        }
      }
      if (process.env.DEEL_MOTION || process.env.DEEL_OFFICE) {
        say(`     ${c.yellow(mark.warn)} ${c.gray(말('motion.envWins'))}`);
      }
      say(`     ${c.gray(말('motion.appliesNow'))}`);
      say('');
      return { handled: true };
    }

    case 'exit':
    case 'quit': return { handled: true, exit: true };

    case 'clear':
      session.clear();
      say(`  ${mark.ok} 대화를 비웠습니다. 규칙과 연결은 그대로입니다.`);
      say('');
      return { handled: true };

    case 'context': return showContext(session), { handled: true };

    case 'ctx': return await ctxLength(session, arg), { handled: true };

    // 모델 급. /ctx 와 헷갈리기 쉬워 설명에서 못을 박는다 —
    // /ctx 는 '얼마나 담나', /grade 는 '얼마나 알아서 하나' 다.
    case 'grade': case '급': return 모델급(session, arg), { handled: true };

    // 한 번에 받을 답 길이. 컨텍스트(/ctx)와는 다른 축이라 명령을 따로 둔다 —
    // /ctx out 안에 숨겨 두니 아무도 못 찾았고, 정작 큰 파일이 안 만들어지는 원인이었다.
    case 'out': case '출력': return await 출력상한(session, arg), { handled: true };

    case 'compact': {
      let s = spin('앞선 대화를 요약해 접는 중…');
      const r = await compact(session, {
        onBackoff: (알림) => {
          s.stop(`  ${c.yellow('↻')} ${c.gray(말('loop.backoff', 알림채움(알림)))}`);
          s = spin('앞선 대화를 요약해 접는 중…');
        },
      });
      if (!r.ok) {
        s.stop(`  ${c.gray(r.why ?? '접지 못했습니다.')}`);
        say('');
        return { handled: true };
      }
      const 줄인 = r.before - r.after;
      s.stop(`  ${mark.ok} 대화 ${r.folded}개를 요약으로 접었습니다.`);
      say(`     ${c.gray(r.before.toLocaleString())} ${c.gray('→')} ${c.white(r.after.toLocaleString())} ${c.gray('토큰')}  ${c.green(`${Math.round((줄인 / Math.max(1, r.before)) * 100)}% 줄어듦`)}`);
      if (r.fallback) say(`     ${c.yellow('요약을 못 받아 그냥 줄였습니다.')}`);
      else if (r.summary) {
        say('');
        for (const line of r.summary.split('\n').slice(0, 14)) say(`     ${c.gray(clip(line, 76))}`);
      }
      say('');
      return { handled: true };
    }

    case 'model':
      // `/model 카드` 는 모델을 바꾸는 게 아니라 이 모델을 겪어 본 결과를 본다.
      if (/^(카드|card)$/i.test(String(arg ?? '').trim())) return 카드명령(session, ctx), { handled: true };
      return await switchModel(session, ctx, arg), { handled: true };

    /*
     * /think — '얼마나 생각하나' 하나만 정한다.
     *
     * 전에는 한 명령이 두 축을 맡았다. `/think high` 는 강도(5단계)를 정하고
     * `/think save` 는 배분(3가지)을 정했다 — 같은 이름으로 다른 것을 정하니
     * 화면을 봐도 지금 무엇이 무엇인지 읽히지 않았다. 게다가 부를 때마다
     * 단계표가 통째로 펼쳐졌고, 그 표의 '출력상한' 칸 세 줄은 늘 같은 값이었다.
     *
     * 그래서 갈랐다.
     *   /think high      강도
     *   /think 배분 절약  단계별 배분
     *   /think 자세히     단계표
     *   /out             출력 상한 (아예 다른 축이라 명령을 따로 뺐다)
     *
     * 옛 이름(/think save)도 그대로 받는다. 쓰던 사람의 손버릇을 깨지 않는다.
     */
    case 'think': {
      const 말 = String(arg ?? '').trim();
      // 낱말 끝을 \b 로 잡으면 안 된다. \b 는 \w(=[A-Za-z0-9_])를 기준으로 하는데
      // 한글은 \w 가 아니다 — '배분 절약' 의 '분' 과 공백은 **둘 다 비낱말**이라
      // 그 사이에 경계가 없다. 그래서 `/^배분\b/` 는 영영 안 맞았고,
      // /think 배분 … 은 통째로 죽은 명령이었다(영어 prof 만 먹혔다).
      // 공백이나 줄 끝으로 직접 끊는다.
      const 배분말 = /^(배분|profile|prof)(\s|$)/.test(말) ? 말.replace(/^(배분|profile|prof)\s*/, '') : null;

      if (배분말 !== null) {
        const p = normalizeProfile(배분말);
        if (!p) {
          say(`  ${c.gray('배분')}  ${Object.entries(PROFILES).map(([k, v]) => `${k}(${v.name})`).join(' · ')}`);
          say(`  ${c.gray('예')} ${c.cyan('/think 배분 절약')}`);
          say('');
          return { handled: true };
        }
        session.effort = p;
        session.effortSet = true;   // 사용자가 직접 정했다 — 작업 모드보다 우선한다
        say(`  ${mark.ok} 배분 ${c.bold(PROFILES[p].name)} ${c.gray('— ' + PROFILES[p].desc)}`);
        showThink(session);
        return { handled: true };
      }

      if (/^(자세히|detail|-v)$/.test(말)) { showThink(session, { 자세히: true }); return { handled: true }; }

      /*
       * ── /think auto — 시킨 말에 맞춰 강도를 고를까 ──────────────────
       *
       * 켜면 사람이 정한 값은 **천장**이 된다. 「안녕」 한 마디에 max 로
       * 생각하지 않고, 진짜 일에는 천장까지 쓴다. 대화가 쌓인 뒤에는
       * 안 움직인다 — 그때는 강도를 바꾸는 값(캐시가 깨진다)이 아끼는
       * 값보다 크기 때문이다 (agent/effort.js).
       */
      if (/^(auto|자동)(\s|$)/.test(말)) {
        const 값 = 말.replace(/^(auto|자동)\s*/, '').trim().toLowerCase();
        const 켤까 = 값 === '' ? session.autoThink === false : /^(on|켜|켜기|true)$/.test(값);
        session.autoThink = 켤까;
        say(`  ${mark.ok} ${옮긴말(켤까 ? 'think.autoOn' : 'think.autoOff')}`);
        showThink(session);
        return { handled: true };
      }

      // 옛 이름 — /think save 처럼 배분 이름을 바로 친 경우.
      const asProfile = normalizeProfile(말);
      if (asProfile) {
        session.effort = asProfile;
        session.effortSet = true;
        say(`  ${mark.ok} 배분 ${c.bold(PROFILES[asProfile].name)} ${c.gray('— ' + PROFILES[asProfile].desc)}`);
        say(`     ${c.gray('이제')} ${c.cyan('/think 배분 ' + PROFILES[asProfile].name)} ${c.gray('로도 됩니다 — 강도와 헷갈리지 않게 갈랐습니다.')}`);
        showThink(session);
        return { handled: true };
      }

      if (!THINK_LEVELS.includes(말)) {
        showThink(session);
        return { handled: true };
      }
      session.think = 말;
      session.thinkSet = true;      // 사용자가 직접 정했다 — 작업 모드보다 우선한다
      // 여기는 지역 변수 `말`(사람이 친 인자)이 i18n 의 말() 을 가리는 자리라,
      // 여태 이 두 줄만 한국어가 소스에 박혀 있었다. 옮긴말 로 부른다.
      say(`  ${mark.ok} ${옮긴말('think.effort')} ${c.bold(말)}`);
      if (!session.conn.think && 말 !== 'off') {
        say(`     ${c.yellow(옮긴말('think.nomodel'))} ${c.gray(옮긴말('think.nomodel.note'))}`);
      }
      showThink(session);
      return { handled: true };
    }

    /*
     * /mode — 무엇을 물어보고 무엇을 그냥 할지.
     *
     * 목록을 그릴 때 **지금 것을 표시로 찍는다.** 전에는 '지금 auto' 라고 한 줄
     * 적고 아래에 셋을 나란히 늘어놨는데, 그러면 어느 것이 켜져 있는지 두 군데를
     * 견줘 봐야 안다. 내 파일이 물어보고 바뀌는지 아닌지는 흘깃 봐서 알아야 한다.
     */
    case 'mode': {
      const { 승인, 차례: 승인차례, 표시: 승인표시 } = await import('./ui/approve.js');
      if (!MODES[arg]) {
        rule('승인 방식 — 무엇을 물어볼까', 70);
        for (const k of 승인차례) {
          const 지금 = k === session.mode;
          const m = 승인[k];
          say(`  ${지금 ? c.hgreen('●') : c.gray('○')} ${승인표시(k)}${c.gray(pad('', Math.max(1, 14 - width(m.이름))))}`
            + `${c.gray(pad('/mode ' + k, 15))} ${지금 ? c.white(m.한줄) : c.gray(m.한줄)}`);
        }
        say('');
        say(`  ${c.gray('지금은')} ${승인표시(session.mode)} ${c.gray('입니다. 상태줄 오른쪽에도 늘 떠 있습니다.')}`);
        say(`  ${c.gray('치지 않고 바꾸려면')} ${c.cyan('Shift+Tab')} ${c.gray('— 누를 때마다 차례로 돕니다.')}`);
        /*
         * 적어 둔 규칙은 모드보다 세다. 그러니 모드만 보여 주고 규칙을 안 보여
         * 주면 화면이 거짓말을 하는 셈이다 — "안 묻습니다" 라고 적힌 모드에서
         * 무언가 막히면 사람은 고장으로 읽는다.
         *
         * 어디에 적힌 규칙인지까지 적는다. 설정이면 제가 고치면 되고, 관리
         * 정책이면 고칠 수 없다는 것을 알아야 관리자에게 말할 수 있다.
         */
        규칙보이기(ctx.규칙들);
        say('');
        return { handled: true };
      }
      const 앞 = session.mode;
      session.mode = arg;
      const m = 승인[arg];
      say('');
      say(`  ${mark.ok} ${승인표시(앞)} ${c.gray('→')} ${승인표시(arg)}`);
      say(`     ${c.gray(m.한줄)}`);
      // 안 묻는 쪽으로 옮길 때만 안전망을 짚어 준다. 반대로 갈 때는 안 짚는다 —
      // 조심하는 쪽으로 가는 사람에게 경고를 붙일 이유가 없다.
      if (arg === 'auto' && 앞 !== 'auto') {
        say(`     ${c.gray('되돌리려면')} ${c.cyan('/undo')}${c.gray(', 무엇이 바뀌었는지는')} ${c.cyan('/diff')}`);
      }
      say('');
      return { handled: true };
    }

    /*
     * 되돌리기 — 파일과 **대화를 같이** 되감는다.
     *
     * 전에는 파일만 되돌렸다. 대화에는 "src/runner.js 를 고쳤습니다" 가 그대로
     * 남아 있어서, 그다음 턴에 모델은 이미 고쳐 놓은 줄 알고 그 위에 이어
     * 일했다 — 없는 코드를 고치려 들고, 없는 함수를 부른다. 사람 눈에는 모델이
     * 헛소리하는 것으로 보이지만, 사실은 우리가 모델에게 거짓말을 남겨 둔 것이다.
     *
     * 세 군데를 같이 맞춰야 한 벌이 된다 — 오간 말, 적어 둔 파일(--resume 이
     * 이어 여는 자리), 그리고 /diff 가 세는 '바뀐 파일'. 하나라도 빠지면
     * 되돌린 것이 다음 순간 되살아난다.
     */
    case 'undo': {
      const n = Math.max(1, parseInt(arg, 10) || 1);
      const r = ctx.history.undo(n);
      /*
       * 세는 수는 **진짜로 되돌아간 것**이다.
       *
       * 전에는 restored.length 를 그대로 썼다. 그 배열에는 못 되돌린 것과
       * 손대지 않은 것(바이너리처럼 내용을 못 떠 둔 파일)까지 들어 있어서,
       * 하나도 못 되돌린 판에도 「파일 2개를 되돌렸습니다」 가 나올 수 있었다.
       * 감사기록에도 그 부풀린 수가 그대로 남았다.
       */
      const 되돌린수 = r.되돌린수 ?? r.restored.length;
      ctx.audit.undo({ turns: r.turns, files: 되돌린수 });
      if (!r.restored.length) {
        say(`  ${c.gray(말('undo.nothing'))}`);
        say('');
        return { handled: true };
      }
      say(`  ${mark.ok} ${말('undo.done', { turns: r.turns, files: 되돌린수 })}`);
      for (const f of r.restored) say(`    ${c.gray(ctx.scope.show(f.path))}  ${c.gray(f.how)}`);
      // 못 되돌린 것이 있으면 그것만 따로 못 박는다. 위 목록에 섞여 있으면 안 읽힌다.
      if (r.못한것?.length) {
        say(`  ${mark.warn} ${말('undo.failed', { n: r.못한것.length })}`);
      }

      // /diff 가 세던 것에서도 뺀다. 되돌린 파일이 '바뀐 파일' 로 남아 있으면
      // 사람도 되돌아간 줄 모른다. **되돌아간 것만** 뺀다 — 못 되돌린 파일을
      // 여기서 빼면 진짜로 바뀌어 있는 파일이 /diff 에서도 사라진다.
      for (const f of r.restored) if (f.ok === true) session.changes.delete(f.path);
      // 상태줄의 '되돌릴 턴' 도 여기서 줄여 준다. 안 줄이면 방금 되돌린 것을
      // 아직 되돌릴 수 있는 것처럼 세고 있게 된다.
      try { session.되돌릴턴 = ctx.history.turns().length; } catch { /* 못 세면 그냥 둔다 */ }

      const 되감음 = session.되감기(r.turnIds ?? []);
      if (되감음.걷은것) {
        say(`    ${c.gray(말('undo.alsoTalk', { n: 되감음.걷은것 }))}`);
        if (되감음.고친것) say(`    ${c.gray(말('undo.repaired', { n: 되감음.고친것 }))}`);
        try { ctx?.갈래?.현재store?.()?.replace(session.messages, `되돌리기 — ${r.turns}개 턴`); }
        catch { /* 적어 두지 못해도 이번 대화는 이어진다 */ }
        if (되감음.사람말) {
          const 한줄 = 되감음.사람말.replace(/\s+/g, ' ').trim();
          say(`    ${c.gray(말('undo.saidWas'))} ${c.cyan(한줄.length > 60 ? `${한줄.slice(0, 60)}…` : 한줄)}`);
        }
      } else {
        // 접기·요약이 그 자리를 이미 가져갔을 때다. 파일은 되돌아갔지만 대화는
        // 못 걷었다는 것을 숨기지 않는다 — 숨기면 위의 사고가 그대로 난다.
        say(`    ${c.gray(말('undo.talkKept'))}`);
        say(`    ${c.gray(말('undo.talkKeptWhy'))}`);
      }
      say('');
      return { handled: true };
    }

    case 'diff': return 바뀐것보기(session, ctx, arg), { handled: true };

    case 'preview':
    case 'serve': return await 미리보기(session, ctx, arg), { handled: true };

    case 'tools': {
      rule(말('scr.tools'), 70);
      /*
       * 원본 schema.description 을 그대로 찍으면 안 된다.
       *
       * 그 글은 한국어다. 영어 표(tools/desc.en.js)는 **모델에게 줄 때만**
       * 갈아 끼우고 있어서, 영어로 켠 사람의 `/tools` 는 스물한 줄이 통째로
       * 한국어로 나왔다. `/lang` 은 그 사이에도 100% 라고 답했다 — 이 글들은
       * 애초에 말 표에 들어간 적이 없어서 셈에 안 잡혔기 때문이다.
       *
       * 여기서는 **화면 말**(언어())로 고른다. 모델에게 주는 글의 말과는
       * 다른 축이다 — 영어로 시키고 한국어로 보는 조합이 실제로 쓰인다.
       */
      for (const [n, t] of Object.entries(TOOLS)) {
        say(`  ${c.cyan(pad(n, 8))} ${c.gray(영어설명(t.schema, n, 언어()).description)}`);
      }
      say('');
      return { handled: true };
    }

    case 'cost': {
      const mins = ((Date.now() - session.startedAt) / 60000).toFixed(1);
      rule(말('scr.session'), 70);
      say(`  ${c.gray(pad(말('cost.calls'), 14))} ${말('unit.calls', { n: session.usage.calls })}`);
      /*
       * 「들어간 토큰」 은 **보낸 것 전체**를 적는다. 캐시에 맞은 몫도 보낸 것이다.
       * 서버가 새로 읽은 몫만 적으면 캐시가 잘 맞을수록 숫자가 줄어서, 일이
       * 줄어든 것처럼 읽힌다. 새로 읽은 몫과의 차이는 바로 아래 캐시 줄이 적는다.
       */
      const 보낸것 = session.usage.prompt || session.usage.in;
      /*
       * 창구가 usage 를 안 준 부름이 있었으면 **그렇다고 적는다.**
       *
       * 안 적으면 그 몫이 0 으로 합쳐져서, 유료로 부르고도 화면이 「입력 0 ·
       * $0.00」 이라고 말한다. 이 프로그램에서 제일 나쁜 고장이 화면이
       * 거짓말하는 것이고, 0 은 「모른다」 를 숫자로 지어낸 것이다.
       */
      const 못잰것 = session.usage.못잰것 ?? 0;
      const 덧말 = 못잰것 ? c.yellow(`  (${못잰것}번은 창구가 안 알려 줘서 안 들어감)`) : '';
      say(`  ${c.gray(pad(말('cost.tokIn'), 14))} ${보낸것.toLocaleString()}${덧말}`);
      say(`  ${c.gray(pad(말('cost.tokOut'), 14))} ${session.usage.out.toLocaleString()}`);
      /*
       * ── 캐시가 얼마나 맞았나 ────────────────────────────────────────
       *
       * 읽기와 쓰기를 **따로** 적는다. 하나로 뭉치면 「잘 읽고 있다」 와
       * 「매번 쓰기만 하고 한 번도 못 읽는다」 가 같아 보이는데, 그 둘은
       * 정반대 상태다. 뒤쪽은 캐시를 켜 놓고 값만 더 내는 것이다.
       *
       * 서버가 캐시 수치를 안 주는 자리도 많다. 그때는 줄 자체를 안 적는다 —
       * 모르는 것을 0 으로 적으면 「캐시가 하나도 안 맞는다」 로 읽힌다.
       */
      const 읽힘 = session.usage.cacheRead ?? 0;
      const 쓰임 = session.usage.cacheWrite ?? 0;
      if (읽힘 || 쓰임) {
        // 분모는 보낸 것 전체다. 읽힘은 이미 그 안에 들어 있으므로 또 더하면 안 된다.
        const 몫 = 보낸것 > 0 ? Math.round((읽힘 / 보낸것) * 100) : 0;
        say(`  ${c.gray(pad(말('cost.cache'), 14))} ${말('cost.cacheLine', {
          읽음: 읽힘.toLocaleString(), 씀: 쓰임.toLocaleString(), 몫: String(몫),
        })}`);
        // 쓰기만 있고 읽기가 없으면 표식이 매번 새로 엮이는 것이다. 그건 손해다.
        if (쓰임 > 0 && 읽힘 === 0) say(`  ${c.gray(pad('', 14))} ${c.yellow(말('cost.cacheColdWarn'))}`);
      }
      /*
       * 답 토큰 중 생각에 쓴 몫. `/think` 를 높게 잡아 둔 대가가 여기 보인다.
       *
       * 안 알려 주는 창구가 많다. 0 이면 줄을 안 적는다 — 모르는 것을 0 으로
       * 적으면 「생각을 안 했다」 로 읽히고, 그건 우리가 모른다는 사실과 다르다.
       */
      const 생각몫 = session.usage.reasoning ?? 0;
      if (생각몫 > 0) {
        const 비율 = session.usage.out > 0 ? Math.round((생각몫 / session.usage.out) * 100) : 0;
        say(`  ${c.gray(pad(말('cost.think'), 14))} ${말('cost.thinkLine', {
          토큰: 생각몫.toLocaleString(), 몫: String(비율),
        })}`);
      }
      say(`  ${c.gray(pad(말('cost.toolMs'), 14))} ${말('unit.sec', { n: (session.usage.ms / 1000).toFixed(1) })}`);
      // 서버가 잠깐 막아 다시 부른 횟수. 0 이면 안 적는다 — 없는 일을 줄로 남기면 표만 길어진다.
      if (session.usage.retries) say(`  ${c.gray(pad(말('cost.retries'), 14))} ${말('unit.calls', { n: session.usage.retries })}`);
      say(`  ${c.gray(pad(말('cost.elapsed'), 14))} ${말('unit.min', { n: mins })}`);
      /*
       * 돈.
       *
       * 이 도구에는 값이 박힌 요금표가 없다(backend/price.js). 지어낸 요금을
       * 자신 있게 찍는 것보다 모른다고 말하는 편이 낫다고 봤다.
       *
       * 그래서 두 갈래다 — 아는 값이 있으면 금액과 **어디서 온 값인지**를
       * 같이 적고, 모르면 어디에 무엇을 적으면 되는지를 적는다. 「모릅니다」
       * 한 줄로 끝내면 사람이 할 수 있는 일이 없다.
       *
       * 로컬로만 쓰는 사람에게는 아예 안 띄운다. 로컬은 공짜라 그 자리가
       * 영영 안 채워지고, 그러면 매번 쓸모없는 안내만 보게 된다.
       */
      const 요금값 = 세션요금(session);
      const 쓴돈 = 돈셈(session.usage, 요금값);
      if (쓴돈) {
        /*
         * 캐시 요금을 모르면 캐시 토큰도 정가로 셌다는 뜻이다. 그 금액은
         * 실제보다 **크다**. 그냥 찍으면 사람은 그 숫자를 예산으로 잡는데,
         * 캐시가 잘 걸리는 대화일수록 몇 배씩 부풀어 있다. 숫자를 감추지
         * 말고 「위쪽 값」 이라고 말한다 — 그리고 어디에 적으면 정확해지는지
         * 같이 알려 준다.
         */
        const 위쪽 = 쓴돈.캐시모름;
        say(`  ${c.gray(pad(말('cost.money'), 14))} ${c.bold(돈말(쓴돈.달러))}`
          + (위쪽 ? ` ${c.gray('이하')}` : '')
          + ` ${c.gray(`(${어디서온값(요금값)})`)}`);
        if (위쪽) {
          say(`  ${c.gray(' '.repeat(14))} ${c.gray('캐시 요금을 몰라 캐시 토큰도 정가로 셌습니다 — 실제로는 이보다 쌉니다.')}`);
          say(`  ${c.gray(' '.repeat(14))} ${c.gray('요금표에 `캐시읽기`·`캐시쓰기` 를 적으면 정확해집니다.')}`);
        }
      } else if (바깥인가(session.conn.base) && (session.usage.in || session.usage.out)) {
        const 붙은곳 = session.제공자 ? 제공자고르기(session.제공자) : null;
        for (const 줄 of 요금적는법(session.conn.model, { 제공자: 붙은곳, 설정파일: configPath() })) {
          say(`  ${c.gray(줄)}`);
        }
      }
      // 설정에 적어는 뒀는데 숫자가 아니면 조용히 넘어가면 안 된다. 사람은
      // 적었다고 믿고 있으므로, 안 나오는 까닭을 화면에서 알 수 있어야 한다.
      for (const 탈 of 요금값?.탈들 ?? []) say(`  ${c.yellow(mark.no)} ${c.gray(탈)}`);
      /*
       * 서버가 남았다고 말해 준 할당량 (backend/quota.js).
       *
       * 안 알려주는 서버가 많다. 그러면 줄 자체를 안 적는다 — 모르는 것을
       * 0 으로 적으면 멀쩡한데 다 썼다고 믿게 된다.
       */
      const 남은것 = 마지막할당량();
      if (남은것) {
        const 말줄 = 할당량말(남은것);
        say(`  ${c.gray(pad(말('cost.quota'), 14))} ${아슬아슬한가(남은것) ? c.yellow(말줄) : 말줄}`
          + ` ${c.gray(`(${말('cost.quotaAge', { 초: Math.round((Date.now() - 남은것.때) / 1000) })})`)}`);
      }
      say('');
      return { handled: true };
    }

    case 'status': {
      const k = session.conn;
      rule(말('scr.conn'), 70);
      say(`  ${c.gray(pad(말('status.kind'), 10))} ${규격이름(k.kind)}`);
      say(`  ${c.gray(pad(말('status.url'), 10))} ${k.base}`);
      // 프록시를 거치면 어느 것을, 어디서 읽었는지(env · config)까지. 안 거치면 줄 자체가 없다.
      // 적어 놨는데 못 쓰는 것(socks5 등)이면 그 까닭을 — 조용히 직접 가면 사람은 프록시를 탄 줄 안다.
      const 프록시 = 프록시고르기(k.base);
      if (프록시) say(`  ${c.gray(pad(말('status.proxy'), 10))} ${프록시.url} ${c.gray(`(${프록시.출처})`)}`);
      else if (프록시설정().탈) say(`  ${c.gray(pad(말('status.proxy'), 10))} ${c.yellow(말('status.proxyOff'))} ${c.gray(`— ${프록시설정().탈}`)}`);
      say(`  ${c.gray(pad(말('status.model'), 10))} ${k.model}`);
      /*
       * 이 모델이 이 주소에서 **실제로 받는 것** (backend/wire.js).
       *
       * 여태 화면과 전선이 다른 말을 할 수 있었다 — `/think max` 를 쳐도
       * 전선에는 high 가 나가는 식이다. 무엇이 나가는지는 사람이 볼 수
       * 있어야 한다. 안 보이면 조절이 먹었는지 안 먹었는지 알 길이 없다.
       */
      if (k.전선) say(`  ${c.gray(pad(말('status.wire'), 10))} ${c.gray(전선말(k.전선))}`);
      say(`  ${c.gray(pad(말('status.root'), 10))} ${session.root}`);
      // 명령이 어느 셸에서 도는지. "ls 가 왜 안 되지" 의 답이 이 줄에 있다.
      say(`  ${c.gray(pad(말('status.shell'), 10))} ${정한셸().표시}`);
      // 열쇠를 어디에 두고 있나. 사내 심사에서 제일 먼저 묻는 것이라
      // 「어딘가 잠겨 있겠지」 로 두지 않고 지금 상태를 그대로 적는다.
      /*
       * 열쇠를 어디에 두고 있나 — 또는 **어디서 받아 오나.**
       *
       * 받아 오는 연결에서는 「보관」 을 적으면 거짓말이 된다. 우리는 그
       * 열쇠를 갖고 있지 않다. 사내 심사에서 제일 먼저 묻는 자리라
       * 있는 그대로 적는다 (safety/authcmd.js).
       */
      if (session.conn.열쇠받기) {
        const 상태 = 지금열쇠상태();
        const 남은말 = 상태
          ? 말('auth.leftMin', { 분: Math.round(상태.남은초 / 60) })
          : 말('auth.notYet');
        say(`  ${c.gray(pad(말('status.keyStore'), 10))} `
          + `${말(session.conn.열쇠받기.곳 === '정책' ? 'auth.fromPolicy' : 'auth.from')} ${c.gray(`· ${남은말}`)}`);
        say(`  ${c.gray(pad('', 10))} ${c.gray(clip(session.conn.열쇠받기.명령, 56))}`);
      } else if (k.auth !== 'none') {
        say(`  ${c.gray(pad(말('status.keyStore'), 10))} ${열쇠보관(load())}`);
      }
      say(`  ${c.gray(pad(말('status.rules'), 10))} ${session.rules ? session.rules.name : 말('status.noRules')}`);
      // 파일이 있는데 못 읽은 것을 '없음' 으로 적으면, 규칙을 적어 둔 사람은
      // 걸려 있다고 믿는다. 안 걸린 채로 도는 것이 여기서 제일 나쁜 모양이다.
      if (session.규칙못읽음) {
        say(`  ${c.gray(pad('', 10))} ${mark.warn} ${c.yellow(말('status.rulesUnread', {
          이름: session.규칙못읽음.이름, 까닭: session.규칙못읽음.까닭,
        }))}`);
      }
      const caps = [
        k.tools ? c.green(말('status.capTools')) : c.red(말('status.capTools')),
        k.streaming ? c.green(말('status.capStream')) : c.gray(말('status.capStream')),
        k.json ? c.green(말('status.capSchema')) : c.gray(말('status.capSchema')),
        k.think ? c.green(말('status.capThink')) : c.gray(말('status.capThink')),
      ].join(c.gray(' · '));
      say(`  ${c.gray(pad(말('status.caps'), 10))} ${caps}`);
      say('');
      return { handled: true };
    }

    case 'work':
    case 'auto':
    case 'code': case 'plan': case 'architect':
    case 'debug': case 'ask': case 'orchestrator': {
      // 인자 없이 /work 만 치면 지금 모드와 고를 수 있는 것을 보여 준다.
      if (name === 'work' && !arg.trim()) { showWork(session); return { handled: true }; }

      const 골라진 = normWork(name === 'work' ? arg : name);
      if (!골라진) {
        // 오타에는 목록만 보여 주면 안 된다.
        //
        // 예전에는 /work 오타 가 조용히 목록으로 빠졌다. 그러면 사람은 자기가
        // 친 말이 틀렸다는 걸 모른 채 '왜 안 바뀌지' 만 하게 된다. 못 알아들었다는
        // 말을 먼저 하고, 그 다음에 쓸 수 있는 것을 보여 준다.
        say(`  ${mark.warn} 그런 모드는 없습니다: ${c.white(arg)}`);
        say(`  ${c.gray('쓸 수 있는 것:')} ${WORK_ORDER.map((k) => c.cyan(WORK_MODES[k].name)).join(c.gray(' · '))}`);
        say('');
        showWork(session);
        return { handled: true };
      }
      session.work = 골라진;
      // 사람이 직접 골랐다. 저절로 골라 둔 것이 있으면 지운다 —
      // 안 지우면 이번 한마디는 여전히 옛 모드로 돌아 "왜 안 바뀌지" 가 된다.
      session.routed = null;
      const w = getWork(골라진);
      say('');
      say(`  ${c.hcyan(w.glyph)} ${c.bold(보일이름(w.id))} ${c.gray('(' + w.en + ')')}  ${c.gray(보일한줄(w.id))}`);
      say(`  ${c.gray('도구')}    ${canWrite(골라진) ? c.yellow('읽기 + 파일 바꾸기') : c.green('읽기만 — 파일을 못 바꿉니다')}`);
      say(`  ${c.gray('생각')}    ${c.white(w.think ?? session.think)}${c.gray('·')}${c.magenta(w.effort)}   ${c.gray('최대 ' + w.steps + '걸음')}`);
      if (골라진 === 'auto') {
        say(`  ${c.gray('앞으로는 한마디마다 알맞은 모드로 저절로 옮겨 갑니다.')}`);
      } else {
        say(`  ${c.gray('직접 고르셨으므로 저절로 바뀌지 않습니다. 다시 맡기려면')} ${c.cyan('/work 종합')}`);
      }
      say('');
      return { handled: true };
    }

    case 'scan': {
      const s2 = spin('이 PC 의 로컬 서버를 찾는 중…');
      const found = await scanLocal({ timeout: 1500 });
      s2.stop(`  ${found.length ? mark.ok : mark.warn} ${found.length}곳 찾음`);
      if (!found.length) {
        say(`  ${c.gray('떠 있는 로컬 서버가 없습니다. 다른 포트라면')} ${c.cyan('deel scan --ports ...')}`);
        say('');
        return { handled: true };
      }
      for (const f of found) {
        say(`  ${c.hcyan('◆')} ${c.bold(pad(f.runtime, 12))}${c.gray(pad(`${f.host}:${f.port}`, 22))}${c.gray(`모델 ${f.models.length}개`)}`);
        for (const m of f.models.slice(0, 6)) say(`      ${c.gray('·')} ${clip(m.id, 44)}`);
        if (f.models.length > 6) say(`      ${c.gray(`… 그 밖에 ${f.models.length - 6}개`)}`);
      }
      say('');
      if (arg === 'save') {
        const cfg2 = load();
        const ps = toProfiles(found, cfg2.profiles);
        for (const x of ps) upsert(cfg2, x);
        save(cfg2);
        say(`  ${mark.ok} ${ps.length}개 등록했습니다. ${c.cyan('/model')} 로 고르세요.`);
      } else {
        say(`  ${c.gray('등록하려면')} ${c.cyan('/scan save')}   ${c.gray('고르려면')} ${c.cyan('/model')}`);
      }
      say('');
      return { handled: true };
    }

    /*
     * /recall — 지난 대화에서 **내용으로** 찾는다.
     *
     * /sessions 는 목록만 보여 준다. 언제 무슨 모델로 몇 턴 했는지는 알겠는데
     * "저번에 그 인코딩 문제 어떻게 풀었더라" 는 못 찾는다. 기록이 있는데
     * 못 찾으면 없는 것과 같다.
     */
    case 'recall': {
      const 말 = String(arg ?? '').trim();
      if (!말) {
        say(`  ${c.gray('찾을 말을 적어 주세요 —')} ${c.cyan('/recall CP949 인코딩')}`);
        say(`  ${c.gray('낱말 두세 개가 가장 잘 맞습니다. 조사는 붙어 있어도 됩니다.')}`);
        say('');
        return { handled: true };
      }
      const { 찾기 } = await import('./agent/recall.js');
      const r = 찾기(session.root, 말, { limit: 10 });

      rule(`지난 대화에서 "${clip(말, 30)}"`, 70);
      if (!r.낱말.length) {
        say(`  ${mark.no} 찾을 낱말이 없습니다 ${c.gray('— 두 글자 이상으로 적어 주세요.')}`);
        say('');
        return { handled: true };
      }
      if (!r.맞은것.length) {
        // 못 찾은 것과 안 찾아본 것을 구분해서 말한다.
        say(r.예산초과
          ? `  ${mark.warn} 지난 대화 ${r.전체파일}개 중 ${r.본파일}개까지만 뒤졌습니다 ${c.gray('(양이 많아 멈췄습니다)')}`
          : `  ${c.gray(`지난 대화 ${r.본파일}개를 다 뒤졌지만 없습니다.`)}`);
        say(`  ${c.gray('찾은 낱말:')} ${c.white(r.낱말.join(' · '))}`);
        say('');
        return { handled: true };
      }

      for (const h of r.맞은것) {
        const 날 = h.언제 instanceof Date ? h.언제.toISOString().slice(0, 16).replace('T', ' ') : '';
        const 색 = h.role === 'user' ? c.hcyan : h.role === 'assistant' ? c.white : c.gray;
        say(`  ${c.gray(pad(날, 17))} ${색(pad(h.누구, 7))} ${c.gray(h.세션)}`);
        say(`      ${강조(h.토막, r.낱말)}`);
      }
      say('');
      say(`  ${c.gray(`${r.전체맞음}건 중 ${r.맞은것.length}건 · 대화 ${r.본파일}개를 뒤졌습니다`)}`
        + (r.예산초과 ? `  ${c.yellow(`(${r.전체파일}개 중 ${r.본파일}개까지만)`)}` : ''));
      say(`  ${c.gray('그 대화를 이어하려면')} ${c.cyan('deel --resume ' + r.맞은것[0].세션)}`);
      say('');
      return { handled: true };
    }

    /*
     * /mcp — 밖에서 붙인 도구 서버.
     *
     * 여기서 제일 중요한 줄은 도구 목록이 아니라 **경고**다. MCP 서버는 남의
     * 프로그램이고 우리 작업 범위를 안 지킨다. 화면 어디에도 그 말이 없으면
     * 사람은 우리 도구와 똑같이 안전한 줄 안다.
     */
    /*
     * /memory — 대화가 끝나도 남는 것.
     *
     * 사람이 반드시 **볼 수 있고 지울 수 있어야** 한다. 모델이 잘못 적은 줄은
     * 매 요청마다 실려 나가면서 계속 틀리게 만든다. 틀린 기억은 없느니만 못하다.
     */
    case 'memory': {
      const M = await import('./agent/memory.js');
      const 말 = String(arg ?? '').trim();

      if (/^(비우기|clear|지우기전부)$/.test(말)) {
        M.비우기(session.root);
        session.memory = M.프롬프트토막(session.root);
        say(`  ${mark.ok} 기억을 비웠습니다.`);
        say('');
        return { handled: true };
      }

      const 지움 = /^(지우기|잊어|forget|rm)\s+(\d+)$/.exec(말);
      if (지움) {
        const r = M.지우기(session.root, 지움[2]);
        if (!r.ok) say(`  ${mark.no} ${r.why}`);
        else {
          session.memory = M.프롬프트토막(session.root);
          say(`  ${mark.ok} 잊었습니다: ${c.gray(clip(r.뺀것, 60))}`);
        }
        say('');
        return { handled: true };
      }

      // 그 밖의 말은 '이걸 기억해라' 로 본다. 모델을 안 거치고 바로 적는 길이다.
      if (말) {
        const r = M.더하기(session.root, 말);
        if (!r.ok) say(`  ${mark.warn} ${r.why}`);
        else {
          session.memory = M.프롬프트토막(session.root);
          say(`  ${mark.ok} 기억했습니다 ${c.gray(`(${r.줄수}줄)`)}`);
          if (r.넘침) say(`     ${c.gray('자리가 차서 오래된 것을 뺐습니다.')}`);
        }
        say('');
        return { handled: true };
      }

      const 기억 = M.읽기(session.root);
      rule('기억 — 대화가 끝나도 남는 것', 70);
      if (!기억.줄들.length) {
        say(`  ${c.gray('아직 없습니다.')}`);
        say('');
        say(`  ${c.gray('모델이 스스로 적기도 하고, 직접 적으셔도 됩니다 —')}`);
        say(`  ${c.cyan('/memory 사내 문서는 CP949 로 읽고 CP949 로 되돌려 쓴다')}`);
        say('');
        return { handled: true };
      }
      for (const [i, l] of 기억.줄들.entries()) {
        say(`  ${c.gray(String(i + 1).padStart(2))}  ${c.white(clip(l, 82))}`);
      }
      const 글자 = 기억.줄들.join('\n').length;
      say('');
      say(`  ${c.gray(`${기억.줄들.length}줄 · 약 ${Math.round(글자 / 3).toLocaleString()}토큰이 매 요청마다 함께 나갑니다`)}`);
      say(`  ${c.gray('파일')} ${c.white(기억.자리)} ${c.gray('— 직접 고치셔도 됩니다')}`);
      say(`  ${c.cyan('/memory 지우기 3')}   ${c.cyan('/memory 비우기')}`);
      say('');
      return { handled: true };
    }

    case 'mcp': {
      const { 설정읽기, 설정자리, 도구최대 } = await import('./backend/mcp.js');
      const 붙은것 = session.mcp ?? [];
      rule('밖에서 붙인 도구 (MCP)', 70);

      if (!붙은것.length) {
        const 설정 = 설정읽기(session.root);
        if (설정.오류) say(`  ${mark.no} ${설정.오류}`);
        else if (!설정.있음) {
          say(`  ${c.gray('붙인 것이 없습니다.')} ${c.gray('설정 파일이 없습니다 —')} ${c.white(설정자리(session.root))}`);
        } else if (!설정.서버들.length) {
          say(`  ${c.gray('설정은 있는데 띄울 서버가 없습니다.')} ${c.gray(설정자리(session.root))}`);
        } else {
          say(`  ${mark.warn} 설정에 ${설정.서버들.length}대가 적혀 있는데 하나도 안 붙었습니다.`);
          say(`     ${c.gray('오프라인 잠금 중이거나, 켤 때 못 떴습니다. 머리말의 경고를 보세요.')}`);
        }
        say('');
        say(`  ${c.gray('붙이려면')} ${c.white('.deel/mcp.json')} ${c.gray('에 이렇게 적습니다 —')}`);
        say(`  ${c.gray('{ "mcpServers": { "사내위키": { "command": "node", "args": ["wiki-mcp.js"] } } }')}`);
        say('');
        say(`  ${c.yellow('※')} ${c.gray('MCP 서버는 남의 프로그램입니다. 사내 반입 심사를 따로 받으셔야 합니다.')}`);
        say('');
        return { handled: true };
      }

      for (const s of 붙은것) {
        const 상태 = s.살아있나() ? c.green('●') : c.red('○');
        const 이름들 = s.도구.map((t) => t.name);
        say(`  ${상태} ${c.bold(s.이름)}  ${c.gray(s.정보?.name ? `${s.정보.name} ${s.정보.version ?? ''}` : s.설정.command)}`);
        say(`      ${c.gray('도구 ' + s.도구.length + '개')}  ${c.gray(clip(이름들.join(' · '), 60))}`);
        if (s.잘림) say(`      ${mark.warn} ${c.gray(`${s.잘림}개는 뺐습니다 — 한 서버에 ${도구최대}개까지만 받습니다(컨텍스트가 줄어듭니다)`)}`);
        if (!s.살아있나()) say(`      ${c.red(s.죽음 ?? '죽었습니다')}`);
      }
      say('');
      say(`  ${c.gray('모델에게는')} ${c.white('mcp__<서버>__<도구>')} ${c.gray('라는 이름으로 보입니다.')}`);
      say(`  ${c.yellow('※')} ${c.gray('이 도구들은 남의 프로그램이 돌립니다 —')} ${c.white('작업 범위(' + session.root + ') 를 안 지킵니다.')}`);
      say(`  ${c.gray('  무엇을 불렀는지는')} ${c.white('.deel/audit.jsonl')} ${c.gray('에 남습니다.')}`);
      // 바로 위 줄이 약속이다. 못 지키고 있으면 여기서 말해야 한다.
      if (ctx?.audit?.못쓴것?.()) {
        say(`  ${mark.warn} ${c.yellow('지금 그 파일에 못 적고 있습니다')} ${c.gray('— /증거 에서 까닭을 보세요.')}`);
      }
      say('');
      return { handled: true };
    }

    case 'thread':
    case '갈래': return 갈래명령(session, ctx, arg), { handled: true };

    case 'learned':
    case '배움': return 배움명령(session, ctx, arg), { handled: true };

    case 'pin':
    case '못박기': return 못박기명령(session, ctx, arg), { handled: true };

    case 'evidence':
    case '증거': return 증거명령(session, ctx, arg), { handled: true };

    case 'commit':
    case '커밋': return await 커밋명령(session, ctx, arg), { handled: true };

    case 'review':
    case '리뷰': return await 리뷰명령(session, ctx), { handled: true };

    /*
     * 클립보드에 든 화면 캡처를 그대로 붙인다.
     *
     * 파일로 앉힌 뒤 `@경로` 한 줄로 바꿔서 돌려준다. 붙이는 일은 이미
     * 검증된 @-붙이기 길(agent/mention.js)이 하게 두는 것이다 — 여기서
     * 따로 그림을 만들어 넣으면 예산 셈·눈 없는 모델 처리가 두 벌이 된다.
     *
     * 사람에게 **경로를 보여 준다.** 무엇이 나가는지 안 보이면, 실수로
     * 다른 캡처가 나가도 알아차릴 자리가 없다.
     */
    case 'paste':
    case '붙여넣기': return 붙여넣기명령(session, ctx);

    case 'sessions': {
      const rows = listSessions(session.root, { limit: 12 });
      rule('이 폴더의 지난 대화', 70);
      if (!rows.length) {
        say(`  ${c.gray('아직 없습니다. 지금 이 대화가 첫 번째입니다.')}`);
        say('');
        return { handled: true };
      }
      for (const [i, r] of rows.entries()) {
        say(`  ${i === 0 ? c.hgreen('●') : c.gray('·')} ${c.bold(pad(r.id, 17))}${c.gray(pad(`${r.turns}턴`, 6, 'right'))}  ${c.gray(clip(r.model, 22))}`);
        say(`      ${c.gray(clip(r.first, 66))}`);
      }
      say('');
      say(`  ${c.gray('이어하려면 나갔다가')} ${c.cyan('deel --continue')} ${c.gray('또는')} ${c.cyan(`deel --resume ${rows[0].id}`)}`);
      /*
       * 바로 아래 줄이 약속이다. 못 지키고 있으면 약속을 되풀이하면 안 된다.
       *
       * /mcp 화면에서 감사기록을 두고 한 것과 같은 자리다 — 「남습니다」 라고
       * 적어 놓고 실제로는 안 남는 것이 제일 나쁘다. 이 화면은 이어하기를
       * 보러 온 화면이라, 여기서 안 말하면 사람이 알 자리가 없다.
       */
      const 저장샘 = ctx?.갈래?.현재store?.()?.못쓴것?.();
      if (저장샘) {
        say(`  ${mark.warn} ${c.yellow(말('store.notSaving', { n: 저장샘.수, 까닭: 저장샘.까닭 }))}`);
      } else {
        say(`  ${c.gray('지금 대화는 나가지 않아도 계속 저장되고 있습니다.')}`);
      }
      say('');
      return { handled: true };
    }

    case 'init': {
      const p = join(session.root, 'DEEL.md');
      if (existsSync(p)) {
        say(`  ${mark.warn} 이미 있습니다: ${c.cyan('DEEL.md')}`);
        say('');
        return { handled: true };
      }
      writeFileSync(p, INIT_TEMPLATE, 'utf8');
      session.rules = { name: 'DEEL.md', text: INIT_TEMPLATE };
      say(`  ${mark.ok} ${c.cyan('DEEL.md')} 를 만들었습니다. 이 폴더의 규칙을 여기에 적으면 매번 읽습니다.`);
      say('');
      return { handled: true };
    }

    case 'skills': return showSkills(session, arg), { handled: true };

    case 'plugin':
    case 'plugins': return await doPlugin(session, arg), { handled: true };

    default: {
      // 이 PC 에서 찾은 슬래시 명령인지 본다. 있으면 그 내용을 모델에게 보낸다.
      const found = (session.commands ?? []).find((x) => x.name === raw)
        ?? (session.commands ?? []).find((x) => x.name.toLowerCase() === name)
        ?? (session.commands ?? []).find((x) => x.name.split(':').pop() === name);
      if (found) {
        const { text, error } = loadCommand(found, arg);
        if (error) { say(`  ${c.red('명령을 읽지 못했습니다')} ${error}`); say(''); return { handled: true }; }
        say(`  ${c.cyan('⌘')} ${found.name} ${c.gray(found.source)}`);
        return { handled: false, text };
      }
      const near = (session.commands ?? [])
        .filter((x) => x.name.includes(name) || name.includes(x.name.split(':').pop()))
        .slice(0, 5).map((x) => '/' + x.name);
      say(`  ${c.red('모르는 명령')} /${name}`);
      if (near.length) say(`  ${c.gray('비슷한 것:')} ${near.join('  ')}`);
      say(`  ${c.gray('/help 로 목록을,  /skills 로 스킬을 봅니다.')}`);
      say('');
      return { handled: true };
    }
  }
}

async function doPlugin(session, arg) {
  const [sub = '', ...rest] = arg.trim().split(/\s+/);
  const param = rest.join(' ').trim();

  // 설치·삭제 뒤에는 다시 훑어 이번 대화에 바로 반영한다.
  const rescan = () => {
    const f = discover(session.root);
    session.skills = f.skills;
    session.commands = f.commands;
    session.plugins = f.plugins;
    return f;
  };

  if (sub === 'install' || sub === 'add') {
    if (!param) {
      say(`  ${c.gray('예')} /plugin install affaan-m/ECC`);
      say(`  ${c.gray('  ')} /plugin install owner/repo#가지이름`);
      say('');
      return;
    }
    say('');
    const s = spin(`${param} 받는 중...`);
    const r = await install(param, { onStep: (m) => {} });
    if (r.error) {
      s.stop(`  ${mark.no} ${c.red(r.error.split('\n')[0])}`);
      for (const line of r.error.split('\n').slice(1)) say(`     ${c.gray(line.trim())}`);
      say(`     ${c.gray('오프라인이면 zip 을 ~/.deel/plugins/ 에 직접 풀면 됩니다.')}`);
      say('');
      return;
    }
    s.stop(`  ${mark.ok} ${c.bold(r.name)}${r.version ? ' ' + c.gray(r.version) : ''} ${c.gray(`(${r.license ?? '라이선스 미상'})`)}`);
    say(`     ${c.gray('스킬')} ${r.skills}개  ${c.gray('명령')} ${r.commands}개  ${c.gray(`· ${r.how} 로 받음`)}`);
    if (r.hooks) say(`     ${mark.warn} ${c.yellow(`실행 스크립트 ${r.hooks}개는 쓰지 않습니다`)} ${c.gray('(hook 미지원 · 반입 심사 대상)')}`);
    const f = rescan();
    say(`     ${c.gray(`이제 스킬 ${f.skills.length}개 · 명령 ${f.commands.length}개`)}`);
    say('');
    return;
  }

  if (sub === 'remove' || sub === 'rm' || sub === 'uninstall') {
    if (!param) { say(`  ${c.gray('예')} /plugin remove ecc`); say(''); return; }
    const r = remove(param);
    if (r.error) { say(`  ${mark.no} ${c.red(r.error)}`); say(''); return; }
    const f = rescan();
    say(`  ${mark.ok} ${c.bold(r.removed)} 지웠습니다. ${c.gray(`이제 스킬 ${f.skills.length}개`)}`);
    say('');
    return;
  }

  if (sub === 'pack') {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const out = param || join(session.root, `deel-plugins-${stamp}.zip`);
    const r = pack(out, { only: null });
    if (r.error) { say(`  ${mark.no} ${c.red(r.error)}`); say(''); return; }
    say('');
    say(`  ${mark.ok} ${c.cyan(r.out)}`);
    say(`     ${c.gray('플러그인')} ${r.plugins.length}개 ${c.gray('· 파일')} ${r.files}개 ${c.gray('·')} ${(r.bytes / 1024).toFixed(0)}KB`);
    if (r.skipped) say(`     ${c.gray(`실행 스크립트 ${r.skipped}개는 뺐습니다`)}`);
    say('');
    rule('담긴 것', 74);
    for (const p of r.plugins) {
      say(`  ${c.cyan(pad(p.name, 22))} ${c.gray(pad(p.version || '-', 9))} ${c.gray(pad(p.license || '미상', 14))} ${c.gray(`스킬 ${p.skills} · 명령 ${p.commands}`)}`);
    }
    say('');
    say(`  ${c.gray('오프라인 기기의')} ~/.deel/plugins/ ${c.gray('에 풀면 바로 인식됩니다. 설치 명령은 필요 없습니다.')}`);
    say(`  ${c.gray('묶음 안에 라이선스 표가 담긴 사용안내.txt 가 함께 들어 있습니다.')}`);
    say('');
    return;
  }

  // 인자 없으면 목록
  const items = list();
  if (!items.length) {
    say('');
    say(`  ${c.gray('설치된 플러그인이 없습니다.')}`);
    say(`  ${c.gray('받기')}  /plugin install owner/repo`);
    say(`  ${c.gray('직접')}  ~/.deel/plugins/ 에 폴더를 풀어 넣어도 됩니다`);
    say('');
    return;
  }
  say('');
  rule('플러그인', 74);
  for (const p of items) {
    say(`  ${c.cyan(pad(p.name, 22))} ${c.gray(pad(p.version || '-', 9))} ${c.gray(pad(p.license || '미상', 14))} ${c.gray(`스킬 ${p.skills} · 명령 ${p.commands}`)}`);
    say(`    ${c.gray(p.from)}`);
  }
  say('');
  say(`  ${c.gray('/plugin install <owner/repo>   /plugin remove <이름>   /plugin pack [파일]')}`);
  say('');
}

/*
 * 만든 웹을 그 자리에서 띄운다.
 *
 * 여기 있는 것은 화면과 말뿐이고, 서버는 preview/serve.js 가 한다.
 * 한 번에 하나만 띄운다 — 여러 개를 띄워 놓으면 어느 주소가 무엇인지
 * 아무도 못 외우고, 끌 때도 뭘 껐는지 모른다.
 */
let 미리보기중 = null;

/** 켜져 있으면 끈다. 프로그램을 끝낼 때도 이걸 부른다. */
export async function 미리보기끄기() {
  if (!미리보기중) return null;
  const 끈것 = 미리보기중;
  미리보기중 = null;
  try { await 끈것.서버.닫기(); } catch { /* 이미 닫혔다 */ }
  return 끈것;
}

/** 지금 띄워 둔 것. 상태줄·검사에서 본다. */
async function 미리보기(session, ctx, arg) {
  const 말 = String(arg ?? '').trim();

  if (/^(off|끄기|중지|stop)$/i.test(말)) {
    const 끈것 = await 미리보기끄기();
    say('');
    say(끈것 ? `  ${mark.ok} 미리보기를 껐습니다. ${c.gray(끈것.서버.url)}`
      : `  ${c.gray('띄워 둔 것이 없습니다.')}`);
    say('');
    return;
  }

  // 이미 떠 있는데 또 치면, 주소를 다시 알려 주고 브라우저만 연다.
  // 여기서 조용히 하나 더 띄우면 포트가 둘이 되고 어느 쪽이 진짜인지 모르게 된다.
  if (미리보기중 && !말) {
    say('');
    say(`  ${c.hgreen('▶')} 이미 띄워 뒀습니다  ${c.cyan(미리보기중.서버.url)} ${c.gray(미리보기중.보인이름)}`);
    브라우저로(미리보기중.서버.url);
    say(`  ${c.gray('끄려면')} ${c.cyan('/preview off')}`);
    say('');
    return;
  }
  // 다른 폴더를 주면 앞엣것은 끄고 새로 띄운다.
  if (미리보기중) await 미리보기끄기();

  let 뿌리;
  try {
    뿌리 = ctx.scope.resolve(말 || '.');
  } catch (err) {
    say('');
    say(`  ${c.red('띄울 수 없습니다')} ${c.gray(err.message)}`);
    say('');
    return;
  }

  if (!existsSync(뿌리)) {
    say('');
    say(`  ${c.red('그런 폴더가 없습니다')} ${c.gray(ctx.scope.show(뿌리))}`);
    say('');
    return;
  }
  // 파일 하나를 줬으면 그 파일이 든 폴더를 띄우고, 브라우저는 그 파일로 연다.
  let 첫주소 = '';
  if (!statSync(뿌리).isDirectory()) {
    첫주소 = encodeURIComponent(뿌리.split(/[\\/]/).pop());
    뿌리 = join(뿌리, '..');
    뿌리 = ctx.scope.resolve(뿌리);
  }

  let 서버;
  try {
    서버 = await 띄우기({ 뿌리, scope: ctx.scope });
  } catch (err) {
    say('');
    say(`  ${c.red('못 띄웠습니다')} ${c.gray(err.message)}`);
    say('');
    return;
  }
  미리보기중 = { 서버, 보인이름: ctx.scope.show(뿌리) };

  const url = 서버.url + 첫주소;
  say('');
  say(`  ${c.hgreen('▶')} ${c.bold('띄웠습니다')}  ${c.cyan(url)}`);
  say(`  ${c.gray('보여 주는 것')} ${c.white(미리보기중.보인이름)}`);
  say(서버.되살아나나
    ? `  ${c.gray('파일을 고치면 화면이 저절로 새로 뜹니다.')}`
    : `  ${c.yellow('⚠')} ${c.gray('이 자리에서는 파일 변화를 못 봅니다 — 브라우저를 손으로 새로 고치세요.')}`);
  // 어디까지 열리는지 반드시 말한다. '서버를 띄웠다' 는 말은 사람마다 다르게 읽힌다.
  say(`  ${c.gray('이 컴퓨터에서만 열립니다(127.0.0.1). 다른 PC 에서는 안 보입니다.')}`);
  say(`  ${c.gray('끄려면')} ${c.cyan('/preview off')}${c.gray('  · deel 을 끝내면 같이 꺼집니다.')}`);
  브라우저로(url);
  say('');
}

function showSkills(session, arg) {
  const all = session.skills ?? [];
  if (!all.length) {
    say('');
    say(`  ${c.gray('이 PC 에서 찾은 스킬이 없습니다.')}`);
    say(`  ${c.gray('찾는 자리: ./.deel/skills  ./.claude/skills  ~/.claude/skills  ~/.claude/plugins')}`);
    say('');
    return;
  }

  // 스킬은 남의 폴더·플러그인에서 온다. 앞머리(frontmatter)가 빠진 파일이 섞이면
  // 이름이나 설명이 없다. 그걸 그대로 만지면 목록 하나 보려다 대화가 끝난다.
  const 낮게 = (v) => String(v ?? '').toLowerCase();

  const q = arg.trim();
  if (q === 'all') {
    all.forEach((s) => { s.enabled = true; });
    session.maxSkillsListed = Math.min(all.length, 200);
    say(`  ${mark.ok} 전부 올립니다 (${session.listedSkills().length}개). ${c.yellow('컨텍스트를 많이 차지합니다 — /context 로 확인하세요.')}`);
    say('');
    return;
  }
  if (q === 'off') {
    all.forEach((s) => { s.enabled = false; });
    say(`  ${mark.ok} 스킬을 모두 내렸습니다.`);
    say('');
    return;
  }
  if (q.startsWith('on ')) {
    const term = q.slice(3).trim().toLowerCase();
    let n = 0;
    for (const s of all) {
      s.enabled = 낮게(s.name).includes(term) || 낮게(s.description).includes(term);
      if (s.enabled) n++;
    }
    say(`  ${mark.ok} "${term}" 에 걸리는 ${n}개만 올립니다.`);
    say('');
    return;
  }

  const hits = q
    ? all.filter((s) => 낮게(s.name).includes(q.toLowerCase()) || 낮게(s.description).includes(q.toLowerCase()))
    : session.listedSkills();

  say('');
  rule(q ? `스킬 검색: ${q}` : '지금 올라간 스킬', 74);
  for (const s of hits.slice(0, 30)) {
    const tag = s.enabled ? c.green('●') : c.gray('○');
    // 설명이 없을 수 있다. 스킬은 남의 폴더·플러그인에서 오는 것이라
    // 앞머리(frontmatter)가 빠진 파일이 섞인다. 여기서 터지면 목록 하나 보려다
    // 대화가 통째로 끝난다 — 화면 그리기는 무슨 일이 있어도 안 죽어야 한다.
    say(`  ${tag} ${c.cyan(pad(s.name, 32))} ${c.gray(String(s.description ?? '').slice(0, 60))}`);
  }
  if (hits.length > 30) say(`  ${c.gray(`… 그 밖에 ${hits.length - 30}개`)}`);
  say('');

  const bySource = { project: 0, user: 0, plugin: 0, builtin: 0 };
  for (const s of all) bySource[s.source] = (bySource[s.source] ?? 0) + 1;
  say(`  ${c.gray('전체')} ${all.length}개  ${c.gray('(프로젝트')} ${bySource.project} ${c.gray('· 사용자')} ${bySource.user} ${c.gray('· 플러그인')} ${bySource.plugin} ${c.gray('· 품고 다니는 것')} ${bySource.builtin}${c.gray(')')}`);
  say(`  ${c.gray('프롬프트에 올라간 것')} ${session.listedSkills().length}개 ${c.gray(`(상한 ${session.maxSkillsListed})`)}`);
  if ((session.plugins ?? []).length) {
    say(`  ${c.gray('플러그인')} ${session.plugins.filter((p) => p.skills > 0).map((p) => p.name).slice(0, 8).join(', ')}`);
  }
  say('');
  say(`  ${c.gray('/skills <검색어>     찾아보기')}`);
  say(`  ${c.gray('/skills on <검색어>  걸리는 것만 올리기')}`);
  say(`  ${c.gray('/skills all | off    전부 올리기 | 내리기')}`);
  say('');
}

function help(session) {
  const level = session?.level ?? LEVEL_DEFAULT;
  const 쉬움 = !levelShows(level, '__전부__');   // 개발자면 show 가 null 이라 전부 참
  say('');
  rule(말(쉬움 ? 'help.titleCommon' : 'help.title'), 70);
  let 감춘수 = 0;
  for (const [n, m] of Object.entries(COMMANDS)) {
    if (n === 'quit') continue;
    if (!levelShows(level, n)) { 감춘수++; continue; }
    say(`  ${c.cyan(pad('/' + n + (m.arg ? ' ' + m.arg : ''), 22))} ${c.gray(m.desc)}`);
  }
  say('');
  // 감춘 것은 '못 쓰는 것' 이 아니다. 그 말을 분명히 해 둔다.
  if (감춘수) {
    say(`  ${c.gray(말('help.moreHidden', { n: 감춘수 }))}`);
    say(`  ${c.gray(말('help.showAll'))} ${c.cyan('/level developer')}`);
    say('');
  }
  say(`  ${c.gray(말('help.restGoesToModel'))}`);
  say('');
}

// /level — 수준 보기·바꾸기. 설정 파일에 남겨 다음에도 그대로 쓴다.
function showLevel(session, arg) {
  if (!arg) {
    rule('사용자 수준', 70);
    for (const k of LEVEL_ORDER) {
      const lv = LEVELS[k];
      const 지금 = k === (normLevel(session.level) ?? LEVEL_DEFAULT);
      say(`  ${지금 ? c.hgreen('●') : c.gray('·')} ${지금 ? c.bold(c.white(pad(lv.name, 10))) : c.gray(pad(lv.name, 10))}${c.gray(lv.hint)}`);
    }
    say('');
    say(`  ${c.gray('안전 장치는 두 수준이 똑같습니다 — 되돌리기·작업 범위·위험 명령 차단.')}`);
    say(`  ${c.gray('수준은 무엇을 보여줄지만 정합니다.')}`);
    say('');
    say(`  ${c.gray('바꾸려면')} ${c.cyan('/level 쉬움')} ${c.gray('또는')} ${c.cyan('/level 개발자')}`);
    say('');
    return;
  }
  const 골라진 = normLevel(arg);
  if (!골라진) {
    say(`  ${mark.warn} 그런 수준은 없습니다: ${c.white(arg)}  ${c.gray('(쉬움 · 개발자)')}`);
    say('');
    return;
  }
  session.level = 골라진;
  try {
    const cfg = load();
    cfg.level = 골라진;
    save(cfg);
  } catch { /* 못 남겨도 이번 세션에는 먹는다 */ }
  const lv = LEVELS[골라진];
  say('');
  say(`  ${mark.ok} ${c.bold(lv.name)} ${c.gray('— ' + lv.hint)}`);
  say(`  ${c.gray('안전 장치는 그대로입니다.')}`);
  say('');
}

/**
 * 찾은 낱말에 색을 입힌다.
 *
 * 토막만 보여 주면 **왜 이게 걸렸는지** 안 보인다. 특히 조사를 떼고 찾기
 * 때문에("인코딩을" 로 "인코딩" 을 찾는다) 눈으로는 안 맞는 것처럼 보이는
 * 경우가 있다. 맞은 자리를 칠해 주면 그 의심이 사라진다.
 */
function 강조(글, 낱말들) {
  let 조각 = [{ 글, 맞음: false }];
  for (const w of 낱말들) {
    const 다음 = [];
    for (const p of 조각) {
      if (p.맞음) { 다음.push(p); continue; }
      const 낮은 = p.글.toLowerCase();
      let i = 0;
      let 자리 = 낮은.indexOf(w);
      while (자리 >= 0) {
        if (자리 > i) 다음.push({ 글: p.글.slice(i, 자리), 맞음: false });
        다음.push({ 글: p.글.slice(자리, 자리 + w.length), 맞음: true });
        i = 자리 + w.length;
        자리 = 낮은.indexOf(w, i);
      }
      if (i < p.글.length) 다음.push({ 글: p.글.slice(i), 맞음: false });
    }
    조각 = 다음;
  }
  return 조각.map((p) => (p.맞음 ? c.hyellow(p.글) : c.gray(p.글))).join('');
}

// 추론 강도는 값 하나가 아니라 '단계별 배분' 이다. 그 배분을 눈에 보이게 그린다.
/**
 * 지금 추론 강도가 어떻게 되어 있는지.
 *
 * 기본은 **한 줄**이다. 사람이 알고 싶은 것은 '지금 얼마나 생각하나' 이지
 * 단계별 표가 아니다. 표는 /think 자세히 로 뺐다.
 *
 * 쉬움 수준에서는 배분 이야기를 아예 안 꺼낸다 — 고를 일이 없는 사람에게
 * 고르는 법을 보여 주면 그것부터 걱정하게 된다.
 */
function showThink(session, { 자세히 = false } = {}) {
  const b = session.breakdown();
  const 아는상한 = session.conn.maxTokens ?? session.conn.maxOut ?? null;
  const t = effortTable(session.think, session.effort, { ctx: b.total, used: b.used, max: 아는상한 });
  const 개발자 = session.level === '개발자';
  const 단계 = t.rows.map((r) => `${r.label} ${r.level}`).join(c.gray(' · '));

  /*
   * 이 화면은 여태 통째로 한국어였다.
   *
   * `/lang en` 으로 켠 사람에게 「추론 강도 medium (첫 판단 medium · …)」 이
   * 뜨면 아무것도 안 읽힌다. 명령 이름만 영어고 화면이 한국어인 자리는
   * 「덜 옮겨졌다」 가 아니라 「고장 났다」 로 읽힌다 — i18n/index.js 머리말.
   *
   * 예로 드는 명령도 말을 따라간다. `/think 배분 절약` 은 영어로 켠 사람이
   * 칠 수 없는 글자다. 두 이름 다 진짜로 받는다(위 배분말·자세히 갈래).
   */
  const 한국어 = 언어() === 'ko';
  const 배분예 = 한국어 ? '/think 배분 절약' : '/think profile save';
  const 자세히예 = 한국어 ? '/think 자세히' : '/think detail';
  say('');
  say(`  ${c.gray(말('think.effort'))}  ${c.bold(session.think)}   ${c.gray(`(${단계})`)}`);
  /*
   * ── 정한 값과 **실제로 나가는 값**을 같이 보여 준다 ──────────────────
   *
   * 여기가 여태 비어 있던 자리다. `/think max` 를 쳐도 전선이 max 를 안
   * 받으면 high 가 나갔고, 화면에는 그 사실이 어디에도 없었다. 사람은
   * 세게 생각하라고 시켰다고 믿는다.
   *
   * 자동 조절도 같이 적는다. 정한 값이 천장이 되므로, 「max 라고 했는데 왜
   * medium 인가」 에 답할 수 있어야 한다.
   */
  /*
   * 자동 조절이 **실제로 무언가를 바꿀 때만** 적는다.
   *
   * `/think low` 로 정해 둔 사람에게 「가벼운 말은 low 까지 낮춰 씁니다」 는
   * 아무 말도 아니다 — 이미 low 다. 아무 일도 안 하는 줄을 화면에 남기면
   * 사람은 그 줄을 읽는 데 시간을 쓰고 아무것도 얻지 못한다.
   */
  if (session.autoThink !== false) {
    const 가장낮게 = 가벼운강도(session.think);
    if (가장낮게 !== session.think) {
      say(`  ${c.gray(pad(말('think.auto'), 한국어 ? 8 : 10))}${c.gray(말('think.autoNote', { 천장: session.think, 지금: 가장낮게 }))}`);
    }
  }
  if (session.conn?.전선) {
    const 카드 = session.conn.전선;
    const 나가는것 = 눈금맞추기(카드, session.think);
    /*
     * ── 「끈다」 가 정말로 꺼지는 창구인가 ────────────────────────────
     *
     * off 인데 나갈 말이 없으면 두 가지 중 하나다.
     *
     *   a. 이 규격에서는 **칸을 안 싣는 것이 곧 끄는 것**이다.
     *      anthropic 은 thinking 을 빼면 안 생각하고, ollama 는 think:false
     *      를 싣는다. 이쪽은 아무 말도 안 해도 된다.
     *   b. 이 규격에서는 칸을 안 실으면 **서버 기본값**으로 돈다. openai 꼴의
     *      추론 모델이 그렇다 — reasoning_effort 를 빼면 서버가 제 기본값
     *      (보통 medium)으로 생각한다. 여기서 아무 말도 안 하면 화면은 off
     *      라고 적어 두고 실제로는 생각이 도는 셈이 된다.
     *
     * b 를 잠자코 두면 화면이 거짓말을 한다. 창구가 끄는 말을 알려 준 적이
     * 없으면 우리는 못 끈다 — 못 끄면 못 끈다고 적는다.
     */
    const 못끄나 = session.think === 'off' && !나가는것 && 카드.생각형식 === 'effort';
    say(`  ${c.gray(pad(말('think.wire'), 한국어 ? 8 : 10))}${c.gray(전선말(카드))}`
      + (나가는것 ? `   ${c.gray(말('think.wireSends', { 값: 나가는것 }))}` : '')
      + (못끄나 ? `   ${c.yellow(말('think.wireNoOff'))}` : ''));
  }
  if (개발자 || 자세히) say(`  ${c.gray(pad(말('think.profile'), 한국어 ? 8 : 10))}${c.bold(t.name)}   ${c.gray(t.desc)}`);

  if (자세히) {
    say('');
    say(`  ${c.gray(pad(말('think.col.stage'), 12) + pad(말('think.col.level'), 10) + pad(말('think.col.cap'), 10) + 말('think.col.when'))}`);
    for (const r of t.rows) {
      const 화살 = r.moved > 0 ? c.yellow('↑') : r.moved < 0 ? c.cyan('↓') : c.gray('·');
      say(`  ${pad(r.label, 12)}${화살} ${pad(r.level, 8)}${pad(r.cap.toLocaleString(), 10, 'right')}  ${c.gray(r.why)}`);
    }
    say('');
    // 상한이 어디서 왔는지 밝힌다. 세 줄이 같은 값일 때 그게 고장인지 아닌지
    // 이 한 줄로 갈린다 — 아는 상한이 낮으면 셋이 같아지는 것이 맞다.
    const 어디서 = session.conn.maxTokens ? 말('think.cap.you')
      : session.conn.maxOut ? 말('think.cap.server') : 말('think.cap.guess');
    say(`  ${c.gray(말('think.cap.head'))} ${c.white((아는상한 ?? 16384).toLocaleString())} ${c.gray(어디서)}${c.gray(말('think.cap.tail'))} ${c.cyan('/out')}`);
    say(`  ${c.gray(말('think.ctx'))} ${c.white(t.ctx.toLocaleString())}${c.gray(말('think.ctx.used'))}${c.white(t.used.toLocaleString())}`);
    say('');
    say(`  ${c.gray(말('think.effort'))}  ${THINK_LEVELS.join(' · ')}   ${c.gray(말('think.eg'))} ${c.cyan('/think high')}`);
    say(`  ${c.gray(말('think.profile'))}  ${Object.entries(PROFILES).map(([k, v]) => { const n = 한국어 ? v.name : (v.en ?? v.name); return n === k ? k : `${k}(${n})`; }).join(' · ')}   ${c.gray(말('think.eg'))} ${c.cyan(배분예)}`);
  } else if (개발자) {
    say(`  ${c.gray(말('think.effort'))} ${c.cyan('/think high')}   ${c.gray(말('think.profile'))} ${c.cyan(배분예)}   ${c.gray(말('think.detail'))} ${c.cyan(자세히예)}`);
  } else {
    /*
     * 다음 칸을 **지금 값에서** 셈한다.
     *
     * 여태 이 두 자리는 high · low 로 박혀 있었다. 눈금이 넷일 때는 그럭저럭
     * 맞았는데 xhigh 가 늘면서 티가 났다 — max 로 쓰고 있는 사람에게
     * 「더 세게 → /think high」 라고 적어 준다. high 는 지금보다 **약하다.**
     *
     * 끝에 서 있으면 그쪽은 아예 안 적는다. 갈 데가 없는 길을 적어 주는 것은
     * 없는 기능을 알려 주는 것과 같다.
     */
    const 위 = shiftLevel(session.think, 1);
    const 아래 = shiftLevel(session.think, -1);
    const 조각 = [];
    if (위 !== session.think) 조각.push(`${c.gray(말('think.harder'))} ${c.cyan(`/think ${위}`)}`);
    if (아래 !== session.think && 아래 !== 'off') 조각.push(`${c.gray(말('think.faster'))} ${c.cyan(`/think ${아래}`)}`);
    if (조각.length) say(`  ${조각.join('   ')}`);
  }

  if (!session.conn.think && session.think !== 'off') {
    say(`  ${c.yellow(말('think.nomodel'))} ${c.gray(말('think.nomodel.note'))}`);
  }
  say('');
}

/**
 * 대화 갈래.
 *
 * 여기서 하는 일은 화면과 말뿐이다. 갈래를 들고 있는 것은 agent/threads.js 다.
 */
function 갈래명령(session, ctx, arg = '') {
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
 * 쓰면서 저절로 알게 된 것.
 *
 * 보여 주는 것이 중요하다. 프롬프트에 몰래 들어가는 글이 있으면 사람은
 * 모델이 왜 그렇게 답했는지 알 수 없게 된다 — 여기서 통째로 볼 수 있어야
 * '자동으로 쌓인다' 가 무섭지 않은 말이 된다. 지우는 길도 같이 둔다.
 */
/**
 * 증거 — 「다 됐습니다」 대신 검토할 수 있는 것.
 *
 * 화면에서 제일 중요한 것은 맨 아래 '증명 안 된 것' 이다. 바꾼 것을 늘어놓는
 * 일은 /diff 도 한다. 안 한 것을 말하는 자리는 여기뿐이다.
 */
function 증거명령(session, ctx, arg = '') {
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
  } else {
    say(`  ${c.green('증명 안 된 것 없음')} ${c.gray('— 바꾼 것마다 그 뒤에 돌린 확인이 있습니다.')}`);
  }
  say('');

  if (/^(파일|file|저장|save)$/i.test(말)) {
    const 이름 = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;
    const 자리 = 증거적기(session.root, e, 이름);
    if (자리) say(`  ${mark.ok} ${c.gray('남겼습니다 —')} ${c.cyan(자리)}`);
    else say(`  ${c.gray('파일로 못 남겼습니다. 화면 것만 쓰세요.')}`);
    say('');
  } else {
    say(`  ${c.gray('파일로 남기려면')} ${c.cyan('/evidence 파일')}`);
    say('');
  }
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
async function 리뷰명령(session, ctx) {
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

async function 커밋명령(session, ctx, arg = '') {
  const 말한것 = String(arg ?? '').trim();
  const 전부 = /^(전부|all)$/i.test(말한것);
  const 미리보기 = /^(미리보기|preview|dry|--dry-run)$/i.test(말한것);
  const 준제목 = 전부 || 미리보기 ? null : (말한것 || null);

  say('');
  rule('커밋', 70);

  const 도는말 = '메시지를 짓는 중…';
  let 돌림 = spin(도는말);
  const r = await 커밋준비(session, ctx, {
    전부,
    제목: 준제목,
    onBackoff: (알림) => {
      돌림.stop(`  ${c.yellow('↻')} ${c.gray(말('loop.backoff', 알림채움(알림)))}`);
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

  const 상태줄 = r.상태 ? r.상태.split('\n') : [];
  if (상태줄.length) {
    say('');
    say(`  ${c.bold('git status --short')}`);
    for (const line of 상태줄.slice(0, 10)) say(`    ${c.gray(clip(line, 76))}`);
    if (상태줄.length > 10) say(`    ${c.gray(`… 그 밖에 ${상태줄.length - 10}줄`)}`);
  }
  say('');

  if (미리보기) {
    say(`  ${c.gray('미리보기입니다 — 찍지 않았습니다. 그대로 찍으려면')} ${c.cyan('/commit')}`);
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
function 카드명령(session, ctx) {
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
function 못박기명령(session, ctx, arg = '') {
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

  if (/^(지우기|빼기|clear|rm|remove)$/i.test(머리 ?? '')) {
    const r = 못.지우기(나머지.join(' ') || '전부');
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
    say(`  ${c.hcyan('📌')} ${c.bold(`${r.번호}.`)} ${말}`);
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

function 배움명령(session, ctx, arg = '') {
  const 배움 = ctx?.배움;
  say('');
  if (!배움) {
    say(`  ${c.gray('이 자리에서는 못 봅니다 — 대화 화면에서만 됩니다.')}`);
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
      const 표 = r.no === 0 ? c.green('✓') : r.ok === 0 ? c.red('✗') : c.yellow('~');
      say(`    ${표} ${pad(r.이름, 24)} ${c.gray(`됨 ${r.ok} · 안 됨 ${r.no}`)}`);
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
  say('');
  say(`  ${c.gray('지우려면')} ${c.cyan('/learned 지우기')}`);
  say('');
}

function showContext(session) {
  const b = session.breakdown();
  say('');
  rule(말('scr.context'), 70);
  say(`  ${c.bold(session.conn.model)} ${c.gray('·')} ${말('unit.tokens', { n: b.total.toLocaleString() })}`);
  say('');
  say(`  ${bar(b.used, b.total, 32)}  ${b.used.toLocaleString()} / ${b.total.toLocaleString()}  ${c.gray(`${Math.round((b.used / b.total) * 100)}%`)}`);
  say('');
  for (const r of b.rows) {
    if (!r.n) continue;
    say(`  ${c.gray(pad(r.label, 26))} ${pad(r.n.toLocaleString(), 8, 'right')}`);
  }
  say(`  ${c.gray('─'.repeat(35))}`);
  say(`  ${c.gray(pad(말('ctx.left'), 26))} ${pad(b.left.toLocaleString(), 8, 'right')}`);
  say('');
  say(`  ${c.gray(`/compact ${말('ctx.compactHint')}   /clear ${말('ctx.clearHint')}`)}`);
  /*
   * 추정이라고만 적어 두면 사람은 얼마나 믿어야 할지 모른다. 서버가 알려 준
   * 실제값에 맞춰 가고 있으면 그 사실을 적는다 — '추정' 과 '맞춰 본 추정' 은
   * 믿을 만한 정도가 다르다.
   */
  if (b.보정잰것 > 0) {
    const 차이 = Math.round((b.보정 - 1) * 100);
    say(`  ${c.gray(말('ctx.calibrated', { 부호: 차이 >= 0 ? '+' : '', 퍼센트: 차이, 번: b.보정잰것 }))}`);
  } else {
    say(`  ${c.gray(말('ctx.estimate'))}`);
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
function 바뀐것보기(session, ctx, arg = '') {
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
async function 출력상한(session, arg = '') {
  const { parseSize } = await import('./backend/ctxsize.js');
  const 말 = String(arg ?? '').trim().toLowerCase();
  const cfg = load();
  const prof = cfg.profiles.find((p) => p.id === cfg.active) ?? cfg.profiles[0];
  const 알아낸것 = session.conn.maxOut ?? null;

  if (말 === 'auto' || 말 === '자동') {
    session.conn.maxTokens = null;
    if (prof) { delete prof.maxTokens; 설정남기기(cfg); }
    say(`  ${mark.ok} 직접 정한 값을 지웠습니다.`);
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
function 모델급(session, arg = '') {
  const 값 = String(arg ?? '').trim().toLowerCase();
  const 별명 = {
    '작음': '작음', 'small': '작음', 's': '작음', '작': '작음',
    '보통': '보통', 'medium': '보통', 'm': '보통', '중': '보통',
    '큼': '큼', 'large': '큼', 'l': '큼', 'big': '큼', '대': '큼',
  };

  if (값 === 'auto' || 값 === '자동') {
    session.급정한것 = null;
    const g = session.급();
    say('');
    say(`  ${c.cyan('◈')} 모델 급을 다시 ${c.bold('스스로 잡게')} 했습니다 — 지금은 ${c.white(g.급)}`);
    say(`     ${c.gray(g.왜)}`);
    return;
  }

  if (값 && 별명[값]) {
    session.급정한것 = 별명[값];
    const v = session.급값();
    say('');
    say(`  ${c.cyan('◈')} 모델 급을 ${c.bold(별명[값])} 으로 정했습니다.`);
    say(`     ${c.gray(`한 번에 만들 파일 ${v.한번에쓸파일}개 · ${v.나눠쓰기줄}줄 넘으면 나눠 쓰기`)}`);
    say(`     ${c.gray('/grade auto 로 되돌리면 다시 스스로 잡습니다.')}`);
    return;
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
async function ctxLength(session, arg = '') {
  const { probeCtx, parseSize, fmtSize } = await import('./backend/ctxsize.js');
  const 말 = String(arg ?? '').trim().toLowerCase();
  const 지금 = session.conn.ctx ?? 0;

  const 남기기 = (값, 어디서) => {
    session.conn.ctx = 값;
    const cfg = load();
    const prof = cfg.profiles.find((p) => p.id === cfg.active) ?? cfg.profiles[0];
    if (prof) { prof.ctx = 값; save(cfg); }
    const b = session.breakdown();
    say(`  ${mark.ok} 컨텍스트 ${c.bold(값.toLocaleString())} 토큰 ${c.gray(`(${fmtSize(값)}) — ${어디서}`)}`);
    say(`     ${c.gray('지금 찬 양')} ${c.white(b.used.toLocaleString())} ${c.gray('· 남음')} ${c.white(b.left.toLocaleString())}`);
    if (prof) say(`     ${c.gray('프로필에 저장했습니다. 다음에 켤 때도 이 값입니다.')}`);
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

/** 지금 연결을 이 프로필로 갈아끼운다. 대화는 그대로 둔다. */
function 연결적용(session, p, ctx = null) {
  Object.assign(session.conn, {
    kind: p.kind, base: p.baseUrl, auth: p.auth, key: resolveKey(p), model: p.model,
    ctx: p.ctx, maxTokens: p.maxTokens ?? null,
    streaming: p.streaming, tools: p.tools, json: p.json, think: p.think,
  });
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
}

/**
 * 지금 붙어 있는 서버가 내주는 모델 목록.
 *
 * 저장된 프로필에는 등록할 때 고른 모델 하나만 있다. 그런데 서버 한 대가
 * 모델을 여럿 내주는 경우가 대부분이다 — 특히 프록시나 게이트웨이가 그렇다.
 * 그래서 서버에 직접 물어본다. 자리를 새로 여는 게 아니라 이미 열린 자리다.
 */
async function 서버모델들(conn) {
  const { req, headersFor } = await import('./backend/http.js');
  if (conn.kind === 'ollama') {
    const r = await req(`${conn.base.replace(/\/v1\/?$/, '')}/api/tags`, { timeout: 4000 });
    return (r.json?.models ?? []).map((m) => m.name ?? m.model).filter(Boolean);
  }
  /*
   * Azure 는 모델 목록이 `/models` 가 아니라 `/openai/deployments` 에 있다.
   * 여기를 안 고쳐 두면 `/model` 로 배포를 바꾸려는 순간
   * `.../deployments/gpt-4o?api-version=2024-10-21/models` 를 두드리고 404 다 —
   * 붙는 길만 고치고 바꾸는 길을 안 고치면 반쪽이다.
   */
  const { 애저인가, 애저풀기, 배포목록 } = await import('./backend/azure.js');
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
async function switchModel(session, ctx, arg = '') {
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
    const 맞는것 = (있는것 ?? []).filter((m) => m.toLowerCase().includes(말.toLowerCase()));
    if (맞는것.length === 1) return await 모델만바꾸기(session, cfg, 맞는것[0], ctx);
    if (맞는것.length > 1) {
      say(`  ${mark.warn} ${c.white(말)} ${c.gray('에 맞는 모델이 여럿입니다.')}`);
      for (const m of 맞는것.slice(0, 12)) say(`    ${c.cyan(m)}`);
      say('');
      return;
    }
    say(`  ${mark.warn} ${c.white(말)} ${c.gray('에 맞는 연결도 모델도 없습니다.')}`);
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
  연결적용(session, p, ctx);
  say(`  ${mark.ok} ${c.bold(p.name)} ${c.gray(p.model)} 로 바꿨습니다. 대화는 이어집니다.`);
  say('');
}

/**
 * 같은 서버에서 모델만 바꾼다.
 *
 * 등록된 연결이 아니어도 된다 — 서버가 내준다면 쓸 수 있어야 한다.
 * 다음에도 쓰도록 프로필로 남겨 둔다. 그래야 /model 목록에서 다시 보인다.
 */
async function 모델만바꾸기(session, cfg, 모델, ctx = null) {
  const 지금 = cfg.profiles.find((p) => p.id === cfg.active) ?? cfg.profiles[0];
  const 이미 = cfg.profiles.find((p) => p.baseUrl === session.conn.base && p.model === 모델);
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
  if (!이미) 설정남기기(upsert(cfg, p));
  else { cfg.active = p.id; 설정남기기(cfg); }
  연결적용(session, p, ctx);
  say(`  ${mark.ok} 모델을 ${c.bold(모델)} 로 바꿨습니다. ${c.gray('서버는 그대로입니다.')}`);
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
async function 길이맞추기(session, cfg, prof) {
  const { probeCtx, fmtSize, 기본값 } = await import('./backend/ctxsize.js');
  let r = null;
  try { r = await probeCtx(session.conn, { timeout: 8000 }); } catch { /* 못 물어보면 아래에서 기본값 */ }
  const 값 = r?.value ?? prof.ctx ?? 기본값;
  session.conn.ctx = 값;
  if (prof) {
    prof.ctx = 값;
    설정남기기(cfg);
  }
  say(`     ${c.gray('컨텍스트')} ${c.white(값.toLocaleString())} ${c.gray('토큰 (' + fmtSize(값) + ') — ' + (r?.source ? r.source + '에서 읽음' : '서버가 안 알려줘 기본값'))}`);
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
  try { 있는것 = await 서버모델들(session.conn); } catch { 있는것 = null; }
  s.stop('');
  if (!있는것 || !있는것.length) {
    say(`  ${mark.warn} 이 서버는 모델 목록을 내주지 않습니다.`);
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

const INIT_TEMPLATE = `# DEEL.md

이 폴더에서 일할 때 지킬 규칙을 적습니다. deel 가 매번 읽습니다.

## 이 프로젝트

- 무엇을 하는 프로젝트인지 두세 줄

## 명령

- 빌드:
- 시험:
- 실행:

## 규칙

- 고치기 전에 관련 파일을 먼저 읽는다
- (프로젝트에 맞는 규칙을 적으세요)
`;

// /work 를 인자 없이 부르면 지금 모드와 고를 수 있는 것들을 보여 준다.
function showWork(session) {
  rule('작업 모드', 70);
  for (const k of WORK_ORDER) {
    const w = WORK_MODES[k];
    const 지금 = k === (normWork(session.work) ?? WORK_DEFAULT);
    const 표 = 지금 ? c.hgreen('●') : c.gray('·');
    const 보임 = 보일이름(w.id);
    const 이름 = 지금 ? c.bold(c.white(pad(보임, 8))) : c.gray(pad(보임, 8));
    say(`  ${표} ${c.hcyan(w.glyph)} ${이름}${c.gray(pad(w.en, 14))}${c.gray(보일한줄(w.id))}`);
    say(`        ${canWrite(k) ? c.gray('파일 바꿈') : c.green('읽기만')}${c.gray('  ·  생각 ' + (w.think ?? '그대로') + '·' + w.effort + '  ·  최대 ' + w.steps + '걸음')}`);
  }
  say('');
  say(`  ${c.gray('바꾸려면')} ${c.cyan('/plan')} ${c.cyan('/code')} ${c.cyan('/debug')} ${c.gray('…  또는')} ${c.cyan('Ctrl+O')} ${c.gray('로 차례로')}`);
  say(`  ${c.gray('이건 승인 정책(')}${c.cyan('/mode')}${c.gray(')과 다른 축입니다 — 무엇을 하느냐 / 얼마나 물어보냐.')}`);
  say('');
}
