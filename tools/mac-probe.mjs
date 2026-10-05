// 임시 — tmp/mac-check-40 가지에만 있다. 윈도 PC 에서 못 재는 맥 자리를 진짜 맥에서 잰다. main 에는 안 들어간다.
// 40회차: 키체인 넷(531) · 푼것 캐시 · 놓였나 · /var 링크 · 끝내기 출력 잘림. 기대와 다르면 종료코드 1.
//
//   node tools/mac-probe.mjs            맥 전부
//   node tools/mac-probe.mjs --끝내기만   끝내기 출력 잘림만 (리눅스 러너에서도 돈다)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync, realpathSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 줄들 = [];
let 어긋남 = 0;
const 적기 = (무엇, 결과, 덧 = '', 기대 = null) => {
  const 표 = 기대 === null ? '·' : (기대 ? '✓' : '✗');
  if (기대 === false) 어긋남 += 1;
  줄들.push({ 표, 무엇, 결과, 덧 });
  console.log(`${표} ${String(결과).padEnd(8)} ${무엇}${덧 ? `  — ${덧}` : ''}`);
};

// ── 끝내기 — 받는 쪽이 늦게 읽어도 다 받나. 고친 판과, `await 다나가기` 를 뺀 옛 판을 나란히 ──────────
async function 느리게받기(진입) {
  const 집 = mkdtempSync(join(tmpdir(), 'deel-probe-exit-'));
  return new Promise((done) => {
    const kid = spawn(process.execPath, [진입, 'sbom'], { cwd: 뿌리, env: { ...process.env, DEEL_HOME: 집, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const 조각 = [];
    kid.stdout.pause();
    setTimeout(() => { kid.stdout.on('data', (b) => 조각.push(b)); kid.stdout.resume(); }, 1500);
    kid.stderr.resume();
    kid.on('close', (code) => {
      rmSync(집, { recursive: true, force: true });
      const 글 = Buffer.concat(조각).toString('utf8');
      let 풀림 = false; try { JSON.parse(글); 풀림 = true; } catch { /* 반쪽 */ }
      done({ code, 길이: 글.length, 풀림 });
    });
  });
}
{
  const 새 = join(뿌리, 'bin', 'deel.js');
  const 옛 = join(뿌리, 'bin', 'deel-옛끝내기.js');
  writeFileSync(옛, readFileSync(새, 'utf8').replace('  await 다나가기(5000);\n', ''), 'utf8');
  for (let 판 = 1; 판 <= 3; 판++) {
    const a = await 느리게받기(옛);
    적기(`끝내기 옛 판(다나가기 없음) ${판}`, a.풀림 ? '다받음' : '잘림', `code=${a.code} · ${a.길이}바이트`);
    const b = await 느리게받기(새);
    적기(`끝내기 고친 판 ${판}`, b.풀림 ? '다받음' : '잘림', `code=${b.code} · ${b.길이}바이트`, b.풀림 && b.code === 0);
  }
  rmSync(옛, { force: true });
}

if (!process.argv.includes('--끝내기만') && process.platform === 'darwin') {
  const sec = (args, input) => spawnSync('security', args, { encoding: 'utf8', timeout: 20000, input });
  console.log(`macOS ${spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim()} · ${process.arch} · node ${process.version} · user ${userInfo().username}`);

  // 임시 키체인을 기본으로 — 러너의 로그인 키체인을 안 건드리고, 잠금도 재 볼 수 있게.
  const 키체인 = join(tmpdir(), `deel-probe-${process.pid}.keychain-db`);
  const 옛기본 = sec(['default-keychain']).stdout.trim().replace(/^"|"$/g, '');
  const 옛목록 = sec(['list-keychains', '-d', 'user']).stdout.split('\n').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  sec(['create-keychain', '-p', 'probe-pw', 키체인]);
  sec(['set-keychain-settings', 키체인]);
  sec(['unlock-keychain', '-p', 'probe-pw', 키체인]);
  sec(['list-keychains', '-d', 'user', '-s', 키체인, ...옛목록]);
  sec(['default-keychain', '-s', 키체인]);

  const 집 = mkdtempSync(join(tmpdir(), 'deel-probe-home-'));
  process.env.DEEL_HOME = 집;
  delete process.env.DEEL_KEYCHAIN_NAME;
  const ks = await import('../src/safety/keystore.js');
  const cf = await import('../src/config.js');
  const 지우기 = (태그) => { try { ks.잠금지우기(태그); } catch { /* 없음 */ } };
  const 계정 = userInfo().username;
  const 있나 = (이름) => sec(['find-generic-password', '-a', 계정, '-s', 이름]).status === 0;

  try {
    // 1) `security -i` 한 줄의 진짜 끝 — 우리 한도(키체인줄한도)가 그 안쪽인가.
    {
      const 이름 = 'deel-probe-line';
      const 되나 = (줄길이) => {
        const 뼈 = `add-generic-password -a ${계정} -s ${이름} -w  -U\n`;
        const 값 = 'A'.repeat(Math.max(1, 줄길이 - Buffer.byteLength(뼈)));
        sec(['delete-generic-password', '-a', 계정, '-s', 이름]);
        const r = sec(['-i'], `add-generic-password -a ${계정} -s ${이름} -w ${값} -U\n`);
        const 읽음 = sec(['find-generic-password', '-a', 계정, '-s', 이름, '-w']);
        return r.status === 0 && 읽음.status === 0 && 읽음.stdout.trim() === 값;
      };
      let 아래 = 2000; let 위 = 8000;
      if (!되나(아래)) 적기('security -i 한 줄 끝 찾기', '아래부터안됨', String(아래), false);
      else {
        while (위 - 아래 > 1) { const 가운데 = Math.floor((아래 + 위) / 2); if (되나(가운데)) 아래 = 가운데; else 위 = 가운데; }
        적기('security -i 한 줄 끝(줄바꿈 포함 바이트)', String(아래), `우리 한도 ${ks.키체인줄한도}`, ks.키체인줄한도 <= 아래);
      }
      sec(['delete-generic-password', '-a', 계정, '-s', 이름]);
    }

    // 2) 우리 한도 바로 그 값은 잠기고 풀리며, 하나 넘으면 넣기 전에 거른다.
    {
      const 이름 = ks.키체인이름('probe-cap');
      const 뼈 = Buffer.byteLength(`add-generic-password -a ${계정} -s ${이름} -w  -U\n`);
      const 바이트 = Math.floor((ks.키체인줄한도 - 뼈) / 4) * 3;
      const 딱 = 'k'.repeat(바이트);
      const 태그 = ks.잠그기(딱, { 프로필id: 'probe-cap' });
      const 푼 = 태그 ? ks.풀기(태그) : null;
      적기('한도 안 가장 긴 열쇠 잠그고 풀기', 태그 && 푼?.ok && 푼.text === 딱 ? '같음' : '다름', `${바이트}자`, !!(태그 && 푼?.ok && 푼.text === 딱));
      if (태그) 지우기(태그);
      const 넘침 = ks.잠그기('k'.repeat(4000), { 프로필id: 'probe-cap-over' });
      적기('4000자 열쇠는 넣기 전에 거른다', 넘침 ? '잠금' : '거름', ks.잠그다실패한까닭()?.slice(0, 100) ?? '', !넘침 && /너무 길어/.test(ks.잠그다실패한까닭() ?? ''));
      적기('  거른 자리는 키체인에 안 생긴다', 있나(ks.키체인이름('probe-cap-over')) ? '생김' : '없음', '', !있나(ks.키체인이름('probe-cap-over')));
    }

    // 3) 키체인에 base64 가 아닌 것이 있으면 못 푼다고 한다.
    {
      const 이름 = 'deel-gateway-key-probe-bad';
      sec(['add-generic-password', '-a', 계정, '-s', 이름, '-w', 'sk-plain-not-base64!', '-U']);
      const 푼 = ks.풀기(`keychain:${이름}`);
      적기('base64 아닌 값 풀기', 푼.ok ? '받아들임' : '거절', 푼.why.slice(0, 100), !푼.ok && /deel setup/.test(푼.why));
      지우기(`keychain:${이름}`);
    }

    // 4) DEEL_KEYCHAIN_NAME 의 빈칸·줄바꿈 — 넣기 전에 거르고, 키체인에 딴 자리가 안 생긴다.
    for (const 이름 of ['deel probe spaced', 'deel\nprobe', ' ']) {
      process.env.DEEL_KEYCHAIN_NAME = 이름;
      const t = ks.잠그기('sk-name', {});
      적기(`DEEL_KEYCHAIN_NAME=${JSON.stringify(이름)}`, t ? '잠금' : '거름', ks.잠그다실패한까닭()?.slice(0, 100) ?? '', !t && /DEEL_KEYCHAIN_NAME/.test(ks.잠그다실패한까닭() ?? ''));
      if (t) 지우기(t);
      delete process.env.DEEL_KEYCHAIN_NAME;
    }
    적기('  첫 토막 이름(deel)으로 딴 자리가 안 생긴다', 있나('deel') ? '생김' : '없음', '', !있나('deel'));

    // 5) 푼것 — 같은 프로필에 새 열쇠를 넣으면 떠 있는 판도 새 열쇠를 쓴다.
    {
      const 앞 = ks.잠그기('sk-앞열쇠', { 프로필id: 'probe-swap' });
      const 첫 = cf.resolveKey({ id: 'probe-swap', apiKey: 앞 });
      const 뒤 = ks.잠그기('sk-뒤열쇠', { 프로필id: 'probe-swap' });
      const 둘 = cf.resolveKey({ id: 'probe-swap', apiKey: 뒤 });
      적기('같은 프로필에 다시 넣은 열쇠', 둘, `태그 ${앞 === 뒤 ? '같음' : '다름'} · 처음 ${첫}`, 첫 === 'sk-앞열쇠' && 둘 === 'sk-뒤열쇠');
      if (뒤) 지우기(뒤);
    }

    // 6) 잠긴 키체인 — 까닭이 사람 말로 오나.
    {
      const 태그 = ks.잠그기('sk-locked', { 프로필id: 'probe-lock' });
      sec(['lock-keychain', 키체인]);
      const t0 = Date.now();
      const 푼 = 태그 ? ks.풀기(태그) : null;
      적기('잠긴 키체인에서 풀기', 푼?.ok ? '풀림' : '못풂', `${Date.now() - t0}ms · ${푼?.why?.slice(0, 120)}`,
        푼 ? (푼.ok || /잠겨/.test(푼.why) || !/ETIMEDOUT/.test(푼.why)) : null);
      const t1 = Date.now();
      const 새태그 = ks.잠그기('sk-locked-2', { 프로필id: 'probe-lock2' });
      적기('잠긴 키체인에 잠그기', 새태그 ? '됨' : '못잠금', `${Date.now() - t1}ms · ${새태그 ? '' : ks.잠그다실패한까닭()?.slice(0, 120)}`,
        새태그 ? true : !/ETIMEDOUT$/.test(ks.잠그다실패한까닭() ?? ''));
      sec(['unlock-keychain', '-p', 'probe-pw', 키체인]);
      if (태그) 지우기(태그);
      if (새태그) 지우기(새태그);
    }
  } finally {
    sec(['default-keychain', '-s', 옛기본]);
    sec(['list-keychains', '-d', 'user', '-s', ...옛목록]);
    sec(['delete-keychain', 키체인]);
    rmSync(집, { recursive: true, force: true });
  }

  // 7) 놓였나 — 맥 뿌리의 가리키는 곳 없는 링크.
  {
    const { 놓였나, 코드조각인가 } = await import('../src/safety/guard.js');
    const 이름 = '/.VolumeIcon.icns';
    적기(`놓였나(${이름})`, String(놓였나(이름)), `existsSync=${existsSync(이름)}`, 놓였나(이름) === true);
    적기(`코드조각인가(${이름})`, String(코드조각인가(이름)), '', 코드조각인가(이름) === false);
  }

  // 8) 믿는 폴더 — /var 로 믿고 /private/var 로 묻기.
  {
    const 신뢰집 = mkdtempSync(join(tmpdir(), 'deel-probe-trust-'));
    const 방 = mkdtempSync(join(tmpdir(), 'deel-probe-room-'));
    const env = { ...process.env, DEEL_HOME: 신뢰집 };
    const tr = await import('../src/safety/trust.js');
    tr.믿기(방, { env });
    const 진짜 = realpathSync(방);
    적기('/var 로 믿고 /private/var 로 묻기', String(tr.믿나(진짜, { env })), `${방} → ${진짜}`, tr.믿나(진짜, { env }) === true);
    rmSync(신뢰집, { recursive: true, force: true });
    rmSync(방, { recursive: true, force: true });
  }

  // 9) 울타리 (2.1.5) — 진짜 Bash 도구로, 맥의 셸에서.
  {
    const { makeScope } = await import('../src/safety/guard.js');
    const { History } = await import('../src/safety/undo.js');
    const { Audit } = await import('../src/safety/audit.js');
    const { TOOLS } = await import('../src/tools/index.js');
    for (const cmd of ['find .. -delete', 'rm -rf $PWD/../옆', 'cd - && rm -rf *', 'rm -rf $OLDPWD/x', 'git -C .. clean -fdx', 'cd ~-/sub && rm -rf *', 'cd src && cd.. && find .. -delete']) {
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
      적기(`Bash ${cmd}`, /막힘/.test(String(답?.error ?? '')) ? '막힘' : '돌았음', `부모 ${남음 ? '그대로' : '지워짐!'}`, 남음);
      rmSync(바깥, { recursive: true, force: true });
    }
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['## probe', '', '| 기대 | 무엇 | 결과 | 덧 |', '|---|---|---|---|',
    ...줄들.map((x) => `| ${x.표} | ${x.무엇.replace(/\|/g, '\\|').replace(/\n/g, '⏎')} | ${x.결과} | ${String(x.덧).replace(/\|/g, '\\|').replace(/\n/g, '⏎')} |`), ''].join('\n'));
}
console.log(`\n기대와 다른 것 ${어긋남}개`);
process.exitCode = 어긋남 ? 1 : 0;
