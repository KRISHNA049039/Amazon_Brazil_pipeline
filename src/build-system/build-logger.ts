export interface BuildLog {
  packageId: string;
  startTime: Date;
  endTime: Date;
  status: string;
  stepOutputs: Array<{ stepName: string; output: string; status: string }>;
}

export class BuildLogger {
  private logs: BuildLog[] = [];

  logBuild(
    packageId: string,
    startTime: Date,
    endTime: Date,
    status: string,
    stepOutputs: Array<{ stepName: string; output: string; status: string }>
  ): void {
    this.logs.push({ packageId, startTime, endTime, status, stepOutputs });
  }

  getLogsForPackage(packageId: string): BuildLog[] {
    return this.logs
      .filter((l) => l.packageId === packageId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  getAllLogs(): BuildLog[] {
    return [...this.logs].sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }
}
