import assert from 'node:assert/strict';
import test from 'node:test';
import { missingTranscriptFallback, resolveAnalysisTranscript } from '../src/analyses/domain/transcript';

test('analysis transcript uses fallback only for null or whitespace', () => {
  assert.equal(resolveAnalysisTranscript(null), missingTranscriptFallback);
  assert.equal(resolveAnalysisTranscript('   \n\t '), missingTranscriptFallback);
  assert.equal(resolveAnalysisTranscript('  keep exact text  '), '  keep exact text  ');
});
