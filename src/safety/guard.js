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
 *
 * ── 왜 native 를 먼저 부르나: 윈도우의 8.3 단축명 ─────────────────────
 *
 * 윈도우는 여덟 자가 넘는 이름에 `LONGDI~1` 같은 짧은 별명을 같이 만든다.
 * `realpathSync` 는 링크는 풀지만 이 별명은 **안 편다.** 그래서 같은 자리를
 * 한쪽은 `RUNNER~1`, 다른 쪽은 `runneradmin` 으로 부르게 되고, 견주면
 * 남남이 된다. `realpathSync.native` 는 OS 에게 물어보므로 긴 이름으로 편다.
 *
 * 이게 남 일이 아니다 — 윈도우 사용자 이름이 여덟 자만 넘으면 `%TEMP%` 가
 * 통째로 단축명이 된다(`C:\Users\RUNNER~1\AppData\Local\Temp`). git 은 긴
 * 이름으로 답하는데 우리는 짧은 이름으로 들고 있으면, 같은 파일이 「저장소
 * 밖」 으로 걸러진다. 여기 울타리에서는 막히는 쪽이라 안전하지만,
 * agent/commit.js 에서는 **담을 것이 없다** 가 되어 저장소 전부로 물러섰다.
 *
 * native 가 없거나 실패하는 자리(옛 판·이상한 파일 시스템)에서는 여태 쓰던
 * 것으로 물러선다. 두 자를 안 쓰는 것이 중요하지, 어느 쪽인지가 중요한 게
 * 아니다 — 견주는 양쪽이 같은 자를 쓰기만 하면 된다.
 */
const 풀기 = (p) => {
  try { return realpathSync.native(p); } catch { /* 없거나 못 물어보는 자리 */ }
  return realpathSync(p);
};

