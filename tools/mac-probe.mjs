// 임시 — 맥 러너에서만 돈다(tmp/mac-check 가지). 윈도 PC 에서 못 잰 키체인 자리(수정기록 531)와
// 2.1.5 울타리를 진짜 맥에서 잰다. 고치지 않는다 — 잰 것을 표로 남긴다. main 에는 안 들어간다.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir, userInfo, homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const 줄들 = [];
const 적기 = (무엇, 결과, 덧 = '') => { 줄들.push({ 무엇, 결과, 덧 }); console.log(`${결과.padEnd(8)} ${무엇}${덧 ? `  — ${덧}` : ''}`); };
const sec = (args, input) => spawnSync('security', args, { encoding: 'utf8', timeout: 20000, input });

console.log(`macOS ${spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim()} · ${process.arch} · node ${process.version} · user ${userInfo().username}`);
console.log('default keychain:', sec(['default-keychain']).stdout.trim());

// ── 임시 키체인을 기본으로 — 러너의 로그인 키체인을 안 건드리고, 잠금도 재 볼 수 있게 ──────────
const 키체인 = join(tmpdir(), `deel-probe-${process.pid}.keychain-db`);
const 옛기본 = sec(['default-keychain']).stdout.trim().replace(/^"|"$/g, '');
const 옛목록 = sec(['list-keychains', '-d', 'user']).stdout.split('\n').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
sec(['create-keychain', '-p', 'probe-pw', 키체인]);
sec(['set-keychain-settings', 키체인]);            // 저절로 잠기지 않게(시간 제한 없음)
sec(['unlock-keychain', '-p', 'probe-pw', 키체인]);
sec(['list-keychains', '-d', 'user', '-s', 키체인, ...옛목록]);
sec(['default-keychain', '-s', 키체인]);
console.log('probe keychain:', sec(['default-keychain']).stdout.trim());

const ks = await import('../src/safety/keystore.js');
const 지우기 = (태그) => { try { ks.잠금지우기(태그); } catch { /* 없음 */ } };

