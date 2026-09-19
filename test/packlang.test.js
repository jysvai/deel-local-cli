/**
 * 심사 서류가 화면 말을 따라가는가 — 그리고 두 판이 어긋나지 않는가.
 *
 * ── 왜 이 검사가 있나 ───────────────────────────────────────────────────
 *
 * `deel audit`·`deel sbom`·`deel pack` 은 여태 **언제나 한국어**로 나왔다.
 * 말을 정하는 자리가 repl.js 하나뿐이라, 대화를 안 거치는 이 세 명령은
 * 말을 정할 기회 자체가 없었다. /lang en 으로 쓰던 사람이 심사에 낼 서류를
 * 뽑으면 한글 문서가 나왔다는 뜻이다 — 그 서류는 낼 수가 없다.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────────────
 *
 * 1. 한국어는 **하나도 안 바뀌었나.** 이게 먼저다. 새 길을 내다가 원래
 *    길을 부수면, 여태 쓰던 사람 전부가 손해를 본다.
 * 2. 영어로 켜면 서류에 한글이 없나. 절반만 옮긴 서류는 안 옮긴 것보다 나쁘다.
 * 3. **두 판의 사실이 같나.** 서류를 갈라 두면 한쪽만 고치는 날이 온다.
 *    글은 달라도 되지만 숫자가 달라지면 그건 서류가 거짓말을 하는 것이다.
 */
import { audit, reviewSheet, packSelf, repoRoot } from '../src/pack/selfpack.js';
import { sbom, 심사명세, 명세요약 } from '../src/pack/sbom.js';
import { 언어정하기, 언어 } from '../src/i18n/index.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 한글있나 = (s) => /[가-힣]/.test(String(s ?? ''));

/*
 * 소스에서 **따온 줄**은 빼고 센다.
 *
 * 심사서 3절은 네트워크·명령 호출 자리를 소스에서 그대로 떠다 붙인다. 이
 * 저장소는 함수 이름·변수 이름이 한글이라 그 줄에 한글이 있는 것이 당연하다.
 * 그걸 영어로 고치면 **증거가 아니게 된다** — 심사서에서 제일 하면 안 되는
 * 일이다. 그래서 「소스 파일:줄번호」 로 시작하는 줄은 세지 않는다.
 */
const 따온줄인가 = (l) => /^\s+\S+\.js:\d+\s/.test(l) || /\s[0-9a-f]{64}\s*$/.test(l);
const 한글줄 = (s) => String(s ?? '').split('\n').filter((l) => 한글있나(l) && !따온줄인가(l));

/**
 * 서류가 **제 말로 하는 부분**만 남긴다.
 *
 * 실린 파일 목록과 소스 자리는 저장소에서 그대로 떠온 것이다. 배포에 실리는
 * 파일 이름은 2.0.0 부터 영어지만, 소스 자리 줄에는 한글 식별자가 그대로 실리고
 * 앞으로 한글 이름 파일이 다시 들어올 수도 있다. 떠온 것을 옮기면 **그 경로로는
 * 파일을 못 찾는다.** 서류가 거짓이 되는 자리라, 여기서는 세지 않는다.
 */
function 제말만(명세) {
  const 벗기기 = (v) => {
    if (Array.isArray(v)) return v.map(벗기기);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'files' || k === 'source' || k === '파일' || k === '소스') continue;
      out[k] = 벗기기(x);
    }
    return out;
  };
  return JSON.stringify(벗기기(명세));
}

const at = new Date('2026-01-02T03:04:05Z');
const stamp = '2026-01-02 03:04:05';
const a = audit(repoRoot());

trace('1-한국어는-그대로');

{
  check('기본은 한국어다', 언어() === 'ko', 언어());
  const 심사서 = reviewSheet(a, stamp);
  check('★ 한국어 심사서는 여전히 한국어', /사내 반입 심사 자료/.test(심사서));
  check('★ 절 이름이 그대로', /1\. 외부 의존성/.test(심사서) && /6\. 담긴 파일/.test(심사서));
  check('★ 어긋내기 절이 심사서에 있다', /5\. 검사가 무엇을 지키는가/.test(심사서)
    && /test\/mutants\.json/.test(심사서));
  const 명세 = 심사명세(a, { at });
  check('★ 한국어 열쇠가 그대로', 명세.만든것 === a.name && !!명세.통신 && !!명세.감사기록);
  check('★ 요약도 한국어', /SBOM 부품/.test(명세요약(명세)));
  check('SBOM 설명이 한국어', 한글있나(sbom(a, { at }).metadata.component.description));
}

