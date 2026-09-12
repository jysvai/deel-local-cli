// 2차 리뷰 눈금 — 리뷰 도구가 **몇 판에 한 번** 쓸모 있는 답을 주는지 잰다.
//
// ── 왜 이게 있나 ────────────────────────────────────────────────────────
//
// 2차 리뷰를 스물두 판 돌리는 동안 **성공률을 한 번도 안 재 봤다.** 매번 한
// 판씩 돌리고, 빈 손으로 오면 그 한 판만 보고 까닭을 짐작하고, 도구를 고치고,
// 또 한 판 돌렸다. 그러니 「이 설정이 저 설정보다 낫다」 를 말할 근거가 한
// 번도 없었다.
//
// 짐작이 실제로 틀렸다. 22차가 세 판을 내리 잃길래 「이 diff 는 한 판에 보기
// 엔 크다」 고 단정했는데, 같은 diff 를 다섯 번 재 보니 **3/5 성공**이었다.
// 판마다 나는 고장이 아니라 **흔들리는** 것이었고, 세 판 연속 실패는 6% 짜리
// 불운이었다. 한 판만 보고 원인을 정하면 이렇게 틀린다.
//
// 그래서 같은 diff 를 같은 설정으로 N 번 돌려 성공률(pass@k)을 낸다. 실패는
// 갈래별로 센다 — 갈래가 갈리면 고칠 자리도 갈린다. 실제로 이 눈금이
// 「길이초과」 와 「도구거절」 이 각각 다섯에 한 번씩이라는 것을 보여 줬고,
// 그때 도구가 **앞엣것만 다시 묻고 뒤엣것은 한 판 부르고 버리는** 것이
// 드러났다.
//
// ── 못 박아 두는 것 ─────────────────────────────────────────────────────
//
// **모델은 `gemini-3.8-flash-high` 하나로 고정이다.** 성공률이 안 나온다고
// 모델을 바꾸는 쪽으로 풀지 않는다 — 그러면 재는 자와 재이는 것이 같이
// 움직여서 아무것도 못 잰다. 바꾸는 것은 옵션·쪽지·범위뿐이고, 그래야 차이가
// 나면 그 하나 때문이라고 말할 수 있다.
//
// 이름 끝 `-high` 가 추론 세기다. 그래서 `--effort` 를 따로 주면 agy 가
// `conflicts with --effort=low` 로 거절한다. 세기는 이름에만 있다.
//
// ── 쓰는 법 ─────────────────────────────────────────────────────────────
//
//   node tools/리뷰눈금.mjs <diff파일> [몇번] [설정...]
//
//   node tools/리뷰눈금.mjs d.diff                      지금 설정으로 5번
//   node tools/리뷰눈금.mjs d.diff 10                   10번
//   node tools/리뷰눈금.mjs d.diff 5 "--sandbox"        지금 것과 --sandbox 를 나란히
//
// diff 파일은 `git diff <범위> > d.diff` 로 만든다. 한 번이 3분 남짓 걸리니
// 5번 두 설정이면 20분쯤 본다.

import { spawn } from 'node:child_process';
import { 끝난까닭, 실패갈래 } from './리뷰길이.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const 모델 = 'gemini-3.8-flash-high';

/** 한꺼번에 띄우는 수. 너무 늘리면 서로 느려져 시간 재기가 뭉개진다. */
const 한번에 = 3;

function 어디있나() {
  const 후보 = [
    join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'agy', 'bin', 'agy.exe'),
    join(homedir(), '.local', 'bin', 'agy'),
    '/usr/local/bin/agy',
  ];
  // 있는지만 보면 된다. `readFileSync` 를 쓰면 184MB 짜리 exe 를 통째로
  // 메모리에 올린다 — 재기 전에 재는 쪽이 무거워진다(26차 리뷰).
  return 후보.find((p) => existsSync(p)) ?? 'agy';
}

const agy = 어디있나();

