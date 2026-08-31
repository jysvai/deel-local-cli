// 자율 실행의 울타리.
// 승인 프롬프트를 안 쓰는 대신 (1) 작업 범위 밖은 못 건드리고
// (2) 되돌릴 수 없는 명령만 막는다. 나머지는 전부 통과시킨다.
import { resolve, relative, isAbsolute, sep, dirname, basename } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { 내부살림 } from '../tools/fsutil.js';

export class ScopeError extends Error {}
export class BlockedError extends Error {}

/*
 * ── 같은 이름이 두 가지 모양으로 온다 (맥의 한글 폴더) ──────────────────
 *
 * 맥은 파일 이름을 **자모 분리형(NFD)** 으로 저장한다. `챗` 은 디스크에
 * `ᄎ + ᅢ + ᆺ` 세 글자로 들어가 있다. 반면 모델이 글로 쓰는 한글은 합쳐진
 * 모양(NFC)이다. 눈에는 똑같이 보이는데 **자바스크립트 문자열로는 다르다.**
 *
 *   '오후'.length          → 2   (NFC, 모델이 쓴 것)
 *   '오후'.normalize('NFD') → 4   (맥이 준 것)
 *
 * 울타리는 이 둘을 글자로만 견줬다. 그래서 한글이 든 폴더에서 deel 을 켜면
 * **제 작업 폴더 안의 파일이 전부 범위 밖으로 튕겼다.** 실제로 이런 화면이
 * 나왔다 — 뿌리 자신을 가리키는데도:
 *
 *   ❉ Outline(**\/*.py)
 *     └ 작업 범위 밖입니다: /Users/me/.Trash/Archive 오후 3.05.41
 *
 * 그러고는 같은 호출이 다음 판에 그냥 됐다. 어느 쪽 모양으로 오느냐에 따라
 * 갈렸기 때문이다. 사람 눈에는 "됐다 안 됐다 하는" 것으로만 보인다.
 *
 * **견줄 때만** 한 모양으로 맞춘다. 돌려주는 경로는 원래 것 그대로 둔다 —
 * 리눅스 파일시스템은 바이트를 그대로 보므로 NFC 와 NFD 가 **다른 파일**이고,
 * 거기서 바꿔 버리면 멀쩡한 파일을 못 찾게 된다. 맥은 찾을 때 두 모양을
 * 같은 것으로 보므로 원래 것을 그대로 넘겨도 열린다.
 */
const 같은꼴 = (s) => String(s).normalize('NFC');

/** 이 절대경로가 base 밖인가. */
function 밖(base, abs) {
  const rel = relative(같은꼴(base), 같은꼴(abs));
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

/** `/c/Users/…` → `C:/Users/…`. 윈도우에서만, 드라이브 글자 한 자짜리 첫 칸만. */
export function MSYS풀기(p) {
  if (process.platform !== 'win32') return p;
  const m = /^\/([a-zA-Z])(\/|$)/.exec(p);
  return m ? `${m[1].toUpperCase()}:${p.slice(2) || '/'}` : p;
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
      // Git Bash 꼴 절대 경로(/c/Users/…)는 윈도우에서 C:\Users\… 다. 안 풀면 지금
      // 드라이브 밑의 \c\Users\… 로 읽혀, 안에 있는 파일이 '범위 밖' 으로 막힌다.
      const 경로 = MSYS풀기(p);
      const abs = isAbsolute(경로) ? resolve(경로) : resolve(base, 경로);
      if (밖(base, abs)) throw new ScopeError(`작업 범위 밖입니다: ${p}\n  범위: ${base}`);
      // 글자로는 안인데 링크를 따라가면 밖인 자리. 정션 하나로 울타리가 열린다.
      //
      // 여기 견주기도 한 모양으로 맞춘다. 맥에서 realpathSync 는 디스크에 있는
      // 자모 분리형을 돌려주므로, 안 맞추면 링크가 하나도 없는 평범한 한글
      // 폴더가 매번 '링크를 따라간 자리가 다르다' 로 잡힌다.
      const 진짜 = 진짜자리(abs);
      if (같은꼴(진짜) !== 같은꼴(abs) && 밖(진짜뿌리(), 진짜)) {
        throw new ScopeError(`작업 범위 밖입니다 (링크가 밖을 가리킵니다): ${p}\n  실제 자리: ${진짜}\n  범위: ${base}`);
      }
      return abs;
    },
    show(abs) {
      // 여기도 맞춰야 한다. 안 맞추면 제 폴더 안의 파일이
      // `../../../Users/me/Archive 오후/main.py` 처럼 보인다.
      const rel = relative(같은꼴(base), 같은꼴(abs));
      return rel === '' ? '.' : rel.split(sep).join('/');
    },
  };
}