trace('2-영어로-켜면-서류도-영어');

{
  언어정하기('en');
  const 심사서 = reviewSheet(a, stamp);

  /*
   * ★ 한 줄도 한글이 없어야 한다.
   *
   * 심사 서류에 한글 한 줄이 남으면 그 자리가 통째로 미완성으로 읽힌다.
   * 「몇 개나 옮겼나」 가 아니라 「하나라도 남았나」 를 재는 이유다.
   */
  check('★ 영어 심사서에 한글이 없다', 한글줄(심사서).length === 0,
    한글줄(심사서).slice(0, 2).join(' | '));
  check('영어 절 이름이 선다', /1\. Third-party dependencies/.test(심사서)
    && /6\. \d+ files shipped/.test(심사서));
  check('영어 심사서에도 어긋내기 절이 있다', /5\. What the tests actually guard/.test(심사서)
    && /test\/mutants\.json/.test(심사서));
  check('나가는 길 네 갈래도 옮겼다', /Four separate outbound lanes/.test(심사서));

  /*
   * ★★ 검증 문구에 **손으로 적은 수**가 없어야 한다.
   *
   * 이 서류를 읽는 사람은 사내 반입 심사관이고, 이 서류가 파는 것은
   * 「적힌 것을 확인할 수 있다」 이다. 그런데 여기 「123항목이 확인합니다」
   * 가 한 판 동안 리터럴로 박혀 있었다. 그 세 검사는 실제로 70 + 56 + 60 =
   * 186항목이었다. 63만큼 낡은 채로, 아무 검사도 안 걸리는 자리에서.
   *
   * 집안 규칙 6은 「절대 숫자를 지어내지 않는다」 이다. 그 규칙을 파는 문서가
   * 그 규칙을 어기고 있었다는 것이 이 검사가 생긴 까닭이다.
   *
   * 「그때그때 세어서 적자」 가 아니라 **아예 못 적게** 한다 — 세어서 적으면
   * 그 수는 다시 낡는다. 수는 검사 출력에 있고, 서류는 그리 가리키기만 한다.
   */
  const 지어낸수 = (글) => 글.split('\n').filter((l) => (
    /\(검증:[^)]*\d/.test(l) || /\(Verified by[^)]*\d+\s*assert/i.test(l)
  ));
  check('★★ 영어 심사서의 검증 문구에 손으로 적은 수가 없다',
    지어낸수(심사서).length === 0, 지어낸수(심사서).join(' | '));
  const 한글심사서 = reviewSheet(a, stamp, { lang: 'ko' });
  check('★★ 한국어 심사서도 마찬가지',
    지어낸수(한글심사서).length === 0, 지어낸수(한글심사서).join(' | '));

  const 명세 = 심사명세(a, { at });
  check('★ 열쇠 이름까지 영어', !!명세.egress && !!명세.auditLog && 명세.만든것 === undefined);
  /*
   * ★ 명세 쪽은 소스를 안 따온다 — 파일:줄번호만 싣는다. 그래서 여기는
   *   한글이 하나도 없어야 맞다. 이 검사가 잠금장치 문구(보관방식)까지 본다.
   */
  check('★ 값에도 한글이 없다', !한글있나(제말만(명세)),
    (제말만(명세).match(/[가-힣][^"]*/) ?? [''])[0].slice(0, 40));
  check('SBOM 설명도 영어', !한글있나(sbom(a, { at }).metadata.component.description));

  /*
   * ★ SBOM 은 **설명 한 칸만** 옮기면 되는 문서가 아니다.
   *
   * 스캐너에 먹이는 파일이라도 담당자는 metadata 의 속성 칸을 눈으로 읽는다.
   * 여태 영어로 뽑은 SBOM 에 한글이 정확히 한 자리 남아 있었다 —
   * deel:provenance 의 「npm 신뢰 배포」. 설명만 갈라 둔 탓에 아무 검사도
   * 그 자리를 안 봤다 (8회차 판정).
   *
   * 부품 목록(components)은 저장소에서 떠온 파일 이름·해시라 뺀다. 떠온 것을
   * 옮기면 그 경로로는 파일을 못 찾는다 — 제말만() 과 같은 규칙이다.
   */
  const SBOM제말 = (b) => JSON.stringify({ ...b, components: undefined });
  const 영어SBOM = SBOM제말(sbom(a, { at }));
  check('★ 영어 SBOM 값 어디에도 한글이 없다', !한글있나(영어SBOM),
    (영어SBOM.match(/[^"]*[가-힣][^"]*/) ?? [''])[0].slice(0, 60));
  check('★ 한국어 SBOM 은 그대로 한국어', 한글있나(SBOM제말(sbom(a, { at, lang: 'ko' }))));

  /*
   * ★ 요약은 **명세를 보고** 말을 고른다.
   *
   * 여기서 언어() 를 또 물으면, 명세를 만든 뒤 말이 바뀐 자리에서 요약만
   * 딴 말이 된다 — 읽을 수 없는 열쇠에서 값을 꺼내려다 전부 0 으로 찍힌다.
   */
  const 요약 = 명세요약(명세);
  check('★ 영어 명세에는 영어 요약', /SBOM components/.test(요약), 요약.split('\n')[0]);
  check('★ 요약의 숫자가 0 이 아니다', /SBOM components\s+[1-9]/.test(요약), 요약.split('\n')[0]);
  const 한국어명세 = 심사명세(a, { at, lang: 'ko' });
  check('★ 한국어 명세에는 한국어 요약', /SBOM 부품/.test(명세요약(한국어명세)));

  언어정하기('ko');
}

trace('3-두-판의-사실이-같다');

{
  const ko = 심사명세(a, { at, lang: 'ko' });
  const en = 심사명세(a, { at, lang: 'en' });

  check('★ 실린 파일 수가 같다', ko.파일.length === en.files.length,
    `${ko.파일.length} · ${en.files.length}`);
  check('★ 나가는 길 갈래 수가 같다', ko.통신.나가는길.length === en.egress.lanes.length);
  check('★ 여는 포트 수가 같다', ko.통신.여는포트.개수 === en.egress.listeningPorts.count);
  check('★ 바깥 명령 수가 같다', ko.통신.바깥명령.개수 === en.egress.externalCommands.count);
  check('★ 감사기록 종류 수가 같다', ko.감사기록.종류.length === en.auditLog.kinds.length);
  check('★ 열쇠 보관 방법 수가 같다', ko.열쇠보관.방식.length === en.keyStorage.methods.length);
  check('★ 잠글 때 닫히는 것이 같은 수', ko.통신.offline일때.length === en.egress.whenOffline.length);
  check('★ 안 남기는 것도 같은 수', ko.안남기는것 === undefined
    ? ko.감사기록.안남기는것.length === en.auditLog.neverRecorded.length
    : false);
  check('판·라이선스가 같다', ko.판 === en.version && ko.라이선스 === en.license);

  // 심사서도 실린 파일 수가 같아야 한다. 하나라도 빠지면 해시 대조가 안 맞는다.
  const koL = reviewSheet(a, stamp, { lang: 'ko' }).split('\n');
  const enL = reviewSheet(a, stamp, { lang: 'en' }).split('\n');
  const 해시줄 = (L) => L.filter((l) => /\s[0-9a-f]{64}\s*$/.test(l)).length;
  check('★ 심사서에 적힌 파일 수가 같다', 해시줄(koL) === 해시줄(enL) && 해시줄(koL) === a.files.length,
    `${해시줄(koL)} · ${해시줄(enL)} · ${a.files.length}`);
  check('★ 절 수가 같다',
    koL.filter((l) => /^\d\. /.test(l)).length === enL.filter((l) => /^\d\. /.test(l)).length);

  // ★ (6회차 자기묶음6am-b S4) 심사서의 실행 안내가 zip 모양과 맞아야 한다. packSelf 는 소스를
  // deel/ 아래에 담는데 심사서는 「압축을 풀고 node bin/deel.js」 라 적어, 담당자가 안내대로 치면
  // 파일이 없었다. 같은 zip 의 읽어주세요.txt 는 node deel/bin/deel.js 로 맞게 적는다.
  for (const [말, L] of [['ko', koL], ['en', enL]]) {
    const 실행줄 = L.filter((l) => /node \S*bin\/deel\.js/.test(l));
    check(`★ (6회차 S4) ${말}: 심사서의 실행 안내가 zip 안 자리(deel/bin/deel.js)를 가리킨다`,
      실행줄.length > 0 && 실행줄.every((l) => /node deel\/bin\/deel\.js/.test(l)), 실행줄.join(' | '));
  }
}

trace('3b-심사서가-담긴것을-사실대로-적나');

/*
 * ── 심사서 4절이 거짓말을 하고 있었다 (막판-바깥) ────────────────────────
 *
 * 「이 묶음에는 스킬도 플러그인도 들어 있지 않습니다.」 / "This package contains
 * no skills and no plugins." 라고 적는데, `src/skills/builtin/` 의 방법론
 * SKILL.md 가 그대로 실려 나간다 — test/no-bundle.test.js 가 「내 방법론은 제대로
 * 실린다」 고 **못 박고 있는** 바로 그 파일들이다. 두 검사가 반대 방향으로 초록이었다.
 *
 * 이 종이는 보안 심사에 그대로 내는 것이라, 틀린 한 줄이 문서 오류가 아니라 심사
 * 자료 오류다. 심사자가 zip 을 풀어 SKILL.md 를 발견하면 나머지 숫자도 다 못 믿을
 * 것이 된다 — 이 파일 머리말이 「손으로 적은 값이 아닙니다」 로 파는 그 믿음이다.
 *
 * 담긴 것과 적힌 것을 여기서 맞대 둔다. 방법론이 하나 늘거나 줄면 여기가 빨개진다.
 */
{
  const 실린방법론 = a.files.filter((f) => /^src\/skills\/builtin\/.+\/SKILL\.md$/.test(f.path));
  check('잴 것이 있다 — 묶음에 방법론이 실제로 실린다', 실린방법론.length > 0, `${실린방법론.length}개`);

  const ko심사서 = reviewSheet(a, stamp, { lang: 'ko' });
  const en심사서 = reviewSheet(a, stamp, { lang: 'en' });
  check('★ ko: 「스킬이 안 들어 있다」 고 하지 않는다',
    !/스킬도 플러그인도 들어 있지 않습니다/.test(ko심사서), '');
  check('★ en: same claim is gone',
    !/contains no skills/i.test(en심사서), '');
  check('★ ko: 실린 방법론 수를 적는다', new RegExp(`방법론 ${실린방법론.length}개`).test(ko심사서),
    (ko심사서.split('\n').find((l) => /방법론/.test(l)) ?? '(없음)').trim());
  check('★ en: says how many are inside', new RegExp(`${실린방법론.length} built-in`).test(en심사서),
    (en심사서.split('\n').find((l) => /built-in/.test(l)) ?? '(none)').trim());
  // 「남의 스킬·플러그인은 안 담는다」 는 그대로 참이다 — 그 말까지 지우면 이번엔 덜 말하게 된다.
  check('  남의 것은 안 담는다는 말은 남아 있다 (ko)', /남의 스킬|~\/\.claude/.test(ko심사서), '');
  check('  same for en', /other people|~\/\.claude/i.test(en심사서), '');
}

trace('4-묶음-안의-이름도-같이-옮긴다');

{
  /*
   * ★ 안이 영어인데 이름이 한글이면 안 된다.
   *
   * 받은 사람은 열기 전에 무엇인지 모르고, 메일에 첨부하면 이름이 깨져서
   * 온다. 서류의 이름은 서류의 일부다.
   */
  const 자리 = mkdtempSync(join(tmpdir(), 'deel-packlang-'));
  try {
    for (const [lang, 있어야할것, 없어야할것] of [
      ['ko', ['반입심사서.txt', '심사명세.json', '읽어주세요.txt'], ['import-review.txt']],
      ['en', ['import-review.txt', 'audit-spec.json', 'READ-ME-FIRST.txt'], ['반입심사서.txt']],
    ]) {
      const 파일 = join(자리, `${lang}.zip`);
      packSelf(파일, { at, lang });
      const 글 = readFileSync(파일, 'latin1');
      for (const n of 있어야할것) {
        check(`★ ${lang}: ${n} 이 들어 있다`, 글.includes(Buffer.from(n, 'utf8').toString('latin1')));
      }
      for (const n of 없어야할것) {
        check(`${lang}: ${n} 은 없다`, !글.includes(Buffer.from(n, 'utf8').toString('latin1')));
      }
      // sbom.cdx.json 은 이름이 규격이라 두 말에서 같아야 한다.
      check(`${lang}: sbom.cdx.json 은 이름이 안 바뀐다`, 글.includes('sbom.cdx.json'));
    }
  } finally {
    rmSync(자리, { recursive: true, force: true });
  }
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n심사 서류 말 검사  ${D}(화면 말을 따라가는가 · 두 판이 어긋나지 않는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
