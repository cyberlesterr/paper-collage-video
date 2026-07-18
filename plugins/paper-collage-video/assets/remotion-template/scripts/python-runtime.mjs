import fs from 'node:fs';
import path from 'node:path';

export const resolvePythonCommand = ({
  root,
  env = process.env,
  platform = process.platform,
  exists = fs.existsSync,
} = {}) => {
  if (env.PYTHON_BIN?.trim()) return env.PYTHON_BIN.trim();

  if (root) {
    const virtualPython = path.join(
      root,
      '.venv',
      platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    if (exists(virtualPython)) return virtualPython;
  }

  return platform === 'win32' ? 'python' : 'python3';
};
