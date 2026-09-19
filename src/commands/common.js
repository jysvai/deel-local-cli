// 슬래시 명령 조각들이 같이 쓰는 것 — 명령표 · 설정 남기기 · 지금 연결의 프로필.
// commands.js 에서 역할별로 나눠 옮겼다(2.0.0). 명령을 가르는 자리(handle)는 그대로 commands.js 에 있다.
// 여기서는 다른 조각을 가져오지 않는다. 서로 돌려 가져오면 불러오는 차례가 꼬인다.
import { c, say, mark, clip } from '../ui/ansi.js';
import { 저장시도 } from '../config.js';
import { 말 } from '../i18n/index.js';
import { 명령들 } from '../cmdnames.js';

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
 * 설정을 남기고, 못 남겼으면 화면에 한 줄 (config.js 의 저장시도).
 *
 * 여태 아홉 자리가 전부 `try { save(cfg) } catch {}` 였다. 못 남겨도 이번 판에는
 * 먹으니 대화는 계속되는데, 바로 다음 줄에서 화면은 `✓ 바꿨습니다` 를 찍는다.
 * 사람은 정해진 줄 알고 창을 닫았다가 다음에 옛 값을 보고, 그때는 무엇 때문인지
 * 알 길이 없다 — 홈이 읽기 전용인지, 디스크가 찼는지.
 *
 * @returns {boolean} 남겼나
 */
export function 설정남기기(cfg) {
  const r = 저장시도(cfg);
  if (!r.ok) say(`  ${mark.warn} ${c.yellow(말('common.cfgSaveFailed', { 왜: clip(r.왜, 70) }))}`);
  return r.ok;
}

/**
 * **지금 이 연결이 온 프로필**을 찾는다. 못 찾으면 null 이다.
 *
 * 여태 `cfg.profiles.find(p => p.id === cfg.active) ?? cfg.profiles[0]` 였다.
 * 그 뒤 갈래가 「못 찾았으면 첫 번째에 쓴다」 라, active 가 어긋나 있으면
 * `/ctx 655360` 이 **엉뚱한 연결**에 박히고 화면에는 「프로필에 저장했습니다」
 * 가 뜬다. 8k 서버 프로필에 655,360 이 적히면 다음에 켤 때 그 서버를
 * 655,360 으로 믿고 시작한다 — 긴 대화에서 서버가 거절하고, 그 까닭을
 * 짚을 자리가 화면에 하나도 없다.
 *
 * 그래서 두 번 본다. active 로 찾고, 없으면 **지금 붙어 있는 주소·모델**로
 * 찾는다. 그래도 없으면 못 찾았다고 하고 아무 데도 안 적는다 (repl.js 의
 * 길이 되살리기가 이미 그렇게 한다).
 */
export function 이연결의프로필(cfg, session) {
  const 있는것 = Array.isArray(cfg?.profiles) ? cfg.profiles : [];
  const base = session?.conn?.base;
  const model = session?.conn?.model;
  /*
   * active 가 맞아도 **주소가 다르면 이 연결이 아니다.**
   *
   * 여기가 `p.id === cfg.active` 만 봤다. 그러면 위 머리말이 막겠다고 적어 둔 바로
   * 그 일이 그대로 난다 — 창 두 개로 같은 설정을 쓰다가 옆 창이 `/model` 로
   * 갈아타면 `cfg.active` 가 남의 서버를 가리키고, 이 창의 `/ctx 655360` ·
   * `/out 65536` 이 **그 프로필**에 박힌다. 화면에는 「프로필에 저장했습니다」 가
   * 뜬다. 같은 파일 몫인 `베낄프로필()`(commands/model.js)은 처음부터 주소를 본다.
   *
   * 주소를 모르는 부름(세션 없이 부르는 자리)에서는 예전대로 active 만 본다 —
   * 거기서 막으면 멀쩡한 자리가 「못 찾았습니다」 가 된다.
   */
  const 딱 = 있는것.find((p) => p.id === cfg.active && (base === undefined || p.baseUrl === base));
  if (딱) return 딱;
  return 있는것.find((p) => p.baseUrl === base && p.model === model) ?? null;
}
