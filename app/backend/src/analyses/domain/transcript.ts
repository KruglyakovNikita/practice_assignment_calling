export const missingTranscriptFallback = 'Транскрипт звонка отсутствует. Это тестовая заглушка.';

export function resolveAnalysisTranscript(transcript: string | null): string {
  return transcript === null || transcript.trim().length === 0
    ? missingTranscriptFallback
    : transcript;
}