export function 진짜자리(p) {
  const 남은 = [];
  let cur = p;
  for (let i = 0; i < 64; i++) {
    try {
      const r = 풀기(cur);
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
  // 폴더를 옮기고 나면 뒤 낱말은 전부 맨 이름이라 아래 검사에 안 걸린다.
  // 그래서 옮기는 것부터 먼저 본다 (폴더옮김검사 머리말).
  const 옮긴자리 = 폴더옮김검사(String(cmd), scope);
  for (const t of 경로낱말(String(cmd))) {
    // 자료가 아닌 자리는 울타리를 안 묻는다 (봐주는자리 머리말).
    if (봐주는자리(t)) continue;
    // cd 가 가리킨 자리는 위에서 **옮겨 간 자리 기준**으로 이미 봤다. 여기서
    // 또 보면 뿌리 기준으로 풀려서 `cd src/a && cd ../..` 가 밖으로 읽힌다.
    if (옮긴자리.has(t)) continue;
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
    /*
     * 파워셸은 `$env:이름` 으로 적는다.
     *
     * 이 꼴을 안 풀면 아래 경로낱말() 이 「못 푼 자리표」 로 보고 그 낱말을
     * **통째로 건너뛴다.** 그래서 윈도우에서 이 한 줄이 울타리를 그냥 지나갔다:
     *
     *   pwsh -Command "Get-Content $env:USERPROFILE\.deel\config.json"
     *
     * 셸이 실제로 푸는 값을 우리도 그대로 푼다. 우리가 모르는 이름이면 안
     * 건드린다 — 그건 아래에서 「못 푼 것」 으로 걸러진다.
     */
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/g, (전체, 이름) => {
      const v = process.env[이름] ?? process.env[String(이름).toUpperCase()];
      return typeof v === 'string' && v ? v : 전체;
    })
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
    /*
     * 못 물어봤으면 **경로로 친다.**
     *
     * 여기가 `catch { return true; }` 였다. `true` 는 「코드 조각이다」 —
     * 곧 이 낱말은 울타리 검사를 **안 받는다**. 디스크에 못 물어본 것을
     * 열어 주는 쪽으로 떨어진 셈이다.
     *
     * 두 실수의 값이 다르다. 코드 조각을 경로로 잘못 보면 멀쩡한 명령이
     * 한 번 막히고, 사람이 보고 다시 친다. 경로를 코드 조각으로 잘못 보면
     * 울타리가 없는 것과 같고, 그건 아무 표시도 안 난다. 모를 때는 좁은
     * 쪽으로 간다.
     */
    try { return !existsSync(낱말); } catch { return false; }
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
/** 안에 폴더를 더 두는 자리. 여기만 깊이를 안 따진다. */
const 꾸러미자리 = new Set(['/applications', 'c:/program files', 'c:/program files (x86)']);

const 프로그램자리 = [
  '/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/libexec',
  '/usr/local/bin', '/usr/local/sbin',
  '/opt/homebrew/bin', '/opt/homebrew/sbin', '/opt/local/bin',
  '/snap/bin', '/applications',           // 맥은 앱 꾸러미 안에 실행파일이 있다
  /*
   * 윈도우는 **실행파일 폴더만** 적는다.
   *
   * 여기가 `'c:/windows'` 한 줄이었다. 그 아래에는 실행파일만 있는 게
   * 아니다 — `System32/drivers/etc/hosts`(그물 설정), `win.ini`,
   * `System32/config`(레지스트리 하이브), 그리고 누구나 쓸 수 있는
   * `C:/Windows/Temp` 가 전부 그 안이다. 이 목록에 걸리면 checkPaths 가
   * 그 낱말을 **통째로 건너뛴다**(continue) — 즉 울타리가 없는 것과 같다.
   *
   * 유닉스 쪽은 `/bin`·`/usr/bin` 처럼 실행파일만 든 폴더라 이 문제가 없었고,
   * 그래서 한 줄이 넓다는 것이 눈에 안 띄었다. 판마다 폭이 다르면 그건
   * 넓은 쪽이 진짜 폭이다.
   */
  'c:/windows/system32', 'c:/windows/syswow64',
  'c:/program files', 'c:/program files (x86)',
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
    if (낮춤 === 자리) return '프로그램이 있는 자리';
    if (!낮춤.startsWith(`${자리}/`)) continue;
    /*
     * **얼마나 깊이까지** 봐주나.
     *
     * 머리말은 「한 칸 아래까지만 본다」 라고 적어 뒀는데 코드는 깊이를 안
     * 봤다. 그래서 `c:/windows/system32` 를 목록에 넣는 순간 그 아래가 통째로
     * 열린다 — `system32/drivers/etc/hosts`(그물 설정)와 `system32/config`
     * (레지스트리 하이브)가 다 그 안이다. 실행파일 폴더만 적어 놓고도 자료를
     * 통째로 내주는 셈이다.
     *
     * 실행파일은 그 폴더에 **바로** 놓인다(`/usr/bin/strings`,
     * `system32/cmd.exe`). 그러니 기본은 한 칸이다.
     *
     * 꾸러미 자리는 다르다. 맥 앱은 `/Applications/X.app/Contents/MacOS/x`
     * 이고 윈도우 프로그램은 `C:/Program Files/Git/bin/git.exe` 라, 여기서
     * 한 칸으로 자르면 멀쩡히 쓰던 명령이 다시 막힌다.
     */
    const 나머지 = 낮춤.slice(자리.length + 1);
    if (꾸러미자리.has(자리) || !나머지.includes('/')) return '프로그램이 있는 자리';
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
    /*
     * 주소는 이 울타리가 볼 것이 아니다 — 그물로 나가는 것은 safety/network.js
     * 가 본다. 딱 하나 **`file:` 만 빼고**: 그건 주소 꼴로 적은 이 PC 의
     * 경로다. 여기가 스킴을 다 넘기고 있어서 이 한 줄이 그냥 지나갔다:
     *
     *   curl.exe file:///C:/Users/사용자/.deel/config.json
     *
     * `file:` 은 경로로 되돌려 아래 검사를 그대로 받게 한다.
     */
    if (/^file:/i.test(t)) {
      t = t.replace(/^file:(\/\/)?(localhost)?/i, '');
      // `file:///C:/…` 는 빗금이 하나 남는다. 드라이브 앞의 그것만 떼어 낸다.
      t = t.replace(/^\/(?=[a-zA-Z]:)/, '');
      try { t = decodeURIComponent(t); } catch { /* 못 풀면 적힌 그대로 본다 */ }
      if (!t) continue;
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
      continue;                                       // 주소(http://, ftp:// …)
    }
    // 리디렉션이 붙어 온 것(>out.txt)은 기호를 떼고 본다.
    t = t.replace(/^[<>]+/, '');
    if (!t) continue;
    const 풀린 = 자리표풀기(t);
    const 경로같나 = 풀린.includes('/') || 풀린.includes('\\') || /^[a-zA-Z]:$/.test(풀린);
    if (!경로같나) continue;
    /*
     * 남은 자리표가 있으면(우리가 못 푼 것) **어디로 갈지 모른다.** 울타리
     * (범위 밖인가)는 그래서 못 묻는다 — 억지로 풀면 엉뚱한 자리를 막는다.
     *
     * 그런데 여태 그럴 때 낱말을 통째로 버렸다. 울타리를 못 묻는 것과
     * **살림 파일인지도 안 보는 것**은 다른 이야기다. 살림은 자리가 아니라
     * 이름으로도 알아본다(`…/.deel/config.json`). 자리표가 앞에 붙어 있어도
     * 그 꼬리는 그대로 읽힌다.
     *
     * 그래서 못 푼 것은 **이름 검사만** 받고 자리 검사는 건너뛴다. 걸리면
     * 아래 checkPaths 가 내부살림() 으로 막는다.
     */
    if (/[$%]/.test(풀린)) {
      if (내부살림(풀린)) out.push(풀린);
      continue;
    }
    if (코드조각인가(풀린)) continue;
    out.push(풀린);
  }
  return out;
}

/*
 * ── 폴더를 옮기면 그 뒤로는 볼 글자가 없다 ─────────────────────────────
 *
 * 위 경로낱말() 은 **경로처럼 생긴 것**만 고른다 — 빗금이 있거나 드라이브로
 * 시작하는 것. 그래서 `cd .deel` 다음에 오는 `config.json` 은 낱말 후보로도
 * 안 뽑혔고, 아무 검사도 안 받았다. 화면에서는 이랬다 —
 *
 *   ▶ Bash(type .deel\config.json)      └ 막힘 (열쇠가 든 파일입니다)
 *   ▶ Bash(cd .deel && type config.json)  └ 그냥 읽혔다
 *
 * 같은 파일인데 한 줄은 막고 한 줄은 통과다. 그러면 잠근 뜻이 없을 뿐 아니라
 * 더 나쁘다 — 시스템 프롬프트와 화면은 「막혀 있다」 고 말하는데 사실이
 * 아니게 된다. 그 말이 거짓이 되면 모델은 그 말을 안 믿고, 사용자는 울타리가
 * 있다고 믿는다. (checkPaths 머리말에 적어 둔 것과 같은 까닭이다.)
 *
 * 그래서 **들어가는 것 자체**를 위반으로 본다. 들어간 뒤에는 우리가 볼 수
 * 있는 글자가 남지 않아서, 거기서 막을 방법이 아예 없기 때문이다.
 *
 * 여기서도 넓히지 않는다 — 안에서 도는 cd 는 전부 그대로 돈다. 모델이 하는
 * 일의 절반이 `cd 하위폴더 && 무엇` 이라, 그걸 막으면 도구를 못 쓴다.
 */
const 폴더옮김 = /^(cd|chdir|pushd|sl|set-location|push-location)$/i;
const 되돌리기 = /^(popd|pop-location)$/i;
/** 셸을 한 겹 씌워 부르는 것들. 안 들여다보면 `sh -c "cd .deel …"` 로 그냥 지나간다. */
const 셸꼴 = /^(?:.*[/\\])?(bash|sh|zsh|dash|ksh|fish|cmd|powershell|pwsh)(\.exe)?$/i;

/** 명령을 실행 단위로 자른다. 따옴표 안의 `;` 는 글자지 이음매가 아니다. */
function 마디들(cmd) {
  const 마디 = [];
  let 지금 = '';
  let 따옴 = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (따옴) { 지금 += c; if (c === 따옴) 따옴 = null; continue; }
    if (c === '"' || c === "'") { 따옴 = c; 지금 += c; continue; }
    if (c === '\n' || c === ';') { 마디.push(지금); 지금 = ''; continue; }
    if (c === '&' || c === '|') {
      마디.push(지금); 지금 = '';
      if (cmd[i + 1] === c) i++;          // && · ||
      continue;
    }
    지금 += c;
  }
  마디.push(지금);
  return 마디;
}

/** 한 마디를 낱말로. 따옴표는 벗기되, 벗겼다는 것은 남긴다(셸 한 겹을 알아보려고). */
function 낱말들(마디) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let m;
  while ((m = re.exec(마디))) {
    const 안 = m[1] ?? m[2];
    out.push({ 글: 안 ?? m[0], 쌌나: 안 != null });
  }
  return out;
}

