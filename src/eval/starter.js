// `deel eval --init` 이 만들어 주는 예제 과제 다섯 (src/eval/run.js).
//
// ── 왜 파일이 아니라 글로 들고 있나 ─────────────────────────────────────
//
// npm 으로 받는 사람에게는 저장소의 폴더가 안 온다(package.json 의 files). 과제를
// 폴더로 두면 `--init` 이 복사할 원본이 설치본에 없다. 그래서 여기 글로 든다.
//
// ── 무엇을 재나 ──────────────────────────────────────────────────────────
//
// 코딩 에이전트가 실제로 자주 받는 일 다섯 가지를 하나씩 담았다. 크기는 작게 —
// 한 과제가 사내 모델로 1~2분 안에 끝나야 판마다 돌려 볼 마음이 난다.
//
//   01 버그 고치기        원인을 찾아 한 줄 고치기
//   02 기능 더하기        적힌 규칙대로 함수 하나를 새로 쓰기
//   03 여러 파일 이름 바꾸기   부르는 곳까지 빠짐없이
//   04 빨간 검사 고치기    검사를 건드리지 않고 코드를 고치기 — 완료 검사 고리(doneCheck)를 탄다
//   05 CRLF 파일 고치기    윈도 줄끝을 지키며 한 줄만 바꾸기
//
// 정답 검사(golden/)는 **모델이 일을 끝낸 뒤에** 작업 폴더에 들어간다. 모델은 못 본다.
// 그래서 「검사를 통과하게 검사를 고치는」 길이 없다 — 이게 정적 검사와 다른 점이다.

