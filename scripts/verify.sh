#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUSTC_PATH=$(rustup which --toolchain stable rustc)
RUSTDOC_PATH=$(rustup which --toolchain stable rustdoc)
CARGO_PATH=$(rustup which --toolchain stable cargo)
TOOLCHAIN_BIN=$(dirname -- "$RUSTC_PATH")
TOOLCHAIN_ROOT=$(dirname -- "$TOOLCHAIN_BIN")

export PATH="$TOOLCHAIN_BIN:$PATH"
export RUSTC="$RUSTC_PATH"
export RUSTDOC="$RUSTDOC_PATH"
export DYLD_LIBRARY_PATH="$TOOLCHAIN_ROOT/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"

"$CARGO_PATH" test --manifest-path "$PROJECT_ROOT/contract/Cargo.toml"
"$CARGO_PATH" clippy --manifest-path "$PROJECT_ROOT/contract/Cargo.toml" --all-targets -- -D warnings
"$CARGO_PATH" build --manifest-path "$PROJECT_ROOT/contract/Cargo.toml" --release --target wasm32-wasip2

npm ci --prefix "$PROJECT_ROOT/agent" --ignore-scripts
npm run check --prefix "$PROJECT_ROOT/agent"

POLICYLENS_WASM_FILE="$PROJECT_ROOT/contract/target/wasm32-wasip2/release/policylens_contract.wasm" \
  npm run verify:wasm --prefix "$PROJECT_ROOT/agent"
