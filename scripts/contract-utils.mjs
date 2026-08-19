import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';

export const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
};

export const stableStringify = (value) => JSON.stringify(stableValue(value));

export const sha256Value = (value) =>
  createHash('sha256').update(stableStringify(value)).digest('hex');

export const sha256Text = (text) =>
  createHash('sha256').update(text, 'utf8').digest('hex');

export const sha256File = async (file) =>
  createHash('sha256').update(await fs.readFile(file)).digest('hex');

export const parseCliValue = (args, name) =>
  args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