const 쪽지짓기 = (diff) => [
  '너는 2차 리뷰어다. 아래 diff 를 보고 진짜 결함만 짚어라.',
  '도구를 쓰려 하지 마라 — 파일 읽기도 명령 실행도 저절로 거절된다.',
  '거절당해도 멈추지 말고 diff 만 보고 아는 만큼 적어라. 빈 답이 제일 나쁘다.',
  '최대 3건. 한 건은 한 줄 — `파일:줄 · 결함 · 재현 입력`.',
  '',
  '```diff',
  diff,
  '```',
].join('\n');

/*
 * ── 실패를 갈래로 나눈다 ────────────────────────────────────────────────
 *
 * 「빈 손으로 왔다」 는 셈해 봐야 고칠 자리를 안 알려 준다. 길이가 넘친
 * 것과 도구가 막힌 것은 고치는 자리가 다르다 — 앞엣것은 쪽지·범위,
 * 뒤엣것은 다시 묻는 자리다.
 *
 * **무늬를 여기 따로 두지 않는다.** 한때 그랬고, 셋이 다 도구 쪽보다
 * 좁았다 — `finish_reason: length` 도 `denied` 홀로도 `by peer` 도 못
 * 알아보고 「그밖에」 로 뭉갰다(26차 리뷰). 재는 쪽이 재이는 쪽보다 덜
 * 보면 그 표는 거짓말이다. `실패갈래` 하나를 같이 쓴다.
 */

function 한판(쪽지, 더) {
  return new Promise((맺음) => {
    const t0 = Date.now();
    const 아 = spawn(agy, ['--input-format', 'stream-json', '--output-format', 'stream-json',
      '--mode', 'plan', '--model', 모델, '--print-timeout', '15m', ...더]);
    let 나온것 = '';
    let 샌것 = '';
    아.stdout.on('data', (d) => { 나온것 += d; });
    아.stderr.on('data', (d) => { 샌것 += d; });
    let 끝났나 = false;
    아.on('error', (e) => { 끝났나 = true; 맺음({ 판정: '못띄움', 까닭: e.message, 초: 0 }); });
    아.on('close', () => {
      // 못 뜬 판은 `error` 뒤에 `close` 가 또 온다. 두 번째 `맺음` 은
      // 약속이 삼키지만, 파싱과 가르기를 헛돌 까닭이 없다.
      if (끝났나) return;
      const 초 = (Date.now() - t0) / 1000;
      const 끝 = 나온것.split('\n')
        .map((줄) => { try { return JSON.parse(줄); } catch { return null; } })
        .filter((x) => x?.event === 'result').at(-1)?.result ?? null;
      const 답 = String(끝?.response ?? '').trim();
      /*
       * 표준오류도 까닭 자리로 친다 — agy 가 못 뜬 판은 끝맺음 자체가
       * 없고 까닭이 거기에만 있다.
       */
      const 끝맺음 = { ...(끝 ?? {}), 샌것 };
      const 판정 = 실패갈래(끝맺음, 답);
      if (판정 === '성공') return 맺음({ 판정, 답, 초, 글자: 답.length });
      // 까닭을 표준오류에서만 담으면, 끝맺음에만 적힌 판은 까닭이 빈
      // 칸으로 남는다 — 갈래는 맞게 나오는데 왜인지를 못 본다(27차 리뷰).
      return 맺음({ 판정, 까닭: `${끝난까닭(끝맺음)} ${샌것}`.trim().slice(0, 200), 초 });
    });
    아.stdin.end(`${JSON.stringify({
      event: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 쪽지 }] },
    })}\n`);
  });
}

async function 떼로(일들) {
  const 결과 = [];
  for (let i = 0; i < 일들.length; i += 한번에) {
    // eslint-disable-next-line no-await-in-loop
    결과.push(...await Promise.all(일들.slice(i, i + 한번에).map((f) => f())));
    process.stderr.write(`  …${Math.min(i + 한번에, 일들.length)}/${일들.length}\n`);
  }
  return 결과;
}