// 되돌릴 수 없는 것만 막는다. 목록이 길어지면 도구가 쓸모없어진다.
const BLOCKED = [
  // `/c` · `/c/` 는 Git Bash 에서 C:\ 다 — 윈도우에서 bash 를 쓰게 되면서 닿게 된 자리.
  { re: /\brm\s+(-[a-z]*[rR][a-z]*f|-[a-z]*f[a-z]*[rR])\b[^|;&]*\s(\/|\/[a-z]\/?|~|\$HOME)\s*$/i, why: '뿌리 폴더를 통째로 지우려 합니다' },
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
    // 자료가 아닌 자리는 울타리를 안 묻는다 (봐주는자리 머리말).
    if (봐주는자리(t)) continue;
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

/**
 * 이 낱말은 경로가 아니라 **코드 조각**인가.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *
 * 여기 오는 것은 셸 명령줄인데, 모델은 그 안에 자바스크립트를 통째로 넣는다
 * (`node -e "…"` · `node - <<'NODE'`). 그러면 코드 안의 슬래시가 전부 경로로
 * 보인다. 실제로 이렇게 막혔다 —
 *
 *   ▶ Bash(node - <<'NODE' const fs=require('fs'); …)
 *     └ 막힘 — 작업 범위 밖입니다: /data:image\/[\s\S]*?base64,[^"']+/g,'data:…'
 *   ▶ Bash(node -e "…")
 *     └ 막힘 — 작업 범위 밖입니다: /div
 *
 * 앞엣것은 정규식 리터럴이고 뒤엣것은 `</div>` 가 잘려 온 것이다. 둘 다 파일과
 * 아무 상관이 없는데 명령 **전체**가 거절됐다. 모델은 왜 막혔는지 모르니
 * 따옴표만 바꿔 가며 대여섯 번을 다시 시도했다 — 한 요청이 몇 분씩 길어진 것의
 * 큰 몫이 이것이었다.
 *
 * ── 울타리를 얼마나 무르게 하나 ─────────────────────────────────────────
 *
 * 여기서 넘긴 낱말은 검사를 안 받는다. 그래서 넘기는 기준을 좁게 잡는다 —
 * **실수로 밖을 건드리는** 경로는 `/Users/남/것` 처럼 평범하게 생겼지, 정규식
 * 메타문자나 따옴표를 달고 오지 않는다. 반대로 일부러 뚫으려는 사람은 이
 * 검사가 있든 없든 `cd ..` 나 `$(…)` 로 지나간다 — 이건 원래 사고를 막는
 * 턱이지 봉인이 아니다(파일 도구 쪽 울타리는 그대로다).
 *
 * 글로브(`*` `?`)는 일부러 안 넘긴다. `rm /Users/남/*` 은 진짜 경로이고,
 * 그건 계속 걸려야 한다.
 */
export function 코드조각인가(낱말) {
  // 따옴표가 낱말 **안**에 섞였다 = 코드를 가운데서 자른 것이다.
  // 파일 이름에 따옴표를 쓰는 사람은 없다시피 하고, 있어도 셸에서 못 쓴다.
  if (/["'`]/.test(낱말)) return true;

  // `/` 로 시작하는데 정규식 메타문자가 들어 있다 = 정규식 리터럴.
  // 진짜 경로에는 이런 글자가 거의 안 들어간다.
  if (낱말.startsWith('/') && /[\\[\](){}|^$+]/.test(낱말)) return true;

  /*
   * 빗금만 남은 조각.
   *
   * `s.replace(/<\/div>/g, '')` 한 줄이 `/` · `\/div` · `/g,` 셋으로 잘린다
   * (낱말 나누기가 `<` `>` 를 경계로 쓴다). 그중 `/` 는 뿌리 폴더로 풀려서
   * **작업 범위 밖**이 되고, 그 한 조각 때문에 명령 전체가 거절됐다.
   *
   * 뿌리를 통째로 미는 명령이 걱정이라면 그건 여기 몫이 아니다 —
   * `rm -rf /` 는 checkCommand 의 BLOCKED 가 따로, 더 확실하게 잡는다.
   */
  if (/^[/\\]+$/.test(낱말)) return true;
  // 빗금을 백슬래시로 흘린 것(`\/div`)도 정규식이지 경로가 아니다.
  if (낱말.includes('\\/')) return true;

  /*
   * 한 마디짜리 절대 경로(`/div`)는 **디스크에 있을 때만** 본다.
   *
   * `</div>` `<br/>` 같은 태그가 잘려 오면 이 꼴이 된다. 그런 이름의 최상위
   * 폴더는 없다. 반대로 `/tmp` `/etc` 는 실제로 있으므로 그대로 검사한다 —
   * 없다고 다 넘기면 `mkdir /남의것` 이 지나가지만, 그건 변경성 명령이라
   * checkCommand 가 따로 잡는다.
   */
  if (/^\/[^/\\]+$/.test(낱말)) {
    try { return !existsSync(낱말); } catch { return true; }
  }
  return false;
}

/*
 * ── 울타리 밖이지만 막을 까닭이 없는 자리 ───────────────────────────────
 *
 * 울타리는 **사람의 자료**를 지키려고 있다. 그런데 두 가지가 자료가 아닌데도
 * 같이 막혀서, 모델이 할 수 있는 일을 못 하게 만들고 있었다.
 *
 *   ▶ Bash(soffice --convert-to txt 보고서.pptx > /dev/null 2>&1)
 *     └ 막힘 — 작업 범위 밖입니다: /dev/null
 *   ▶ Bash(ls -l /usr/bin/strings)
 *     └ 막힘 — 작업 범위 밖입니다: /usr/bin/strings
 *
 * 앞엣것은 **아무것도 저장되지 않는 자리**다. `2>/dev/null` 은 셸 명령 절반이
 * 달고 다니는데, 그 한 조각 때문에 명령 전체가 거절됐다. 뒤엣것은 **이 PC 에
 * 무엇이 깔렸는지 보는 것**이다. 그걸 못 보면 모델은 우회로를 못 찾는다 —
 * 못 읽는 문서를 만났을 때 변환기가 있는지조차 확인할 수 없다.
 *
 * 실제로 그래서 헛돌았다. 문서를 못 읽었고, 변환하려니 막혔고, 남은 길이
 * 없으니 같은 문을 계속 두드렸다. 1.5.8 에서 한 번 겪은 것과 같은 모양인데
 * 그때는 걸린 명령 하나만 풀고 같은 갈래를 안 훑었다.
 *
 * **넓히는 것은 이 둘뿐이다.** 남의 홈 · /etc · /var · /tmp 는 그대로 막는다.
 * 프로그램이 든 폴더는 자료가 아니고, 거기 쓰는 것은 어차피 OS 가 막는다.
 */
const 버리는자리 = new Set([
  '/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty',
  'nul', 'nul:', '\\\\.\\nul',            // 윈도우
]);

/**
 * 프로그램이 사는 자리. 자료가 아니라 실행파일이다.
 *
 * **전부 소문자로 적는다** — 견줄 때 소문자로 낮춰서 보기 때문이다.
 * `/Applications` 처럼 대문자를 섞어 적으면 그 줄만 조용히 안 걸린다.
 */
const 프로그램자리 = [
  '/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/libexec',
  '/usr/local/bin', '/usr/local/sbin',
  '/opt/homebrew/bin', '/opt/homebrew/sbin', '/opt/local/bin',
  '/snap/bin', '/applications',           // 맥은 앱 꾸러미 안에 실행파일이 있다
  'c:/windows', 'c:/program files', 'c:/program files (x86)',
];

/**
 * 이 경로는 울타리를 안 물어도 되는 자리인가.
 *
 * @returns {string|null} 봐 주는 까닭. 아니면 null
 */
export function 봐주는자리(경로) {
  const p = String(경로 ?? '').replace(/\\/g, '/');
  const 낮춤 = p.toLowerCase().replace(/\/+$/, '');
  if (버리는자리.has(낮춤)) return '아무것도 저장되지 않는 자리';
  // 한 칸 아래까지만 본다. `/usr/bin/strings` 는 되고 `/usr/bin/../../Users/남` 은
  // 여기 오기 전에 resolve 로 펴져서 이 목록에 안 걸린다.
  for (const 자리 of 프로그램자리) {
    if (낮춤 === 자리 || 낮춤.startsWith(`${자리}/`)) return '프로그램이 있는 자리';
  }
  return null;
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
    if (코드조각인가(풀린)) continue;
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
