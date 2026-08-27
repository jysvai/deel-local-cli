// 자율 실행의 울타리.
// 승인 프롬프트를 안 쓰는 대신 (1) 작업 범위 밖은 못 건드리고
// (2) 되돌릴 수 없는 명령만 막는다. 나머지는 전부 통과시킨다.
import { resolve, relative, isAbsolute, sep, dirname, basename } from 'node:path';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { 내부살림 } from '../tools/fsutil.js';

export class ScopeError extends Error {}
export class BlockedError extends Error {}

/** 이 절대경로가 base 밖인가. */
function 밖(base, abs) {
  const rel = relative(base, abs);
  return rel.startsWith('..' + sep) || rel === '..' || (isAbsolute(rel) && rel !== '');
}

/**
 * 링크를 따라간 진짜 자리.
 *
 * 윈도우에는 정션(junction)이 흔하다. 작업 폴더 안에 바깥을 가리키는 정션이
 * 하나 있으면, 경로 글자만 봐서는 범위 안인데 실제로 닿는 곳은 바깥이다.
 * 글자로만 검사하던 울타리가 그 한 칸으로 통째로 열린다.
 *
 * 아직 없는 파일도 검사해야 한다 — 새로 쓰는 자리가 그렇다. 그래서 있는
 * 자리가 나올 때까지 위로 올라가 거기서 링크를 풀고, 남은 이름을 다시 붙인다.
 */
function 진짜자리(p) {
  const 남은 = [];
  let cur = p;
  for (let i = 0; i < 64; i++) {
    try {
      const r = realpathSync(cur);
      return 남은.length ? resolve(r, ...남은) : r;
    } catch { /* 아직 없는 자리 — 한 칸 위로 */ }
    const 위 = dirname(cur);
    if (위 === cur) return p;      // 뿌리까지 갔는데도 없다. 글자 그대로 본다.
    남은.unshift(basename(cur));
    cur = 위;
  }
  return p;
}

// 작업 범위 — deel 를 띄운 폴더. 그 밖은 읽기도 쓰기도 막는다.
export function makeScope(root) {
  const base = resolve(root);
  // 뿌리 자신도 링크 아래 있을 수 있다(맥의 /tmp 가 그렇다). 그래서 양쪽 다 푼 값으로 견준다.
  let _진짜뿌리 = null;
  const 진짜뿌리 = () => (_진짜뿌리 ??= 진짜자리(base));
  return {
    root: base,
    resolve(p) {
      if (!p || typeof p !== 'string') throw new ScopeError('경로가 비었습니다');
      const abs = isAbsolute(p) ? resolve(p) : resolve(base, p);
      if (밖(base, abs)) throw new ScopeError(`작업 범위 밖입니다: ${p}\n  범위: ${base}`);
      // 글자로는 안인데 링크를 따라가면 밖인 자리. 정션 하나로 울타리가 열린다.
      const 진짜 = 진짜자리(abs);
      if (진짜 !== abs && 밖(진짜뿌리(), 진짜)) {
        throw new ScopeError(`작업 범위 밖입니다 (링크가 밖을 가리킵니다): ${p}\n  실제 자리: ${진짜}\n  범위: ${base}`);
      }
      return abs;
    },
    show(abs) {
      const rel = relative(base, abs);
      return rel === '' ? '.' : rel.split(sep).join('/');
    },
  };
}

