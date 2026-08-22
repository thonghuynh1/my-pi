#!/bin/bash
set -e
echo "=== Vitest (accordion engine + extension) ==="
cd extensions/accordion/app && npx vitest run && cd ../../..

echo ""
echo "=== Node.js built-in tests (extensions/__tests__) ==="
node --import tsx/esm --test extensions/__tests__/*.test.ts

echo ""
echo "=== TypeScript check ==="
npm run check

echo ""
echo "All tests passed."