try {
  // ── 1) 길이 — `security -i` 는 한 줄을 버퍼로 읽는다(1023 이라는 말이 있다) ──────────────
  for (const n of [40, 200, 500, 680, 700, 720, 740, 760, 800, 1000, 2000, 4000]) {
    const 열쇠 = randomBytes(n).toString('base64').slice(0, n);
    const 태그 = ks.잠그기(열쇠, { 프로필id: `probe-len-${n}` });
    if (!태그) { 적기(`길이 ${n} 잠그기`, '못잠금', ks.잠그다실패한까닭().slice(0, 160)); continue; }
    const 푼 = ks.풀기(태그);
    const 같나 = 푼.ok && 푼.text === 열쇠;
    적기(`길이 ${n} 잠그고 풀기`, 같나 ? '같음' : '다름',
      같나 ? '' : `ok=${푼.ok} 푼길이=${푼.text.length} ${푼.why.slice(0, 120)}`);
    지우기(태그);
  }

  // ── 2) 여러 글자 — 줄바꿈 · 따옴표 · 빈칸 · 한글 · 이모지 ─────────────────────────────
  for (const [무엇, 열쇠] of [['빈칸', 'sk abc def'], ['줄바꿈', 'sk-1\nsk-2'], ['따옴표', `sk-"q"'s`], ['한글', '열쇠-한글-값'], ['이모지', 'sk-🔑-x'], ['역빗금', 'sk\\n\\x']]) {
    const 태그 = ks.잠그기(열쇠, { 프로필id: `probe-char` });
    const 푼 = 태그 ? ks.풀기(태그) : null;
    적기(`글자 ${무엇}`, 태그 && 푼?.ok && 푼.text === 열쇠 ? '같음' : '다름', 태그 ? '' : ks.잠그다실패한까닭().slice(0, 120));
    if (태그) 지우기(태그);
  }

  // ── 3) 키체인에 base64 가 아닌 것이 들어 있으면 ───────────────────────────────────────
  {
    const 이름 = 'deel-gateway-key-probe-bad';
    sec(['add-generic-password', '-a', userInfo().username, '-s', 이름, '-w', 'sk-plain-not-base64!', '-U']);
    const 푼 = ks.풀기(`keychain:${이름}`);
    적기('base64 아닌 값 풀기', 푼.ok ? '받아들임' : '거절', `ok=${푼.ok} text=${JSON.stringify(푼.text).slice(0, 60)} why=${푼.why.slice(0, 80)}`);
    지우기(`keychain:${이름}`);
  }

  // ── 4) 이름 — NFD 한글 · 빈칸 · `-` 로 시작 ─────────────────────────────────────────
  {
    const nfc = '회사', nfd = '회사'.normalize('NFD');
    적기('NFC/NFD 프로필 이름', ks.키체인이름(nfc) === ks.키체인이름(nfd) ? '같은자리' : '다른자리', `${ks.키체인이름(nfc)} · ${ks.키체인이름(nfd)}`);
    const 태그 = ks.잠그기('sk-nfd', { 프로필id: nfd });
    const 푼 = 태그 ? ks.풀기(태그) : null;
    적기('NFD 프로필 잠그고 풀기', 태그 && 푼?.ok && 푼.text === 'sk-nfd' ? '같음' : '다름', 태그 ?? ks.잠그다실패한까닭());
    if (태그) 지우기(태그);
    for (const 이름 of ['deel probe spaced', '-deel-probe-dash', 'deel\nprobe']) {
      process.env.DEEL_KEYCHAIN_NAME = 이름;
      const t = ks.잠그기('sk-name', {});
      const p = t ? ks.풀기(t) : null;
      적기(`DEEL_KEYCHAIN_NAME=${JSON.stringify(이름)}`, t && p?.ok && p.text === 'sk-name' ? '같음' : (t ? '다름' : '못잠금'),
        t ? `태그=${JSON.stringify(t)} ${p?.why ?? ''}` : ks.잠그다실패한까닭().slice(0, 120));
      if (t) 지우기(t);
      delete process.env.DEEL_KEYCHAIN_NAME;
    }
  }

  // ── 5) 잠긴 키체인 — 멈추나 · 까닭이 사람 말로 오나 ───────────────────────────────────
  {
    const 태그 = ks.잠그기('sk-locked', { 프로필id: 'probe-lock' });
    sec(['lock-keychain', 키체인]);
    const t0 = Date.now();
    const 푼 = 태그 ? ks.풀기(태그) : null;
    적기('잠긴 키체인에서 풀기', 푼?.ok ? '풀림' : '못풂', `${Date.now() - t0}ms · ${푼?.why?.slice(0, 140)}`);
    const t1 = Date.now();
    const 새태그 = ks.잠그기('sk-locked-2', { 프로필id: 'probe-lock2' });
    적기('잠긴 키체인에 잠그기', 새태그 ? '됨' : '못잠금', `${Date.now() - t1}ms · ${새태그 ? '' : ks.잠그다실패한까닭().slice(0, 140)}`);
    sec(['unlock-keychain', '-p', 'probe-pw', 키체인]);
    if (태그) 지우기(태그);
    if (새태그) 지우기(새태그);
  }

  // ── 6) 울타리 (2.1.5) — 진짜 Bash 도구로, 맥의 셸에서 ────────────────────────────────
  {
    const { makeScope } = await import('../src/safety/guard.js');
    const { History } = await import('../src/safety/undo.js');
    const { Audit } = await import('../src/safety/audit.js');
    const { TOOLS } = await import('../src/tools/index.js');
    for (const cmd of ['find .. -delete', 'rm -rf $PWD/../옆', 'cd - && rm -rf *', 'rm -rf $OLDPWD/x', 'git -C .. clean -fdx', 'cat "$(pwd -P)/../지킬것.txt"', 'cd ~-/sub && rm -rf *', 'cd src && cd.. && find .. -delete', 'cd src && cd .. && ls', 'ls .']) {
      const 바깥 = mkdtempSync(join(tmpdir(), 'deel-mac-부모-'));
      const 방 = join(바깥, 'proj');
      mkdirSync(join(방, 'src'), { recursive: true });
      mkdirSync(join(바깥, '옆'), { recursive: true });
      writeFileSync(join(바깥, '지킬것.txt'), 'x');
      writeFileSync(join(바깥, '옆', 'a.js'), 'x');
      const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
      ctx.history.turn = 1;
      let 답; try { 답 = await TOOLS.Bash.run({ command: cmd }, ctx); } catch (e) { 답 = { error: e.message }; }
      const 남음 = existsSync(join(바깥, '지킬것.txt')) && existsSync(join(바깥, '옆', 'a.js'));
      const 막힘 = /막힘/.test(String(답?.error ?? ''));
      적기(`Bash ${cmd}`, 막힘 ? '막힘' : '돌았음', `부모 ${남음 ? '그대로' : '지워짐!'}`);
      rmSync(바깥, { recursive: true, force: true });
    }
  }
} finally {
  sec(['default-keychain', '-s', 옛기본]);
  sec(['list-keychains', '-d', 'user', '-s', ...옛목록]);
  sec(['delete-keychain', 키체인]);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['## mac probe', '', '| 무엇 | 결과 | 덧 |', '|---|---|---|',
    ...줄들.map((x) => `| ${x.무엇.replace(/\|/g, '\\|').replace(/\n/g, '⏎')} | ${x.결과} | ${String(x.덧).replace(/\|/g, '\\|').replace(/\n/g, '⏎')} |`), ''].join('\n'));
}
