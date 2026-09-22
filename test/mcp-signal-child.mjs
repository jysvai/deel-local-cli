/**
 * MCP 서버를 하나 띄우고 가만히 사는 아이 — 신호로 끝날 때 그 서버를 거두는지 잰다 (2.0.2 · M3).
 *
 * signal-child.mjs 와 같은 꼴이다. 재는 것이 **이 프로세스가 신호로 어떻게 죽는가** 라서 같은
 * 프로세스 안에서는 잴 수 없다.
 *
 * 언어 서버 쪽(lsp/client.js)도 같이 불러들인다 — 실제 deel 이 그렇다. 신호 손이 언어 서버에만
 * 있던 때에는 그 손이 제 아이만 거두고 같은 신호로 죽어서, 여기서 띄운 MCP 서버가 남았다.
 *
 * 손자(스텁 서버)는 **입력이 닫혀도 안 죽는 것**(sticky)으로 띄운다. 평소 서버는 파이프가 닫히면
 * 스스로 끝나서, 우리 그물을 걷어내도 검사가 초록으로 남는다.
 */
import '../src/lsp/client.js';
import { MCP서버 } from '../src/backend/mcp.js';

// 여기서만 process.exit 을 쓴다 — 까닭은 signal-child.mjs 머리말과 같다.
const 나가기 = (코드) => process.exit(코드);

const [서버파일] = process.argv.slice(2);
const 서버 = new MCP서버({ 이름: '신호', command: process.execPath, args: [서버파일, 'sticky'], env: null });
const 붙음 = await 서버.붙기({ timeout: 8000 });
if (!붙음) {
  process.stdout.write(`안켜짐 ${서버.죽음}\n`);
  나가기(9);
}
process.stdout.write(`손자 ${서버.kid.pid}\n`);

// 부모가 시킬 때까지 산다. 윈도우는 신호를 못 보내므로 이 길로 끝낸다.
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { if (String(d).includes('exit')) 나가기(0); });
