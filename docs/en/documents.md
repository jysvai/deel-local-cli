[← back to README](../../README.en.md)

# Korean documents and Excel

hwpx/docx/pptx as text, encoding written back as read, Excel as CSV

---

## Korean text and Excel

<sub>Encoding · Excel</sub>

### Encoding — written back the way it was read

Corporate documents are often not UTF-8. Files saved by old Windows Notepad in a legacy
codepage (CP949 in Korea, CP932 in Japan, GBK in China) are still around. Reading one as
UTF-8 garbles it completely: `한글` becomes `�ѱ�`.

Writing is the dangerous part. Read it garbled, save it as UTF-8, and the original is gone.
So there is one rule: **write it back in the encoding it was read in.**

Which encoding that is comes from **the file's contents, not the machine's settings.**
Each candidate is decoded strictly, then scored on whether the result looks like real text
written in that encoding. So the same CP949 document reads identically on Ubuntu, on a US
Windows machine, and on a Korean one.

```
› Read report.txt
└ 4 lines · CP949
```

If you try to insert a character that encoding **cannot hold**, it refuses instead of saving.

```
› Edit report.txt   note → note 🚀
└ This file is CP949, and you are inserting a character that encoding does not have: 🚀
```

Silently substituting question marks would be worse than not writing at all.
Newly created files are UTF-8.

Command output is handled the same way. A Windows console is not UTF-8, so taking `Bash`
output as utf8 garbles non-ASCII text. It is collected as bytes and decoded afterwards.

**Undo snapshots are stored as bytes too.** They used to be stored as UTF-8 text, so undoing
a CP949 file brought back `가나다` (bytes `b0a1 b3aa b4d9`) as six U+FFFD characters — **the
safety net itself destroyed the original bytes.** Now every snapshot is round-tripped through
UTF-8 first; anything that does not come back identical is stored as base64 and restored
byte-exact.

### HWP, Word, PowerPoint — read as text

`.hwpx`, `.docx` and `.pptx` differ only on the outside — inside they are all ZIP + XML
(hwpx is Hancom's published OWPML spec). So the same in-house zip reader and the small XML
reader that Excel already uses unpack them, **still with zero dependencies.** Paragraphs come
out in order, tables come out row by row as `name | value`, slides come out per slide.

Why this matters is one incident: asked to tidy up an HWP file, Read failed with "binary",
so the model wrote a new file over it — nearly killing the original. A refusal with no path
forward pushes the model onto a detour. Once reading works, that detour does not exist, and
**handing the agent a spec document and saying "build this"** finally works.

Editing stays off. Round-tripping a document with formatting, images and forms through plain
text always loses something. Old-style `.hwp` (OLE) cannot be read — instead deel tells you
the way out: save it as hwpx in Hancom Office and it reads fine.

### Excel — read as CSV

An Excel file is a compressed archive, not text, so normally you get "this is a binary file"
and somebody has to export a CSV by hand. `Read` just does it.

```
› Read report.xlsx
└ 3 sheets · 128 rows · unpacked directly
```

- **Still zero dependencies.** An xlsx is a zip full of XML, so Node's built-in `zlib` is enough.
- Every sheet is returned. Hidden sheets too, marked as hidden.
- Dates come back as dates, not serial numbers — the cell format is read to decide.
- Formulas come back as **computed values**, and error values like `#REF!` are not dropped.

**Password-protected files and legacy `.xls`** are handed to Excel itself; those cannot be
unpacked directly. You are asked for the password at that point.

The password is **not stored anywhere**:

- not in the config file
- not in the session log
- not in the audit log
- not as a command-line argument (other people can see your command lines)

The only path out is the child process's stdin, and a test asserts that this stays true.
Extracted intermediate files are deleted after use.

> **Excel files are read-only here.** `Edit` and `Write` refuse them, and say why and what
> to do instead. Round-tripping a file with formatting, formulas and charts through CSV
> always loses something. Better not to write than to write knowing you'll lose data.

---

[← back to README](../../README.en.md)
