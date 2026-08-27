/**
 * 도구 설명 영어판 — 모델이 읽는 글이다.
 *
 * ── 왜 여기 따로 두나 ───────────────────────────────────────────────────
 *
 * index.js 의 한글 설명은 손대지 않는다. 저 글은 오래 겪으면서 한 문장씩
 * 눌러 온 것이라(“앞부분을 다시 보내지 마라”, “파일 목록만 봐서는 안 보인다”),
 * 그 파일을 두 언어로 갈라 놓으면 다음에 한쪽만 고치게 된다. 여기 표에
 * 없는 것은 한글 설명이 그대로 나간다 — 화면 말과 같은 규칙이다.
 *
 * ── 왜 옮기나 ───────────────────────────────────────────────────────────
 *
 * 두 가지다. 하나는 영어로 켠 사람이 한국어 도구 설명을 받으면, 모델이
 * 무엇을 골라야 할지를 못 읽는다는 것. 다른 하나는 **토큰**이다.
 * 도구 정의는 매 요청에 통째로 실리는 고정 몫인데, 한글은 글자당 약 1토큰이고
 * 영문은 약 3.6자당 1토큰이다. 32k 창에서 이 몫이 10% 를 넘게 먹고 있었다.
 *
 * ── 옮길 때 지킨 것 ─────────────────────────────────────────────────────
 *
 * 규칙을 한 줄도 안 뺐다. 특히 이런 줄들은 글자 그대로 옮겼다 —
 * 빠지면 그 모델만 조용히 다르게 굴고, 그 차이는 몇 걸음 뒤에야 드러난다.
 *
 *   Edit  “먼저 Read 로 읽어야 한다”      · 안 읽고 고치는 것을 막는 자리
 *   Append“앞부분을 다시 보내지 마라”     · 같은 자리에서 또 잘리는 것을 막는 자리
 *   Bash  “끝나지 않는 것은 background”   · 시간 초과로 죽는 것을 막는 자리
 *   Verify“확인 못 한 것은 못 했다고”     · 이 프로그램이 거짓말을 안 하게 하는 자리
 *
 * 도구 이름과 인자 이름은 **안 옮긴다.** 그건 식별자다. Task 의 목적·할일처럼
 * 한글로 된 인자 이름도 그대로 둔다 — 이름을 바꾸면 그 도구가 아예 안 불린다.
 */