// 되돌릴 수 없는 것만 막는다. 목록이 길어지면 도구가 쓸모없어진다.
const BLOCKED = [
  { re: /\brm\s+(-[a-z]*[rR][a-z]*f|-[a-z]*f[a-z]*[rR])\b[^|;&]*\s(\/|~|\$HOME)\s*$/i, why: '뿌리 폴더를 통째로 지우려 합니다' },
  { re: /\b(mkfs|fdisk|diskpart)\b/i, why: '디스크를 초기화하는 명령입니다' },
  { re: /\bformat\s+[a-z]:/i, why: '드라이브를 포맷하는 명령입니다' },
  // 윈도우 짝을 빠뜨리면 안 된다 — deel 은 윈도우에서 주로 돈다.
  //
  // 옛 규칙은 스위치가 **차례대로** 오고 끝에 `\*` 가 붙은 모양만 봤다.
  // 그래서 `del /f /s /q C:\` 와 `rd /q /s C:\` 가 그대로 새어 나갔다.
  // 스위치는 아무 차례로나 오므로 차례를 안 따진다.
  { re: /\b(rd|rmdir)\b[^|;&]*\s\/s\b/i, why: '폴더를 통째로 지웁니다 — 정션이 있으면 원본까지 딸려 갑니다' },
  { re: /\bdel\b[^|;&]*\s\/[sq]\b[^|;&]*(\\\*|\s[a-z]:\\?\s*$)/i, why: '하위 폴더까지 전부 지웁니다' },
  // 파워셸도 같은 일을 한다. 드라이브 뿌리나 집 폴더를 통째로 미는 것만 본다 —
  // 폴더 하나 지우는 평범한 Remove-Item 까지 막으면 도구를 못 쓴다.
  // 가운데 `(-?[a-z]*\s*)*` 는 양쪽 다 빈 문자열을 허용해서, 안 맞는 긴 입력이
  // 들어오면 되돌아가는 경우의 수가 기하급수로 늘어난다 — guard 검사 자체가
  // 멈춰 버린다(ReDoS). 각 겹이 최소 한 글자는 먹게 고쳐서 그 길을 막는다.
  {
    re: /Remove-Item\b[^|;&]*\s-(Recurse|r)\b[^|;&]*\s(?:-?[a-z]+\s+)*([a-z]:\\?|~|\$HOME|\$env:USERPROFILE)\s*$/i,
    why: '드라이브나 집 폴더를 통째로 지웁니다',
  },
  { re: /git\s+push\b[^|;&]*--force(?!-with-lease)/i, why: '원격 이력을 덮어씁니다 (--force-with-lease 를 쓰세요)' },
  // 낱말만 보면 안 된다. `node scripts/shutdown.js` 나 `npm run reboot` 이
  // '시스템을 끕니다' 로 막히고 감사기록에까지 남았다. 명령의 **첫 낱말**일 때만 본다.
  { re: /(^|[|;&]\s*)(sudo\s+)?(shutdown|reboot|halt|poweroff)\b/i, why: '시스템을 끕니다' },
  // 포크 폭탄.
  //
  // 껐다 켜면 기계는 돌아오니 '되돌릴 수 없는 것' 은 아니다. 그런데 되돌아오지
  // 않는 것이 하나 있다 — **아직 안 적은 것들.** 기계가 굳으면 열어 둔 것을
  // 저장할 수도, 하던 대화를 끝낼 수도 없다. 그래서 목록에 넣는다.
  //
  // 이름은 아무거나 될 수 있으니(`:` 든 `bomb` 든) 이름 자체를 보지 않고 **모양**을
  // 본다: 함수를 만들고, 그 안에서 **저를 불러 곧바로 파이프나 뒤로 보내기에**
  // 물리고, 밖에서 그 이름을 부른다. 뒷갈이(\2)로 같은 이름인지까지 본다.
  //
  // '저를 부른 **바로 뒤**가 | 나 &' 인 것이 열쇠다. 그냥 '이름이 몸 안에 있고
  // & 도 있다' 로 보면 `up(){ docker compose up -d & }; up` 같은 평범한 함수가
  // 걸린다 — 거기서는 up 뒤에 `-d` 가 온다.
  //
  // 이름 앞뒤로 낱말 경계도 본다. 그래야 `tee -a out.log` 의 log 나
  // `deploy_app` 의 deploy 를 저를 부르는 것으로 잘못 읽지 않는다.
  // 앞자리에 따옴표와 여는 괄호도 넣는다. 안 넣으면 `bash -c ":(){ :|:& };:"` 처럼
  // 한 겹 싸는 것만으로 그대로 새어 나간다.
  {
    re: /(^|[|;&\s"'(])([\w.:]{1,16})\s*\(\s*\)\s*\{[^}]*(?<![\w.])\2(?![\w.])\s*[|&][^}]*\}\s*;?\s*(?<![\w.])\2(?![\w.])/,
    why: '스스로를 끝없이 불려 기계를 멈춰 세웁니다 (포크 폭탄)',
  },
  // 같은 것을 한 줄로 적는 오래된 방법. 이 모양으로 쓸 다른 일이 없다.
  { re: /\bfork\s+while\s+fork\b/i, why: '스스로를 끝없이 불려 기계를 멈춰 세웁니다 (포크 폭탄)' },
  { re: /curl[^|]*\|\s*(ba)?sh/i, why: '받은 스크립트를 그대로 실행합니다' },
  { re: /\biwr\b[^|]*\|\s*iex\b/i, why: '받은 스크립트를 그대로 실행합니다' },
];

export function checkCommand(cmd) {
  const s = String(cmd);
  for (const b of BLOCKED) {
    if (b.re.test(s)) throw new BlockedError(`${b.why}\n  막힌 명령: ${s.slice(0, 120)}`);
  }
  return true;
}

/**
 * 명령줄에 적힌 경로들을 뽑아 울타리 안인지 본다.
 *
 * 왜 필요한가:
 *   Read 도구는 .deel/config.json 을 막는다. 게이트웨이 열쇠가 그 안에 있기
 *   때문이다. 그런데 Bash 로는 `type .deel\config.json` 한 줄이면 그냥 읽혔다.
 *   읽힌 열쇠는 대화에 실려 게이트웨이로 나가고, 세션 기록으로 디스크에도 남는다.
 *   열쇠를 그 열쇠의 주인에게 보내는 셈이다.
 *
 *   범위도 마찬가지였다. 시스템 프롬프트는 '이 폴더 밖은 읽지도 쓰지도 못한다'
 *   고 말하는데, Bash 한 줄로 `cat ../../비밀` 이 됐다. 말이 거짓이 되면
 *   모델은 그 말을 안 믿고, 사용자는 울타리가 있다고 믿는다. 둘 다 나쁘다.
 *
 * 어떻게 고르나:
 *   경로처럼 보이는 낱말만 본다(/ 나 \ 가 있거나, ~ 또는 드라이브로 시작).
 *   그리고 **밖으로 나가는 것만** 막는다. 안에서 도는 것은 전부 통과다.
 *   그래서 sed 의 's/a/b/' 나 npm 의 some/pkg 같은 것은 걸리지 않는다 —
 *   글자로는 경로처럼 보여도 풀어 보면 폴더 안이기 때문이다.
 */
export function checkPaths(cmd, scope) {
  if (!scope) return true;
  for (const t of 경로낱말(String(cmd))) {
    let abs;
    try { abs = scope.resolve(t); }
    catch (e) {
      if (e instanceof ScopeError) {
        throw new ScopeError(`${e.message}\n  이 명령 안에 있습니다: ${String(cmd).slice(0, 120)}`);
      }
      continue;
    }
    const 이유 = 내부살림(abs);
    if (이유) throw new BlockedError(`${이유}\n  이 명령 안에 있습니다: ${String(cmd).slice(0, 120)}`);
  }
  return true;
}

// 셸이 알아서 풀어 주는 자리표. 우리도 같이 풀어야 실제로 닿는 곳을 본다.
function 자리표풀기(s) {
  return s
    .replace(/^~(?=[/\\]|$)/, homedir())
    .replace(/\$\{?HOME\}?|%USERPROFILE%|\$\{?USERPROFILE\}?/gi, homedir());
}

/** 명령줄에서 경로처럼 보이는 낱말만 골라낸다. */
export function 경로낱말(cmd) {
  const out = [];
  // 따옴표 안은 통째로 한 낱말, 밖은 공백과 셸 기호로 자른다.
  const re = /"([^"]*)"|'([^']*)'|[^\s|;&<>()]+/g;
  let m;
  while ((m = re.exec(cmd))) {
    let t = m[1] ?? m[2] ?? m[0];
    if (!t) continue;
    if (t.startsWith('-')) continue;                 // 옵션
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) continue; // 주소(http://, file:// …)
    // 리디렉션이 붙어 온 것(>out.txt)은 기호를 떼고 본다.
    t = t.replace(/^[<>]+/, '');
    if (!t) continue;
    const 풀린 = 자리표풀기(t);
    const 경로같나 = 풀린.includes('/') || 풀린.includes('\\') || /^[a-zA-Z]:$/.test(풀린);
    if (!경로같나) continue;
    // 남은 자리표가 있으면(우리가 못 푼 것) 어디로 갈지 모르니 검사하지 않는다.
    // 여기서 억지로 풀면 엉뚱한 자리를 막게 된다.
    if (/[$%]/.test(풀린)) continue;
    out.push(풀린);
  }
  return out;
}

/**
 * 변경성 동작은 실패해도 다시 실행하지 않는다 — 두 번 실행되면 사고다. (RPA 에서 얻은 원칙)
 *
 * 이것도 **첫 낱말**일 때만 본다. 전에는 아무 데나 있으면 걸렸다.
 * 그래서 `node scripts/copy.js` 나 `grep -r "del" src/` 가 '변경성 명령' 이 되어
 * 두 번째 시도가 막혔다. 진짜로 파일을 옮기는 명령과 이름만 스친 것은 다르다.
 */
const MUTATING = /(^|[|;&]\s*)(sudo\s+)?(git\s+(commit|push|merge|rebase|reset)|npm\s+(publish|install)|pip\s+install|mv|cp|del|rm|move|copy|curl\s+-X\s*(POST|PUT|DELETE|PATCH))\b/i;

export function isMutating(cmd) {
  return MUTATING.test(String(cmd));
}
