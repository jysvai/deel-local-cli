[← back to README](../../README.md)

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
└ 4 lines · CP949 (guessed)
```

Without a byte-order mark it is, in the end, a **guess**. CP949 and CP932 share byte
ranges, and the shorter the file the more often the guess flips. So a guess is labelled
`(guessed)`. Stating it as fact would let you believe the file read cleanly and edit on
top of it — and because the rule is to write it back in the same encoding, that is the
moment the original gets damaged. A file with a mark is labelled plainly, e.g. `UTF-8(BOM)`.

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
text always loses something. Old-style `.hwp` (OLE) cannot be read directly — deel tells you
the way out (save it as hwpx in Hancom Office) and, if this machine has LibreOffice, borrows
it to read the file anyway (below).

### Formats it cannot read: it borrows this machine's converter

`.ppt` · `.doc` · `.xls` · `.rtf` · `.odt` — the old formats deel cannot read itself — are the
most common thing in a corporate share, along with files named `.pptx` whose bytes are an old
`.ppt`. Until now such a file ended here:

```
◧ Read(report.ppt)
  └ Binary file — cannot be read as text
```

A refusal with no reason and no way forward. The model reopens the same file, then tries a
shell detour and hits the safety fence, and that round trip is your context. **Meanwhile that
machine usually has LibreOffice on it** — the very program a person would open the file with.
deel borrows it, on the same terms it borrows `rg`.

```
◧ Read(report.ppt)
  └ converted with soffice · 148 lines
```

- **Nothing is ever installed.** If it is there, it gets used; if not, deel says so and stops.
- On macOS the faster `textutil` goes first.
- It looks in the places that are not on `PATH` — inside macOS app bundles, `Program Files`.
- Converted text lands **inside the working folder** (`.deel/tmp/`) and is **deleted the moment
  it is read** — the extracted text is the document's own content, and a copy left behind is a
  copy that can be committed or zipped up. The original is never touched.
- Turn it off with `DEEL_CONVERT=off`.

With no converter either, it **says so definitively and stops** — what the file is, what is
missing, what you can do about it, and not to open it again:

```
◧ Read(report.ppt)
  └ report.ppt is a format deel cannot read directly (.ppt).
    LibreOffice (soffice) is not on this machine, so it cannot be converted either.
    Fix: save it as pptx from the original program and hand it over again.
    **Do not Read this file again. The result will be the same.**
```

A borrowed read is still not editable with `Edit` or `Write` — only the text was extracted, so
writing it back would flatten the original layout.

### PDF — page by page, and it says which pages it could not read

`.pdf` opens with `Read` too. Inside, a PDF is dictionaries plus compressed streams, and that
compression is almost always zlib — so **Node's built-in zlib is enough**. Nothing new is
installed. Both the classic xref table and the modern xref stream / object stream layout
(PDF 1.5+) are handled.

The hard part is not decompression but **getting the characters back**. What a PDF stores is not
text but glyph numbers — not "가" but "glyph 1,283 of this font". So deel reads the font's
`/ToUnicode` table to map numbers back to characters. Korean PDFs are almost always Identity-H
(two-byte glyph numbers), and without that table not one character is recoverable.

```
--- 1쪽 ---
결제 한도는 1,000,000원입니다.
The quick brown fox jumps over the lazy dog.
--- 2쪽 ---
[이 쪽은 글로 못 읽었습니다 — 글이 없는 쪽입니다 (스캔한 사진일 수 있습니다 — OCR 이 필요합니다)]
   (this page could not be read as text — no text on it, likely a scan; OCR needed)
```

**This is the point of the feature.** PDFs very often contain no text at all — scans, fonts with
no `/ToUnicode`, encryption. Returning empty text there reads as "the document does not say
that," and the model answers on that basis. So an unreadable page is labelled **in place**, with
the reason, and summarised at the end: how many pages of how many, which ones, and the line
"이 쪽들의 내용은 여기 없습니다 — 없는 것이 아니라 못 꺼낸 것입니다" (the content of those pages
is not here — not absent, just not extracted).

An encrypted PDF is never read-as-if-it-worked; you get the way out instead (save an unprotected
copy from a viewer). Files with a wrong xref or `/Length` — common when a PDF has been saved
incrementally — are recovered by scanning the whole file.

Editing is off, for the same reason as hwpx and Excel: PDF exists to print exactly as it looks,
so a round trip through plain text destroys the layout entirely.

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
unpacked directly. You are asked for the password at that point. On a machine without Excel
— every Mac and Linux box — LibreOffice is borrowed instead and the file is read as text.
Text rather than a table, but better than reading nothing at all.

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

[← back to README](../../README.md)
