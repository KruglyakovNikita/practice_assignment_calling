import type { LoggerService } from '@nestjs/common';

export class JsonLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  private write(level: string, message: unknown, optionalParams: unknown[]): void {
    const context = typeof optionalParams.at(-1) === 'string' ? optionalParams.at(-1) : undefined;
    const output = {
      level,
      time: new Date().toISOString(),
      context,
      message: message instanceof Error ? message.message : String(message)
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}
