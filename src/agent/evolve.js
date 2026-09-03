// 쓸수록 이 PC 에 맞춰 나아진다.
//
// ── 왜 만드나 ───────────────────────────────────────────────────────────
//
// deel 은 이미 세 군데서 뭔가를 배우고 있었다. 그런데 셋 다 **끄면 사라졌다.**
//
//   backend/learn.js  서버가 거절하면 그 말에서 상한을 배운다 → 그 세션에서만
//   agent/grade.js    모델이 인자를 자주 잘라 먹는지 지켜본다 → 그 세션에서만
//   session.배운다()   토큰 추정을 실제값에 맞춘다            → 그 세션에서만
//
// 그래서 켤 때마다 처음부터 다시 겪는다. 어제 `pnpm` 이 이 PC 에 없다는 걸
// 알아냈어도 오늘 또 부르고, 또 실패하고, 또 우회한다. 같은 실수를 매일 한다.
//
// 여기서는 **겪은 것을 조금씩 쌓아 두고**, 다음에 켤 때 몇 줄로 요약해 넘긴다.
//
// ── 학습이 아니다 ───────────────────────────────────────────────────────
//
// 모델을 고치는 것이 아니고, 대화를 통째로 쌓아 두는 것도 아니다. 그러면
// 컨텍스트만 먹는다. 여기 쌓는 것은 **확인된 사실 몇 줄**이다.
//
//   · 세어 두기만 한다 — 무엇이 몇 번 됐고 몇 번 안 됐나
//   · 확신이 설 때만 말한다 — 한 번 겪은 것은 우연일 수 있다
//   · 상한을 못 박는다 — 프롬프트에 실리는 것은 220토큰까지다
//
// 자리를 아끼는 쪽이 오히려 값이 크다. 여기 한 줄이 모델이 헛도는 걸음
// 서너 개를 없앤다 — 그 걸음 하나가 파일 내용 한 벌씩이다.
//
// ── 무엇을 어디에 쌓나 ──────────────────────────────────────────────────
//
//   <작업폴더>/.deel/배운것.json   이 프로젝트에서만 맞는 것 (명령·인코딩)
//   <설정폴더>/배운것.json          이 PC·이 모델에 붙는 것 (버릇·토큰 보정)
//
// 나눠 두는 이유는 하나다. "`npm test` 가 된다" 는 이 폴더의 사실이고,
// "이 모델은 인자를 잘라 먹는다" 는 모델의 사실이다. 섞어 두면 폴더를 옮길
// 때마다 모델에 대해 알아낸 것을 통째로 잃는다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { estimateTokens } from './session.js';

export const 최대토큰 = 220;    // 프롬프트에 실을 상한
const 명령최대 = 40;            // 표가 끝없이 자라지 않게
const 모델최대 = 10;

const 빈것 = () => ({ 판: 1, 명령: {}, 모델: {} });

function 읽기(파일) {
  try {
    if (!existsSync(파일)) return 빈것();
    const j = JSON.parse(readFileSync(파일, 'utf8'));
    return { ...빈것(), ...(j && typeof j === 'object' ? j : {}) };
  } catch { return 빈것(); }
}

function 쓰기(파일, 값) {
  try {
    mkdirSync(dirname(파일), { recursive: true });
    writeFileSync(파일, JSON.stringify(값, null, 2), 'utf8');
  } catch { /* 못 적어도 대화는 계속돼야 한다 */ }
}

/** 오래된 것부터 버려서 표를 상한 안에 둔다. */
function 줄이기(표, 상한) {
  const 열쇠 = Object.keys(표);
  if (열쇠.length <= 상한) return 표;
  열쇠.sort((a, b) => String(표[a]?.at ?? '').localeCompare(String(표[b]?.at ?? '')));
  for (const k of 열쇠.slice(0, 열쇠.length - 상한)) delete 표[k];
  return 표;
}

export class 배움 {
  /**
   * @param {string} root  작업 폴더
   * @param {string} home  설정 폴더 (~/.deel 또는 DEEL_HOME)
   * @param {string} 지금  시각. 검사가 고정할 수 있게 밖에서 받는다
   */
  constructor(root, home, 지금 = new Date().toISOString()) {
    this.지금 = 지금;
    this.폴더파일 = root ? join(root, '.deel', '배운것.json') : null;
    this.집파일 = home ? join(home, '배운것.json') : null;
    this.폴더 = this.폴더파일 ? 읽기(this.폴더파일) : 빈것();
    this.집 = this.집파일 ? 읽기(this.집파일) : 빈것();
  }