/*
 * `[몇번]` 은 안 줘도 된다. 그런데 둘째 자리를 숫자로만 읽었더니
 * `리뷰눈금 d.diff "--sandbox"` 가 **N=NaN 에 설정은 증발**이었다 —
 * 아무것도 안 돌고 표만 비어 나왔다(26차 리뷰).
 */
const [diff길, ...뒤] = process.argv.slice(2);
const 숫자인가 = 뒤.length > 0 && /^\d+$/.test(뒤[0]);
const N길 = 숫자인가 ? 뒤[0] : null;
const 나머지 = 숫자인가 ? 뒤.slice(1) : 뒤;
if (!diff길) {
  console.error('\n쓰는 법: node tools/리뷰눈금.mjs <diff파일> [몇번] [설정...]\n');
  process.exitCode = 2;
} else {
  const N = Number(N길 || 5);
  const 쪽지 = 쪽지짓기(readFileSync(diff길, 'utf8'));
  const 설정들 = [{ 이름: '지금 그대로', 더: [] },
    ...나머지.map((s) => ({ 이름: s, 더: s.split(/\s+/).filter(Boolean) }))];

  console.log(`\n2차 리뷰 눈금  (${모델} · 설정마다 ${N}번 · 설정 ${설정들.length}개)\n`);
  const 표 = [];
  for (const { 이름, 더 } of 설정들) {
    process.stderr.write(`[${이름}]\n`);
    // eslint-disable-next-line no-await-in-loop
    const rs = await 떼로(Array.from({ length: N }, () => () => 한판(쪽지, 더)));
    const 성공 = rs.filter((r) => r.판정 === '성공');
    // 성공한 판만 센다. 못 띄운 판(0초)이 섞이면 「한 판에 얼마나
    // 걸리나」 가 통째로 거짓이 된다 — 다섯 중 셋이 0초면 가운데가 0초다.
    const 초들 = 성공.map((r) => r.초).sort((a, b) => a - b);
    const 셈 = {};
    for (const r of rs) 셈[r.판정] = (셈[r.판정] ?? 0) + 1;
    if (성공.length) writeFileSync(`${diff길}.${이름.replace(/[^가-힣A-Za-z0-9]+/g, '_')}.답.txt`, 성공[0].답, 'utf8');
    표.push({
      이름,
      성공: `${성공.length}/${N}`,
      가운데초: 초들[Math.floor(초들.length / 2)]?.toFixed(0) ?? '-',
      글자: 성공.length ? Math.round(성공.reduce((a, r) => a + r.글자, 0) / 성공.length) : 0,
      실패: Object.entries(셈).filter(([k]) => k !== '성공').map(([k, v]) => `${k}×${v}`).join(' ') || '—',
    });
  }
  console.log('| 설정 | 성공 | 가운데 시간 | 답 길이 | 실패 갈래 |');
  console.log('|---|---|---|---|---|');
  for (const r of 표) console.log(`| ${r.이름} | ${r.성공} | ${r.가운데초}초 | ${r.글자}자 | ${r.실패} |`);
  console.log('');
  /*
   * 성공률이 p 면 끝판까지 세 판 도는 도구의 성공률은 1-(1-p)³ 이다.
   * 한 판짜리 눈금만 보고 「도구가 60% 밖에 안 된다」 고 읽으면 안 된다.
   *
   * **설정마다** 보여 준다. 첫 설정만 셈하면 견주려고 띄운 나머지 설정의
   * 누적치를 못 본다 — 견주는 것이 이 도구를 만든 까닭인데(27차 리뷰).
   */
  for (const r of 표) {
    const [잡, 판] = r.성공.split('/').map(Number);
    const p = 잡 / 판;
    if (!Number.isFinite(p)) continue;
    console.log(`  ${r.이름} — 한 판 ${(p * 100).toFixed(0)}% 면, 세 판까지 다시 묻는 도구는 ${((1 - (1 - p) ** 3) * 100).toFixed(0)}% 다.`);
  }
  console.log('');
}
