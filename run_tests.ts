import { VerificationTestSuite } from './server/tests/suite';

async function main() {
  console.log('Starting verification test suite...');
  const res = await VerificationTestSuite.runAllTests();
  console.log(`\n=== SUITE COMPLETED in ${res.durationMs}ms ===`);
  console.log(`Total: ${res.total}, Passed: ${res.passed}, Failed: ${res.failed}`);
  for (const r of res.results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] #${r.id} ${r.name}: ${r.details}`);
    if (r.error) console.error('  Error:', r.error);
  }
}

main().catch(err => console.error('Fatal test runner failure:', err));