export const 예제과제 = {
  '01-버그고치기': {
    task: {
      prompt: 'src/sum.js 의 sum() 이 목록의 합을 틀리게 돌려줍니다. 원인을 찾아 고쳐 주세요.',
      check: 'node golden-check.mjs',
    },
    start: {
      'package.json': '{ "type": "module" }\n',
      'src/sum.js': '// 목록의 합을 돌려준다.\nexport function sum(list) {\n  let total = 0;\n  for (let i = 0; i < list.length - 1; i++) total += list[i];\n  return total;\n}\n',
    },
    golden: {
      'golden-check.mjs': "import assert from 'node:assert/strict';\nimport { sum } from './src/sum.js';\n\nassert.equal(sum([1, 2, 3]), 6);\nassert.equal(sum([]), 0);\nassert.equal(sum([5]), 5);\nassert.equal(sum([-1, 1, 10]), 10);\nconsole.log('ok');\n",
    },
  },
  '02-기능더하기': {
    task: {
      prompt: 'src/text.js 에 slugify(text) 를 더해 주세요. 영문은 소문자로 바꾸고, 영문 글자와 숫자가 아닌 글자가 이어진 자리는 하이픈(-) 하나로 바꾸고, 앞뒤 하이픈은 떼어 냅니다. 예: "Hello, World!" → "hello-world", "  A  B  " → "a-b". 이미 있는 capitalize 는 그대로 둡니다.',
      check: 'node golden-check.mjs',
    },
    start: {
      'package.json': '{ "type": "module" }\n',
      'src/text.js': "// 글 다루는 작은 함수들.\nexport function capitalize(s) {\n  return s.charAt(0).toUpperCase() + s.slice(1);\n}\n",
    },
    golden: {
      'golden-check.mjs': "import assert from 'node:assert/strict';\nimport { slugify, capitalize } from './src/text.js';\n\nassert.equal(slugify('Hello, World!'), 'hello-world');\nassert.equal(slugify('  A  B  '), 'a-b');\nassert.equal(slugify('Version 2.1.0'), 'version-2-1-0');\nassert.equal(slugify('---'), '');\nassert.equal(slugify('abc'), 'abc');\nassert.equal(capitalize('deel'), 'Deel');\nconsole.log('ok');\n",
    },
  },
  '03-이름바꾸기': {
    task: {
      prompt: 'getUser 함수의 이름을 fetchUser 로 바꿔 주세요. 부르는 곳도 모두 바꾸고, 동작은 그대로 둡니다.',
      check: 'node golden-check.mjs',
    },
    start: {
      'package.json': '{ "type": "module" }\n',
      'src/user.js': "export function getUser(id) {\n  return { id, name: 'user' + id };\n}\n",
      'src/profile.js': "import { getUser } from './user.js';\n\nexport function profileName(id) {\n  return getUser(id).name;\n}\n",
      'src/admin.js': "import { getUser } from './user.js';\n\nexport function isAdmin(id) {\n  return getUser(id).id === 0;\n}\n",
    },
    golden: {
      'golden-check.mjs': "import assert from 'node:assert/strict';\nimport { readdirSync, readFileSync } from 'node:fs';\nimport { fetchUser } from './src/user.js';\nimport { profileName } from './src/profile.js';\nimport { isAdmin } from './src/admin.js';\n\nassert.deepEqual(fetchUser(3), { id: 3, name: 'user3' });\nassert.equal(profileName(3), 'user3');\nassert.equal(isAdmin(0), true);\nassert.equal(isAdmin(1), false);\nconst 남은 = readdirSync('src').filter((f) => readFileSync('src/' + f, 'utf8').includes('getUser'));\nassert.deepEqual(남은, [], '옛 이름이 남은 파일: ' + 남은.join(', '));\nconsole.log('ok');\n",
    },
  },
  '04-빨간검사고치기': {
    task: {
      prompt: 'npm test 가 실패합니다. 코드를 고쳐서 통과하게 해 주세요. 검사 파일(test.mjs)은 고치지 마세요.',
      // 한 명령으로 둔다 — `&&` 는 PowerShell 5.1 을 셸로 고른 PC 에서 안 먹는다(tools/shell.js).
      check: 'node golden-check.mjs',
      // 모델이 끝내려 할 때 deel 이 이걸 돌린다 (agent/donecheck.js). 실패하면 이어서 고치게 한다.
      doneCheck: 'npm test',
    },
    start: {
      'package.json': '{ "type": "module", "scripts": { "test": "node test.mjs" } }\n',
      'src/date.js': '// 날짜를 YYYY-MM-DD 로 적는다.\nexport function ymd(d) {\n  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;\n}\n',
      'test.mjs': "import assert from 'node:assert/strict';\nimport { ymd } from './src/date.js';\n\nassert.equal(ymd(new Date(2024, 0, 5)), '2024-01-05');\nconsole.log('ok');\n",
    },
    golden: {
      // 모델이 test.mjs 를 고쳤어도 원래 것으로 되돌려 놓고 돌린다.
      'test.mjs': "import assert from 'node:assert/strict';\nimport { ymd } from './src/date.js';\n\nassert.equal(ymd(new Date(2024, 0, 5)), '2024-01-05');\nconsole.log('ok');\n",
      'golden-check.mjs': "import assert from 'node:assert/strict';\nimport { ymd } from './src/date.js';\n\nassert.equal(ymd(new Date(2024, 0, 5)), '2024-01-05');\nassert.equal(ymd(new Date(2024, 11, 31)), '2024-12-31');\nassert.equal(ymd(new Date(2025, 9, 10)), '2025-10-10');\nassert.equal(ymd(new Date(1999, 8, 9)), '1999-09-09');\nconsole.log('ok');\n",
    },
  },
  '05-CRLF파일': {
    task: {
      prompt: 'config.ini 의 port 를 9090 으로 바꿔 주세요. 다른 줄은 건드리지 마세요.',
      check: 'node golden-check.mjs',
    },
    start: {
      'config.ini': '[server]\r\nport=8080\r\nhost=localhost\r\n',
    },
    golden: {
      'golden-check.mjs': "import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\n\nassert.equal(readFileSync('config.ini', 'utf8'), '[server]\\r\\nport=9090\\r\\nhost=localhost\\r\\n', '줄끝(CRLF)을 지키며 port 한 줄만 바뀌어야 합니다');\nconsole.log('ok');\n",
    },
  },
};