export const 도구설명EN = {
  Read: {
    desc: 'Read one file. Line numbers come back with it. You must read a file before editing it.'
      + ' Excel files (.xlsx/.xlsm/.xls) can be read directly too — they come back as CSV per sheet.'
      + ' Korean HWP, Word and PowerPoint documents (.hwpx/.docx/.pptx) read directly as well —'
      + ' they come back as plain text. There is no need to ask the user to export anything.'
      + ' All of these are read-only here, though.',
    params: {
      file_path: 'path of the file to read',
      offset: 'first line (1-based). Only for large files',
      limit: 'how many lines to read',
    },
  },
  Write: {
    desc: 'Create a file, or overwrite one completely. Use Edit to change part of a file.'
      + ' **You can create several files in one call** — pass them as an array in files.'
      + ' Do that when you are laying out a folder structure. One call per file means one model'
      + ' round trip per file, and an eight-file skeleton loses minutes to that.',
    params: {
      file_path: 'path to write (single file)',
      content: 'the whole file content (single file)',
      files: 'several files at once. When you use this, leave file_path and content out.',
    },
  },
  Append: {
    desc: 'Append to the end of a file. This is how you build a large file — Write the first part,'
      + ' then call Append repeatedly until it is complete. Splitting it and landing it for certain'
      + ' beats trying to fit it in one call and getting cut off. No Read needed first — you are only'
      + ' adding to the end, so there is nothing to read.',
    params: {
      file_path: 'path of the file to append to',
      content: 'what to add at the end',
    },
  },
  Edit: {
    desc: 'Replace an exactly matching string in a file. You must Read it first.'
      + ' **If there are several places to change, send them in one call as the edits array** —'
      + ' they may even be in different files. One call per place means one model round trip per'
      + ' place, and a six-place cleanup loses minutes to that.',
    params: {
      file_path: 'path of the file to edit (single edit)',
      old_string: 'what to replace. Must be unique within the file',
      new_string: 'what to replace it with',
      replace_all: 'true to replace every occurrence',
      edits: 'several places at once, applied in the order given. When you use this, leave the arguments above out.',
    },
  },
  Glob: {
    desc: 'Find files by name pattern. e.g. **/*.js, src/**/*.{ts,tsx}',
    params: {
      pattern: 'glob pattern',
      path: 'folder to start from. Defaults to the whole working folder',
    },
  },
  Grep: {
    desc: 'Search file contents with a regular expression.',
    params: {
      pattern: 'regular expression',
      path: 'folder or file to search',
      glob: 'restrict which files. e.g. **/*.js',
      output_mode: 'defaults to files_with_matches',
      '-i': 'ignore case',
      '-n': 'show line numbers',
      head_limit: 'cap the number of results',
    },
  },
  Skill: {
    desc: 'Open one skill and read it. The list carries only names and descriptions,'
      + ' so pick the one you need and pull its body with this.',
    params: { name: 'skill name, exactly as listed' },
  },
  Bash: {
    desc: 'Run a command. Commands that cannot be undone are blocked.'
      + ' **Anything that never ends (dev servers, watch) must be started with background: true** —'
      + ' called plainly it dies on timeout. After starting one, read its output with Jobs.',
    params: {
      command: 'the command to run',
      description: 'one line on what this command does',
      timeout: 'time limit in ms. Default 120000',
      background: 'true for a command that never ends. Returns immediately; read it with Jobs',
    },
  },
  WebFetch: {
    desc: 'Read a web page. Read-only — nothing is sent. Use it to check documentation, an error'
      + ' message, or how a library is used. Addresses on this machine or an internal network are'
      + ' not read. Several calls to the same site go out one after another, so they cost that much'
      + ' more time — fetch only what you need. Truncated JSON cannot be read, so if it comes back'
      + ' cut, narrow the request or raise max_chars and call again.',
    params: {
      url: 'address to read (http/https)',
      max_chars: 'maximum characters to pull. Left out, it is sized to the model. Raise it if the'
        + ' material comes back cut (max 120000)',
    },
  },
  Recall: {
    desc: 'Search past sessions in this folder. When the user points back ("last time"), use this'
      + ' instead of asking again. This does not search file contents — that is Grep.',
    params: {
      query: 'what to look for. Two or three words (e.g. "CP949 encoding")',
      limit: 'how many to bring back (default 8)',
      tools: 'also dig through tool results (default false)',
    },
  },
  Remember: {
    desc: 'Write one line that outlives this session. Rules the user set, promises made, mistakes'
      + ' not to repeat. Do not record anything that only applies to this job, or anything a file'
      + ' would tell you. This line rides on every later request — keep it to one sentence.',
    params: { text: 'one line (e.g. "internal documents are read as CP949 and written back as CP949")' },
  },
  TodoWrite: {
    desc: 'Create and update the todo list. For anything that takes several steps, build the list'
      + ' first and update it the moment each step finishes. Always send the whole list. state is'
      + ' one of todo / doing / done, and only one item may be doing at a time. The number of steps'
      + ' is set by the size of the job — there is no fixed count and no cap. Do not squeeze unrelated'
      + ' work into one line to hit a number. Write each step small enough to check on its own.',
    params: { todos: 'the whole todo list. No cap — as many as the job needs' },
  },
  Verify: {
    desc: 'Check that what you made actually works. Call this **before** you finish, without fail.'
      + ' A file existing and a file working are different things — an unclosed tag, a src pointing'
      + ' at a file that is not there, one missing bracket in JS: none of that shows in a file listing.'
      + ' What can be run gets run (node --check, py_compile); what cannot gets read (HTML tag pairs,'
      + ' missing references, CSS braces, JSON). Whatever it could not check, it tells you it could not.'
      + ' Running tests or a build is Bash — that goes through the user for approval.',
    params: { paths: 'files to check. Left out, it checks everything checkable in the working folder.' },
  },
  Outline: {
    desc: 'See only the **skeleton** of a folder or file — per file, the names and line numbers of'
      + ' functions, classes, types, and headings. Call this before touching code you did not write.'
      + ' It tells you what is where for a fraction of what reading whole files costs. Pick the places'
      + ' to change here, then Read **only those files**. Reads js/ts, py, java/kotlin, go, rust, c#,'
      + ' md, html, css, sh, json.',
    params: {
      path: 'folder or file path. Defaults to the whole working folder',
      pattern: 'narrow by name (e.g. **/*.js). Left out, everything',
    },
  },
  Task: {
    desc: 'Split a chunk of a large job off as a subtask and **run it separately.** The subtask works'
      + ' start to finish in its own conversation and returns only a summary — the files it read do'
      + ' not pile up in your window. That is why work that creates or edits several files has to be'
      + ' divided this way to get to the end. One chunk must be finishable on its own (e.g. "create'
      + ' index.html and style.css"). The subtask cannot see your conversation — put everything it'
      + ' needs into 할일. Do not use this for one short job. Doing it yourself is faster.',
    params: {
      목적: 'this chunk in one line (e.g. "build the dashboard page skeleton")',
      할일: 'everything the subtask has to do. It cannot see this conversation, so put the background,'
        + ' the decisions, and the file paths here. Say what counts as done, too.',
      모드: 'how the subtask works: code (builds and edits) · debug (finds causes) · ask (reads and'
        + ' answers only). Defaults to code.',
      모델: 'hand this chunk to a **different model**. Only profile names the user has configured'
        + ' work (do not invent an address — it will not be accepted). Left out, it stays on the model'
        + ' you are using. Handing routine work (formatting, repetitive edits, short summaries) to a'
        + ' small model keeps your window from filling. Do the work that needs judgement yourself.',
    },
  },
  Def: {
    desc: 'Ask the language server **where a name is defined.** You get the location without reading'
      + ' the file. Unlike Grep it does not hand you the wrong places — not the same name in a comment,'
      + ' not the same name in a third-party library, not the same name inside a string.'
      + ' Call this before touching code you did not write. Once you know where it is, Read only that file.'
      + ' If the name exists in several places you get the list, and file_path picks one.',
    params: {
      name: 'the name to find (function, class, variable)',
      file_path: 'the file the name is used in. Use it when the same name exists in several places',
      line: 'line number inside file_path where the name appears (1-based)',
    },
  },
  Refs: {
    desc: 'Ask the language server for **every place a name is used.** Call it before you rename'
      + ' something or change a function — this is what tells you how many places have to change together.'
      + ' Unlike the hundreds of lines Grep gives you, only the places that really use it come back.'
      + ' Grep still finds comments, config and docs, though: use this for the code and Grep for the rest'
      + ' when you rename something outright.',
    params: {
      name: 'the name to find (function, class, variable)',
      file_path: 'the file the name is defined in. Use it when the same name exists in several places',
      line: 'line number inside file_path where the name appears (1-based)',
      include_declaration: 'include the definition itself. Default false',
    },
  },
  Jobs: {
    desc: 'List, read, and end background commands (Bash with background). Called with no number,'
      + ' you get the list. Given a number, you get whatever output arrived since last time.'
      + ' If you started a server, you must end it when the job is done.',
    params: {
      번호: 'job number to look at. Left out, the list',
      끝내기: 'true to end that job (stop)',
    },
  },
};