  /**
   * 명령 하나가 됐는지 안 됐는지.
   *
   * 명령줄 전체가 아니라 **앞머리 두 낱말**만 센다. `npm test -- --watch` 와
   * `npm test` 는 같은 사실이고, 경로·인자까지 세면 표가 금세 쓸모없어진다.
   *
   * 다만 **프로그램이 아예 없어서** 실패한 것은 첫 낱말만 센다. `pnpm install`
   * 이 안 되고 `pnpm add` 도 안 됐다면 그건 두 가지 사실이 아니라 "이 PC 에
   * pnpm 이 없다" 는 한 가지 사실이다. 두 낱말로 세면 서로 다른 칸에 하나씩
   * 쌓여서 영영 확신에 못 이른다 — 매번 다시 겪는다.
   */
  명령본것(명령, 됐나, 이유 = '') {
    const 낱말 = String(명령 ?? '').trim().split(/\s+/);
    const 없는프로그램 = !됐나
      && /not found|not recognized|ENOENT|찾을 수 없|없는 명령/i.test(String(이유 ?? ''));
    const 열쇠 = (없는프로그램 ? 낱말.slice(0, 1) : 낱말.slice(0, 2)).join(' ').slice(0, 40);
    if (!열쇠) return this;
    const 표 = this.폴더.명령;
    const r = 표[열쇠] ?? { ok: 0, no: 0, at: this.지금 };
    if (됐나) r.ok++; else r.no++;
    r.at = this.지금;
    표[열쇠] = r;
    줄이기(표, 명령최대);
    this.#저장폴더();
    return this;
  }

  /** 모델이 보인 버릇 하나. grade.js 의 지켜본것 과 같은 이름을 쓴다. */
  모델본것(모델, 무엇, n = 1) {
    const r = this.#모델칸(모델);
    if (!r) return this;
    r[무엇] = (r[무엇] ?? 0) + n;
    r.at = this.지금;
    this.#저장집();
    return this;
  }

  /** 토큰 추정 배수. 다음에 켤 때 이 값으로 시작한다. */
  보정본것(모델, 배수) {
    const n = Number(배수);
    if (!Number.isFinite(n) || n < 0.5 || n > 2) return this;
    const r = this.#모델칸(모델);
    if (!r) return this;
    // 갑자기 튀지 않게 지난 값과 섞는다. 대화마다 조금씩 옮겨 간다.
    r.보정 = r.보정 ? r.보정 + (n - r.보정) * 0.5 : n;
    r.at = this.지금;
    this.#저장집();
    return this;
  }

  /** 지난번에 알아낸 토큰 배수. 없으면 null. */
  아는보정(모델) {
    const r = this.집.모델?.[String(모델 ?? '')];
    return r?.보정 && r.보정 >= 0.5 && r.보정 <= 2 ? r.보정 : null;
  }

