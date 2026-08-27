// B: 모드 절을 끝으로 옮기고, Ollama 에 keep_alive 를 보낸다.
import { readFileSync, writeFileSync } from 'node:fs';

function 고치기(p, 바꿈) {
  let s = readFileSync(p, 'utf8');
  for (const [a, b] of 바꿈) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${p} 못 찾음(${n}): ${a.slice(0, 60)}`);
    s = s.replace(a, b);
  }
  writeFileSync(p, s, 'utf8');
}

// ── session.js: 모드 절 이동 ────────────────────────────────────────────
고치기('src/agent/session.js', [
  [
    `    // 지금 무슨 일을 하는 중인지. 도구 목록도 이 모드에 맞춰 이미 걸러져 있다.
    const w = workMode(this.effectiveWork());
    // 창이 좁으면 짧은 판을 쓴다 (modes.js 의 말()). 규칙은 같고 설득하는 문장만 빠진다.
    parts.push(영
      ? \`\\n--- current mode: \${w.en} ---\\n\${모드말(this.effectiveWork(), this.conn?.ctx)}\`
      : \`\\n--- 지금 모드: \${w.name} (\${w.en}) ---\\n\${모드말(this.effectiveWork(), this.conn?.ctx)}\`);
    /*`,
    `    /*`,
  ],
  [
    `    /*
     * 못 박은 것은 **맨 끝**에 붙인다 (agent/pins.js).
     *
     * 긴 글의 가운데는 흘려 읽힌다 — 'lost in the middle' 이라 부르는 것이고,
     * 어느 모델에서나 잰다. 사람이 직접 못 박은 말은 그 가운데에 묻히면 안 되므로
     * 가장 마지막, 대화 바로 앞에 둔다.
     */
    const 못박은글 = this.못박은것?.요약();`,
    `    /*
     * 지금 무슨 일을 하는 중인지 — **일부러 끝쪽에** 둔다.
     *
     * 이 절은 이 프롬프트에서 유일하게 **매 턴 바뀔 수 있는** 자리다. 말을
     * 던질 때마다 알맞은 모드로 저절로 옮겨 가기 때문이다(route.js). 그런데
     * Ollama·llama.cpp 의 프리픽스 캐시는 앞부분이 지난 요청과 같을 때만
     * 계산을 재쓴다 — 이 절이 앞쪽에 있으면 모드가 바뀌는 순간 그 뒤 전부,
     * 시스템 프롬프트 나머지에 대화 전체까지 다시 계산된다. 긴 대화일수록
     * 매 턴 몇천 토큰이고, 로컬에서는 그게 그대로 몇 초다.
     *
     * 그래서 변하지 않는 것들(규칙·폴더·급말·지문·사용자 규칙·기억·스킬)을
     * 앞에 굳히고 이 절을 뒤로 보냈다. 읽기 쪽으로도 손해가 아니다 — 끝자리는
     * 가운데보다 오히려 잘 읽힌다(lost in the middle 의 반대편이다).
     * 이 차례는 test/cache.test.js 가 지킨다.
     *
     * 도구 목록도 이 모드에 맞춰 이미 걸러져 있다. 창이 좁으면 짧은 판을
     * 쓴다 (modes.js 의 말()) — 규칙은 같고 설득하는 문장만 빠진다.
     */
    const w = workMode(this.effectiveWork());
    parts.push(영
      ? \`\\n--- current mode: \${w.en} ---\\n\${모드말(this.effectiveWork(), this.conn?.ctx)}\`
      : \`\\n--- 지금 모드: \${w.name} (\${w.en}) ---\\n\${모드말(this.effectiveWork(), this.conn?.ctx)}\`);
    /*
     * 못 박은 것은 **맨 끝**에 붙인다 (agent/pins.js).
     *
     * 긴 글의 가운데는 흘려 읽힌다 — 'lost in the middle' 이라 부르는 것이고,
     * 어느 모델에서나 잰다. 사람이 직접 못 박은 말은 그 가운데에 묻히면 안 되므로
     * 가장 마지막, 대화 바로 앞에 둔다. 모드 절보다도 뒤인 것도 그래서다.
     */
    const 못박은글 = this.못박은것?.요약();`,
  ],
]);

// ── adapter.js: keep_alive ──────────────────────────────────────────────
고치기('src/backend/adapter.js', [
  [
    `    if (ctx) body.options.num_ctx = ctx;
    if (tools?.length) body.tools = tools;`,
    `    if (ctx) body.options.num_ctx = ctx;
    /*
     * 모델을 내리지 말라고 말해 둔다.
     *
     * Ollama 는 5분 동안 조용하면 모델을 내린다. 다음 말을 걸면 다시 올리고
     * **대화 전체를 다시 계산한다** — 프리픽스 캐시가 통째로 사라진 것과 같다.
     * 로컬 대화는 사람이 생각하고 다른 창을 보다 돌아오는 것이라, 5분 넘게
     * 조용한 것이 오히려 보통이다. 그 복귀 첫 마디가 제일 오래 걸리는 이유가
     * 바로 이것이었다.
     *
     * -1(영원히)은 안 쓴다. 모델을 갈아탄 뒤에도 이전 모델이 램을 물고 있게
     * 되는데, 8GB 램에서는 다음 모델이 못 올라온다는 뜻이다. 한 시간이면
     * 일하는 호흡은 다 덮고, 퇴근하면 놓아 준다. DEEL_KEEP_ALIVE 로 바꾼다.
     */
    body.keep_alive = process.env.DEEL_KEEP_ALIVE || '60m';
    if (tools?.length) body.tools = tools;`,
  ],
]);

console.log('ok');
