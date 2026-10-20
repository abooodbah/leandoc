# Core tests

| CTest name | What it runs |
| --- | --- |
| `leandoc-core` | `leandoc_core_tests tests/fixtures`: every fixture against `tests/fixtures/expected.json`, then targeted tests for limits (in-memory ZIPs), entry names, duplicates, DOCTYPE and depth, JSON shape, outline, right-to-left, sanitizing and tracked-change acceptance, which text boxes, shapes, and equations count as not displayed, classification, and the 300-page budget (Release only). Every sanitized package is checked for forbidden content and reopened. |
| `leandoc-inspect-smoke` | `InspectSmoke.cmake`: report lines, `--time`, `--folder`, exit codes. |
| `leandoc-sanitized-libreoffice` | `SanitizedLibreOffice.cmake`: sanitized packages of 14 fixtures convert to text with LibreOffice headless and keep a known sentence. Registered only when `soffice` is found. |

```sh
cmake -S . -B build/release -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build/release
ctest --test-dir build/release --output-on-failure
```

## Sanitizers

```sh
cmake -S . -B build/asan-ubsan -G Ninja -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  "-DCMAKE_C_FLAGS=-fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer" \
  "-DCMAKE_CXX_FLAGS=-fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer" \
  "-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address,undefined"
cmake --build build/asan-ubsan
ctest --test-dir build/asan-ubsan --output-on-failure
node tests/corpus/run-corpus.mjs --inspect build/asan-ubsan/tools/inspect/leandoc-inspect
```

On 2026-10-20 (Ubuntu 24.04, Clang 18.1.3) the three tests and the 50-file
corpus ran clean under AddressSanitizer, LeakSanitizer, and
UndefinedBehaviorSanitizer. The sanitized package of every renderable
fixture and corpus file (68 files) was also written and reopened under the
same build.

## Fuzz smoke

`FuzzOpen.cpp` is a libFuzzer harness. Each input goes through
`OpenDocumentBytes` as a whole file and again as the body of `word/document.xml`
in a valid package, so mutations reach the XML parser, the analysis, the
sanitizer, and the outline as well as the ZIP reader. Any sanitized package
that comes out must reopen. It builds only with Clang and
`-DLEANDOC_ENABLE_FUZZ=ON`, which also instruments `leandoc_core` for
coverage.

```sh
cmake -S . -B build/fuzz -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ -DLEANDOC_ENABLE_FUZZ=ON \
  "-DCMAKE_C_FLAGS=-fsanitize=address,undefined -fno-sanitize-recover=all" \
  "-DCMAKE_CXX_FLAGS=-fsanitize=address,undefined -fno-sanitize-recover=all" \
  "-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address,undefined"
cmake --build build/fuzz --target leandoc_fuzz_open
mkdir -p fuzz-work
build/fuzz/tests/core/leandoc_fuzz_open -max_total_time=300 -max_len=600000 \
  -rss_limit_mb=2048 -timeout=10 fuzz-work SEEDS...
```

Seeds were the fixtures (`tests/fixtures/security`, `features`, `kinds`),
the fetched corpus (`tests/corpus/cache/poi`, `libreoffice`), and, for the
second run, the `w:body` content of each fixture's `document.xml`.

This is a short smoke, not a fuzzing campaign. Results on 2026-10-20, one
process on an Intel Xeon at 2.8 GHz, Clang 18.1.3 with ASan and UBSan:

| Run | Harness | Duration | Executions | Rate | Coverage (edges) | Crashes, leaks, timeouts |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | whole file only | 301 s | 300,342 | 997/s | 2,956 to 3,157 | none |
| 2 | whole file and document.xml body | 301 s | 24,499 | 81/s | 3,445 to 3,663 | none |

The second run is slower per input because each input is also deflated
into a package and parsed as XML; it reaches about 500 more edges.
