export class AnalysisNotFoundError extends Error {
  constructor() {
    super('Analysis not found');
    this.name = 'AnalysisNotFoundError';
  }
}

export class CallAttemptNotFoundError extends Error {
  constructor() {
    super('Call attempt not found');
    this.name = 'CallAttemptNotFoundError';
  }
}

export class CallAttemptNotReadyError extends Error {
  constructor() {
    super('Call attempt is not terminal');
    this.name = 'CallAttemptNotReadyError';
  }
}
