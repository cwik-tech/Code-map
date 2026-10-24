// Pytest stores module and class names in classname, not in the outer JUnit suite.
import { posix } from 'node:path';

export function pythonReportSuite(file, classname, workingDirectory) {
  if (!file?.endsWith('.py') || typeof classname !== 'string') return null;
  const modules = [file, posix.relative(workingDirectory, file)].map((path) => path.slice(0, -3).replaceAll('/', '.'));
  for (const name of modules) {
    if (classname === name) return '';
    if (classname.startsWith(`${name}.`)) return classname.slice(name.length + 1);
  }
  return null;
}
