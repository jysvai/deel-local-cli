/**
 * 신호를 받았을 때 무엇이 일어나는지 재려고 띄우는 아이.
 *
 * 왜 프로세스를 따로 띄우나: 재려는 것이 **프로세스가 어떻게 죽는가** 이다.
 * 같은 프로세스 안에서는 그걸 잴 수가 없다 — 재는 순간 검사가 같이 죽는다.
 *
 * 하는 일은 셋뿐이다.
 *   1. lsp/client.js 를 불러들인다 (신호 손이 여기서 달린다)
 *   2. 흉내 언어 서버를 하나 켠다 → 그 아이가 우리의 '손자' 다
 *   3. 손자 pid 를 부모에게 한 줄로 알리고 가만히 산다
 *
 * 그 뒤에 부모가 SIGTERM 을 보내거나(POSIX) 'exit' 을 적어 준다(윈도우).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 서버박기, 셈지우기 } from '../src/lsp/servers.js';
import { 얻기 } from '../src/lsp/client.js';

const 여기 = dirname(fileURLToPath(import.meta.url));
const 흉내 = join(여기, 'lsp-stub.mjs');

const 뿌리 = mkdtempSync(join(tmpdir(), 'deel-sig-'));
writeFileSync(join(뿌리, 'a.js'), 'export const 값 = 1;\n', 'utf8');

/*
 * 손자는 **저 혼자 죽지 않는 것**으로 세운다(--sticky).
 *
 * 평소의 흉내 서버는 파이프가 닫히면 스스로 끝난다. 그걸 쓰면 우리 그물을
 * 통째로 걷어내도 손자는 어차피 죽어서 검사가 초록으로 남는다 — 아무것도
 * 안 지키는 검사가 된다. 여기서 재려는 것은 **우리가 거두는가** 이다.
 */
서버박기('ts', { cmd: process.execPath, args: [흉내, '--sticky'], 이름: '흉내서버', 경로: process.execPath });
셈지우기();

/*
 * ── 여기서만 process.exit 을 쓴다 ──────────────────────────────────────
 *
 * 검사 파일은 process.exit() 를 안 쓴다(no-bundle.test.js 가 지키는 규칙).
 * 이 파일은 검사가 아니라 **검사가 재려고 띄우는 아이**다. 재는 것이
 * 「이 프로세스가 끝날 때 무슨 일이 나나」 라서, 여기서는 진짜로 끊어야
 * 한다 — exitCode 만 정해 두면 손자가 파이프를 붙들고 있어서 영영 안
 * 끝나고, 그러면 검사가 통째로 매달린다.
 *
 * 그래도 나가는 길은 하나로 모아 둔다. 흩어 두면 어디로 나가는지 안 보이고,
 * 규칙을 왜 비켜 가는지도 안 보인다.
 */
const 나가기 = (코드) => process.exit(코드);

const 서버 = await 얻기(뿌리, join(뿌리, 'a.js'));
if (!서버?.아이?.pid) {
  process.stdout.write('안켜짐\n');
  나가기(9);
}
process.stdout.write(`손자 ${서버.아이.pid}\n`);

// 부모가 시킬 때까지 산다. 윈도우는 신호를 못 보내므로 이 길로 끝낸다.
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { if (String(d).includes('exit')) 나가기(0); });

// 어떤 길로도 안 끝나면 검사가 통째로 매달린다. 반드시 시한을 둔다.
setTimeout(() => 나가기(9), 25_000);
