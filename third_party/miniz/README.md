# miniz 3.1.2

Source: https://github.com/richgel999/miniz
Release asset: https://github.com/richgel999/miniz/releases/download/3.1.2/miniz-3.1.2.zip
(SHA-256 `f0446d863f9c19926ad9483c523fdc42e42b8d4a6a431d27e09d49c79a140d9a`)
License: MIT (see `LICENSE`)

`miniz.c` and `miniz.h` are the release amalgamation, copied unchanged.
LeanDoc compiles them into `leandoc_core` with `MINIZ_NO_STDIO`,
`MINIZ_NO_TIME`, `MINIZ_NO_ARCHIVE_WRITING_APIS`, and
`MINIZ_NO_ZLIB_COMPATIBLE_NAMES`. The core uses the ZIP reader and the
inflate and deflate functions; it writes its own stored ZIP.
