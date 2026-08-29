import { spawn } from 'node:child_process';

const signalExitCode = { SIGINT: 130, SIGTERM: 143 };

export function runNodeCli(cliPath, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: 'inherit',
    });

    const forwardSignal = (signal) => {
      if (!child.killed) child.kill(signal);
    };
    const onSigint = () => forwardSignal('SIGINT');
    const onSigterm = () => forwardSignal('SIGTERM');
    const removeSignalHandlers = () => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
    };

    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);

    child.once('error', (error) => {
      removeSignalHandlers();
      reject(error);
    });
    child.once('exit', (code, signal) => {
      removeSignalHandlers();
      resolve({
        code,
        signal,
        exitCode: code ?? signalExitCode[signal] ?? 1,
      });
    });
  });
}
