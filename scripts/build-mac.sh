#!/bin/bash
# ── ARCOS — Mac build script ────────────────────────────────────────────
# Run from the arcos folder:  bash scripts/build-mac.sh
# Produces: release/ARCOS-1.0.3-arm64.dmg  (opens in Finder when done)
# ─────────────────────────────────────────────────────────────────────────────
set -e

# Always cd to the project root regardless of where this is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║      ARCOS — Build for Mac      ║"
echo "╚══════════════════════════════════════╝"
echo "  Project: $PROJECT_DIR"
echo ""

# ── Space-in-path workaround ─────────────────────────────────────────────────
# node-gyp (used to compile better-sqlite3) breaks if the project path
# contains spaces. Create a temporary symlink at ~/arcos-build to dodge it.
BUILD_DIR="$HOME/arcos-build"

if [[ "$PROJECT_DIR" == *" "* ]]; then
  echo "→ Path contains spaces — creating symlink at $BUILD_DIR"
  rm -f "$BUILD_DIR"
  ln -sf "$PROJECT_DIR" "$BUILD_DIR"
  cd "$BUILD_DIR"
  echo "  Building from: $BUILD_DIR → $PROJECT_DIR"
else
  cd "$PROJECT_DIR"
fi
echo ""

# ── Install / update dependencies ────────────────────────────────────────────
echo "→ Installing dependencies..."
npm install

echo ""
echo "→ Rebuilding native modules for Electron..."
npx electron-builder install-app-deps

# ── Clean stale build artifacts ──────────────────────────────────────────────
# Always do a clean build so no stale Linux/cross-platform artifacts sneak in.
echo ""
echo "→ Cleaning previous build output..."
rm -rf dist dist-electron release

# ── Type-check ───────────────────────────────────────────────────────────────
echo ""
echo "→ Type-checking..."
npx tsc --noEmit
echo "  ✓ No TypeScript errors"

# ── Build renderer + main process ────────────────────────────────────────────
# electron-builder does NOT automatically run the npm build script —
# we must explicitly invoke vite to compile the renderer and main process.
echo ""
echo "→ Building renderer and main process (vite)..."
npx vite build
echo "  ✓ Build complete"

# ── Package ──────────────────────────────────────────────────────────────────
echo ""
echo "→ Packaging for macOS (takes ~1 min)..."
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac

# ── Ad-hoc re-sign (fixes any residual Team ID mismatch on unsigned builds) ──
# Ensures dyld accepts the bundle locally without an Apple Developer certificate.
APP_BUNDLE="$PROJECT_DIR/release/mac-arm64/ARCOS.app"
if [ -d "$APP_BUNDLE" ]; then
  echo ""
  echo "→ Ad-hoc signing bundle (removes Team ID mismatch)..."
  codesign --deep --force --sign - "$APP_BUNDLE" 2>/dev/null \
    && echo "  ✓ Re-signed successfully" \
    || echo "  ⚠ codesign not available — skipping (right-click → Open on first launch)"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════╗"
echo "║           Build complete!            ║"
echo "╚══════════════════════════════════════╝"
echo ""
ls release/*.dmg 2>/dev/null && echo "  ↑ Drag to Applications to install" || true
echo ""

# Clean up symlink
if [[ "$PROJECT_DIR" == *" "* ]]; then
  rm -f "$BUILD_DIR"
fi

# Open release folder in Finder
open "$PROJECT_DIR/release/" 2>/dev/null || true
