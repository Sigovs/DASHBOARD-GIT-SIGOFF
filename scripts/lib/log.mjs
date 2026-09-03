const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m' }
  : { dim: '', b: '', g: '', y: '', r: '', c: '', x: '' };

export const log = {
  step: (m) => console.log(`\n${C.b}${C.c}▍ ${m}${C.x}`),
  info: (m) => console.log(`  ${m}`),
  dim: (m) => console.log(`  ${C.dim}${m}${C.x}`),
  ok: (m) => console.log(`  ${C.g}✓${C.x} ${m}`),
  warn: (m) => console.log(`  ${C.y}!${C.x} ${m}`),
  err: (m) => console.log(`  ${C.r}✕${C.x} ${m}`),
  done: (m) => console.log(`\n${C.g}${C.b}✓ ${m}${C.x}\n`),
};