/**
 * cd 가 어디로 가라는 것인가. 모르면 null — 모르는 것을 막으면 안 된다.
 *
 * 옵션은 건너뛴다: 파워셸의 `-Path`·`-LiteralPath`, 윈도우 cmd 의 `/d`.
 * `/d` 만 콕 집어 본다 — `/etc` 도 빗금으로 시작하지만 그건 진짜 갈 자리다.
 */
function 갈자리(뒤) {
  for (const w of 뒤) {
    if (!w.글) continue;
    if (w.글.startsWith('-')) continue;
    if (/^\/d$/i.test(w.글)) continue;
    return w.글;
  }
  return null;
}

/**
 * 폴더를 옮기는 명령을 따라가며, 옮겨 간 자리가 울타리 안인지 본다.
 *
 * @returns {Set<string>} 여기서 이미 본 cd 목적지들. 부르는 쪽은 이걸 두 번
 *   보지 않는다 — 뿌리 기준으로 다시 풀면 `cd src/a && cd ../..` 가 밖이 된다.
 */
function 폴더옮김검사(cmd, scope, 시작 = null, 깊이 = 0, 본것 = new Set()) {
  let 여기 = 시작 ?? scope.root;
  const 쌓은것 = [];
  for (const 마디 of 마디들(cmd)) {
    const 낱말 = 낱말들(마디);
    if (!낱말.length) continue;
    const 첫 = 낱말[0].글;

    // 셸을 한 겹 씌운 것은 안을 들여다본다. 그 안의 cd 는 딴 살림이라
    // (하위 셸이다) 우리 자리는 안 바뀐다 — 결과만 받고 여기는 그대로 둔다.
    if (깊이 < 2 && 셸꼴.test(첫)) {
      for (const w of 낱말.slice(1)) if (w.쌌나) 폴더옮김검사(w.글, scope, 여기, 깊이 + 1, 본것);
      continue;
    }
    if (되돌리기.test(첫)) { 여기 = 쌓은것.pop() ?? 여기; continue; }
    if (!폴더옮김.test(첫)) continue;

    const 목적 = 갈자리(낱말.slice(1));
    // 인자 없는 cd(집으로) · `cd -`(직전 자리) 는 어디로 가는지 여기서 모른다.
    // 모르는 것을 막으면 멀쩡한 명령이 죽는다.
    if (목적 == null || 목적 === '-') continue;
    const 풀린 = 자리표풀기(목적);
    // 못 푼 자리표가 남아 있으면(`$BUILD_DIR`) 역시 어디로 갈지 모른다.
    if (/[$%]/.test(풀린)) continue;

    const 열린 = MSYS풀기(풀린);
    const abs = isAbsolute(열린) ? resolve(열린) : resolve(여기, 열린);
    본것.add(풀린);

    // 프로그램이 있는 자리로 들어가는 것은 자료를 만지는 일이 아니다.
    // 푼 값이 아니라 **적힌 글자**로 본다 — 윈도우에서 resolve('/usr/bin') 은
    // `C:\usr\bin` 이 되어 목록에 안 걸린다 (checkPaths 도 낱말로 본다).
    if (봐주는자리(풀린)) { 여기 = abs; continue; }
    try { scope.resolve(abs); }
    catch (e) {
      if (e instanceof ScopeError) {
        throw new ScopeError(`${e.message}\n  이 명령 안에 있습니다: ${cmd.slice(0, 120)}`);
      }
      throw e;
    }
    // `.deel` 폴더 자신은 내부살림() 이 안 잡는다 — 그건 그 **안의 파일**을
    // 보는 검사다. 여기서는 폴더에 발을 들이는 것이 곧 위반이다.
    const 조각 = abs.replace(/\\/g, '/').split('/');
    const 이유 = 조각.includes('.deel')
      ? 'deel 자신의 살림 폴더입니다. 그 안에 게이트웨이 열쇠가 든 config.json 이 있어'
        + ' 들어가지 않습니다 — 들어가면 뒤 명령이 맨 이름만으로 그 파일에 닿습니다.'
        + ' 연결 상태가 궁금하면 사용자에게 /status 를 쳐 보라고 하세요.'
      : 내부살림(abs);
    if (이유) throw new BlockedError(`${이유}\n  이 명령 안에 있습니다: ${cmd.slice(0, 120)}`);

    if (/^(pushd|push-location)$/i.test(첫)) 쌓은것.push(여기);
    여기 = abs;
  }
  return 본것;
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
