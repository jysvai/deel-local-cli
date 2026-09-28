/*
 * 기본 브라우저로 주소 하나를 연다.
 *
 * 미리보기(preview/serve.js)만 쓰던 것을 여기로 뺐다 — 2.1.4 의 「브라우저로 로그인」 도 같은
 * 문을 쓴다. 미리보기 서버를 통째로 끌고 오지 않게 따로 둔다.
 */
import { spawn } from 'node:child_process';

/**
 * 이 판에서 브라우저를 여는 명령. 못 넘길 주소면 null.
 *
 * @returns {[string, string[], object] | null}  [명령, 인자, spawn 에 더할 설정]
 *
 * ── 윈도는 주소를 따옴표로 싼다 (2.1.4) ─────────────────────────────────
 *
 * `cmd /c start "" <url>` 에서 cmd 는 따옴표 밖의 `&` 를 **명령 구분자**로 먹는다. 미리보기 주소
 * (`http://127.0.0.1:포트/`)에는 `&` 가 없어 여태 몰랐다. 로그인 주소에는 셋이 있어서 브라우저에는
 * `?callback_url=…` 까지만 가고, 나머지는 명령으로 돌려진다. Node 는 빈칸 없는 인자를 안 싸므로
 * 우리가 싸고, 그 따옴표를 Node 가 `\"` 로 다시 망치지 않게 그대로 넘긴다(windowsVerbatimArguments).
 * 따옴표가 든 주소는 그 울타리를 스스로 깨므로 **안 넘긴다** — URL 이 만든 주소에는 따옴표가
 * `%22` 로 들어 있어 이 경우는 사람이 지어낸 글뿐이다.
 *
 * `rundll32 url.dll,FileProtocolHandler` 로 cmd 를 비켜 가는 길도 있지만 사내 보안 정책(AppLocker ·
 * EDR)이 그 호출을 막는 일이 흔하다 — 2.1.4 Gemini 검토.
 */
export function 여는명령(url, platform = process.platform, env = process.env) {
  const 주소 = String(url ?? '');
  if (platform === 'win32') {
    if (/["\r\n]/.test(주소)) return null;
    if (cmd가펼치나(주소, env)) return null;
    // start 는 cmd 안엣말이다. 첫 따옴표 한 쌍은 창 제목 자리라 비워 둬야 한다.
    return ['cmd', ['/d', '/s', '/c', 'start', '""', `"${주소}"`], { windowsVerbatimArguments: true }];
  }
  return [platform === 'darwin' ? 'open' : 'xdg-open', [주소], {}];
}

/*
 * cmd 는 **따옴표 안에서도** `%이름%` 을 그 값으로 바꾼다. 따옴표로 `&` 는 막았지만 이것은 못 막고,
 * 명령 줄에서는 `%` 를 가릴 방법도 없다. 그래서 펼쳐질 자리가 있으면 안 넘긴다 — 주소는 화면에
 * 찍혀 있으니 손으로 열면 된다. 환경에 없는 cmd 의 동적 변수(`%cd%` · `%random%` …)도 센다
 * (2.1.4 Gemini 리뷰). 퍼센트 인코딩 사이(`%3A%2F`)는 그런 이름이 없어서 그대로 간다.
 */
const cmd동적 = ['cd', 'date', 'time', 'random', 'errorlevel', 'cmdextversion', 'cmdcmdline', 'highestnumanodenumber', '__appdir__', '__cd__'];
function cmd가펼치나(주소, env) {
  const 이름들 = new Set([...Object.keys(env ?? {}).map((k) => k.toLowerCase()), ...cmd동적]);
  // 겹쳐서 본다 — `%a%b%` 는 a 도 b 도 이름 자리다.
  for (const m of 주소.matchAll(/%(?=([^%]+)%)/g)) {
    if (이름들.has(m[1].toLowerCase())) return true;
  }
  return false;
}

/**
 * 기본 브라우저로 연다. 열러 갔으면 true.
 *
 * 실패해도 조용히 넘어간다 — 주소는 이미 화면에 찍혀 있으므로 손으로 열면 된다.
 * 여기서 오류를 띄우면 '띄우기는 됐는데 실패한 것처럼' 보인다.
 */
export function 브라우저로(url) {
  /*
   * 열면 안 되는 자리가 있다.
   *
   * 검사가 돌 때마다 진짜 브라우저 창이 뜨면 사람 화면이 난장판이 된다.
   * 파이프로 넘길 때(로그·캡처)도 열 이유가 없다 — 볼 사람이 없다.
   * 상자 검사는 isTTY 를 거짓말하게 만들어 자식을 띄우므로, TTY 만 봐서는
   * 못 막는다. 그래서 env 로도 막을 수 있게 뒀고 검사 돌리개가 그걸 켠다.
   */
  if (process.env.DEEL_NO_OPEN) return false;
  if (!process.stdout.isTTY) return false;
  const 명령 = 여는명령(url);
  if (!명령) return false;
  try {
    const [cmd, args, 덤] = 명령;
    const kid = spawn(cmd, args, { stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true, ...덤 });
    kid.on('error', () => { /* 없으면 그만 */ });
    kid.unref();
    return true;
  } catch {
    return false;
  }
}
