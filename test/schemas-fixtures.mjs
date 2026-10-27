// Shared helpers of the schema tests. This file has no tests.
import { collectSchemas } from '../lib/schemas/collect.mjs';

/** The schema inventory of a snapshot given as a map of paths to texts. */
export const inventory = (files) => collectSchemas(Object.keys(files), (paths) => new Map(paths.filter((path) => typeof files[path] === 'string').map((path) => [path, files[path]])));
