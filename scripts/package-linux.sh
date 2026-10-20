#!/usr/bin/env bash
# Builds, tests, and packages LeanDoc for Debian-compatible x86-64 systems:
#   release/LeanDoc-vX-linux-x86_64.deb and its .sha256 sidecar.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
build_dir="$repo_root/build/linux-package"
output_dir="$repo_root/release"
requested_version=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-dir)
      [[ $# -ge 2 ]] || { echo "--build-dir needs a value" >&2; exit 2; }
      build_dir=$2
      shift 2
      ;;
    --output-dir)
      [[ $# -ge 2 ]] || { echo "--output-dir needs a value" >&2; exit 2; }
      output_dir=$2
      shift 2
      ;;
    --version)
      [[ $# -ge 2 ]] || { echo "--version needs a value" >&2; exit 2; }
      requested_version=${2#v}
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

[[ "$(uname -s)" == "Linux" ]] || {
  echo "Linux packages must be produced on Linux." >&2
  exit 1
}
for command in node npm cmake cpack ctest ninja sha256sum dpkg-deb; do
  command -v "$command" >/dev/null || {
    echo "Required command was not found: $command" >&2
    exit 1
  }
done

manifest_version=$(node -e \
  'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version)' \
  -- "$repo_root/package.json")
if [[ -n "$requested_version" && "$requested_version" != "$manifest_version" ]]; then
  echo "Requested version $requested_version does not match package.json $manifest_version." >&2
  exit 1
fi
version=$manifest_version
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)([-+][0-9A-Za-z.-]+)?$ ]] || {
  echo "package.json version is not a supported semantic version: $version" >&2
  exit 1
}

package_dir="$build_dir/packages"
mkdir -p "$build_dir" "$output_dir" "$package_dir"
cd "$repo_root"
npm ci --ignore-scripts --no-audit --no-fund

cmake -S "$repo_root" -B "$build_dir" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX=/usr \
  -DBUILD_TESTING=ON \
  -DLEANDOC_ENABLE_GUI_TESTS=OFF
cmake --build "$build_dir" --parallel
ctest --test-dir "$build_dir" --output-on-failure

prefix="LeanDoc-v${version}-linux-x86_64"
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git -C "$repo_root" log -1 --format=%ct)}
cpack --config "$build_dir/CPackConfig.cmake" -G DEB -B "$package_dir"
cmake -E copy "$package_dir/$prefix.deb" "$output_dir/$prefix.deb"

artifact="$output_dir/$prefix.deb"
[[ -f "$artifact" ]] || {
  echo "Expected package was not created: $artifact" >&2
  exit 1
}
checksum=$(sha256sum "$artifact" | awk '{print $1}')
printf '%s  %s\n' "$checksum" "$(basename -- "$artifact")" >"$artifact.sha256"

bash "$repo_root/tests/hosts/Test-DebianPackage.sh" "$artifact"
echo "LeanDoc Linux $version package is ready in $output_dir"