  /*
   * ── 이 모델이 이 주소에서 받는 전선 모양 (backend/wire.js) ─────────────
   *
   * 모델 이름만으로는 못 가른다. 같은 `claude-opus-5` 라도 회사 직통과 사내
   * 게이트웨이가 받는 것이 다르고, 게이트웨이는 제 나름대로 깎아서 넘긴다.
   * 그래서 **모델과 주소를 함께** 열쇠로 쓴다.
   *
   * 주소는 host 만 쓴다. 경로에는 배포 이름·판 번호 같은 것이 붙어 있고,
   * 그건 사람이 설정을 조금만 바꿔도 달라져서 배운 것이 매번 새것이 된다.
   */
  #전선열쇠(모델, 주소, 규격) {
    let host = '';
    try { host = new URL(String(주소 ?? '')).host; } catch { host = ''; }
    /*
     * 규격도 열쇠에 넣는다.
     *
     * 경로를 뺐더니 **한 호스트에 창구가 둘인 자리**가 걸렸다. mantle 이
     * 그렇다 — `/openai/v1` 과 `/anthropic/v1` 이 같은 호스트에 같은 모델
     * 이름으로 서 있다(providers/bedrock.js). 규격을 안 넣으면 OpenAI 창구에서
     * 배운 것(`생각형식:'effort'` 따위)이 Anthropic 창구 카드 위에 얹히고,
     * 그러면 그 창구에서는 생각도 캐시 표식도 조용히 다 꺼진다.
     *
     * 경로 전체를 넣지 않는 까닭은 그대로다 — 배포 이름·판 번호가 붙어 있어서
     * 사람이 설정을 조금만 바꿔도 배운 것이 매번 새것이 된다. 규격은 그런
     * 이름이 아니라 **몸을 어떻게 짓는가** 라서, 달라지면 정말 다른 카드다.
     */
    const 꼴 = String(규격 ?? '').trim();
    return `${String(모델 ?? '').trim()}@${host}${꼴 ? `#${꼴}` : ''}`;
  }

  /** 전선 모양 하나를 적어 둔다. */
  전선본것(모델, 주소, 카드, 규격) {
    if (!카드) return this;
    const 열쇠 = this.#전선열쇠(모델, 주소, 규격);
    if (열쇠 === '@') return this;
    this.집.전선 = this.집.전선 ?? {};
    this.집.전선[열쇠] = { ...카드, at: this.지금 };
    줄이기(this.집.전선, 모델최대);
    this.#저장집();
    return this;
  }

  /** 지난번에 알아낸 전선 모양. 없으면 null. */
  아는전선(모델, 주소, 규격) {
    const r = this.집.전선?.[this.#전선열쇠(모델, 주소, 규격)];
    if (!r || typeof r !== 'object') return null;
    const { at: _때, ...나머지 } = r;
    return 나머지;
  }

  #모델칸(모델) {
    const 이름 = String(모델 ?? '').trim();
    if (!이름) return null;
    const 표 = this.집.모델;
    표[이름] = 표[이름] ?? { 걸음: 0, at: this.지금 };
    줄이기(표, 모델최대);
    return 표[이름];
  }

  #저장폴더() { if (this.폴더파일) 쓰기(this.폴더파일, this.폴더); }
  #저장집() { if (this.집파일) 쓰기(this.집파일, this.집); }

  /**
   * 프롬프트에 실을 몇 줄.
   *
   * 확신이 서는 것만 말한다. 두 번 겪지 않은 것은 우연일 수 있고, 우연을
   * 사실처럼 적으면 모델이 그 위에서 엉뚱한 판단을 한다 — 안 배우느니만 못하다.
   *
   * @returns {string|null} 없으면 null (그때는 프롬프트에 아무것도 안 붙는다)
   */
  요약(모델 = '', 상한 = 최대토큰) {
    const 줄 = [];

    // 되는 명령 / 안 되는 명령. 이 폴더의 사실이다.
    const 되는것 = [];
    const 안되는것 = [];
    for (const [열쇠, r] of Object.entries(this.폴더.명령 ?? {})) {
      if (r.ok >= 2 && r.no === 0) 되는것.push(열쇠);
      else if (r.no >= 2 && r.ok === 0) 안되는것.push(열쇠);
    }
    if (되는것.length) 줄.push(`- 여기서 되는 명령: ${되는것.slice(0, 6).map((x) => `\`${x}\``).join(' · ')}`);
    if (안되는것.length) 줄.push(`- 이 PC 에서 안 되는 명령(다시 부르지 마라): ${안되는것.slice(0, 6).map((x) => `\`${x}\``).join(' · ')}`);

    // 모델 버릇. 걸음이 쌓여야 말이 된다.
    const m = this.집.모델?.[String(모델 ?? '')];
    if (m && (m.걸음 ?? 0) >= 10) {
      if ((m.잘린인자 ?? 0) / m.걸음 >= 0.15) {
        줄.push('- 이 모델은 큰 인자를 자주 잘라 먹었다. 파일은 Write 한 번에 다 쓰지 말고 Append 로 나눠 써라.');
      }
      if ((m.편집실패 ?? 0) / m.걸음 >= 0.15) {
        줄.push('- Edit 이 자주 빗나갔다. old_string 은 Read 로 본 그대로, 공백까지 옮겨 담아라.');
      }
      if ((m.되풀이 ?? 0) / m.걸음 >= 0.15) {
        줄.push('- 같은 호출을 되풀이한 적이 잦다. 한 번 실패한 방법은 바꿔서 시도해라.');
      }
    }

    if (!줄.length) return null;

    const 머리 = '## 여기서 겪어 본 것 (자동으로 쌓임)';
    const out = [머리];
    for (const l of 줄) {
      if (estimateTokens([...out, l].join('\n')) > 상한) break;
      out.push(l);
    }
    return out.length > 1 ? out.join('\n') : null;
  }

  /** 사람이 지우라고 한 것. 파일째 비운다. */
  지우기(어디 = '전부') {
    if (어디 === '전부' || 어디 === '폴더') { this.폴더 = 빈것(); this.#저장폴더(); }
    if (어디 === '전부' || 어디 === '모델') { this.집 = 빈것(); this.#저장집(); }
    return this;
  }

  /** 화면에 뿌릴 것. */
  현황(모델 = '') {
    const 명령 = Object.entries(this.폴더.명령 ?? {})
      .map(([이름, r]) => ({ 이름, ...r }))
      .sort((a, b) => (b.ok + b.no) - (a.ok + a.no));
    const m = this.집.모델?.[String(모델 ?? '')] ?? null;
    return { 명령, 모델: m, 모델이름: String(모델 ?? '') };
  }
}
