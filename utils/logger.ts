/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface LogEntry {
  timestamp: number;
  stage: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'METRIC';
  message: string;
  data?: any;
}

export class SessionLogger {
  private logs: LogEntry[] = [];
  private startTime: number;
  private timers: Map<string, number> = new Map();

  constructor() {
    this.startTime = Date.now();
    this.log('SYSTEM', 'INFO', 'Session started');
  }

  private addEntry(stage: string, level: LogEntry['level'], message: string, data?: any) {
    this.logs.push({
      timestamp: Date.now() - this.startTime, // Relative time in ms
      stage,
      level,
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : undefined // Detach references
    });
  }

  log(stage: string, level: LogEntry['level'], message: string, data?: any) {
    this.addEntry(stage, level, message, data);
    // Optional: Mirror to console for dev
    if (level === 'ERROR') console.error(`[${stage}] ${message}`, data);
  }

  startTimer(label: string) {
    this.timers.set(label, performance.now());
  }

  endTimer(label: string, stage: string = 'PERF') {
    const start = this.timers.get(label);
    if (start) {
      const duration = performance.now() - start;
      this.addEntry(stage, 'METRIC', `Timer: ${label}`, { durationMs: duration.toFixed(2) });
      this.timers.delete(label);
      return duration;
    }
    return 0;
  }

  exportLog(): string {
    const summary = {
      totalDuration: Date.now() - this.startTime,
      errorCount: this.logs.filter(l => l.level === 'ERROR').length,
      warnCount: this.logs.filter(l => l.level === 'WARN').length,
      apiCallCount: this.logs.filter(l => l.message.includes('API Call')).length,
    };
    
    return JSON.stringify({ summary, logs: this.logs }, null, 2);
  }

  download() {
    const json = this.exportLog();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice-library-debug-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}