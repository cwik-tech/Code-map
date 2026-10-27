import assert from 'node:assert/strict';
import { collect, mapData } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';
import { analyzeFile } from '../lib/analyze.mjs';

const analyze = (t, entries) => {
  const root = fixture(t, entries);
  const analysis = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;
  assert.equal(analysis.python.state, 'KNOWN', JSON.stringify(analysis.python));
  return analysis;
};

pythonTest('Python settings read forms join producer consumer checks without reading secret files', (t) => {
  const a = analyze(t, {
    'pyproject.toml': '[project]\nname="parcel"\n',
    '.env.example': 'ALPHA=secret-template-value\nUNUSED=\nPYTHONPATH=\n',
    '.env': 'PRIVATE_ONLY=secret-private-value\n',
    'app.py': `import os as runtime
from os import environ as env, getenv as get
import environ
from decouple import config
reader = environ.Env()
a = runtime.environ["ALPHA"]
b = runtime.environ.get("BETA")
c = runtime.getenv("GAMMA")
d = runtime.environ.setdefault("DELTA", "fallback")
e = env["EPSILON"]
f = get("ZETA")
g = env.get("ETA")
h = env.setdefault("THETA", "fallback")
i = reader("IOTA")
j = reader.bool("KAPPA")
k = config("LAMBDA")
l = runtime.getenv(key)
m = runtime.environ[key]
`,
    'test_app.py': 'import os\ndef test_setup():\n    os.environ["WRITE_ONLY"] = "x"\n    assert True\n',
  });
  const env = a.frameworks.env;
  assert.deepEqual(env.reads.filter((r) => r.name).map((r) => r.name), ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON', 'ZETA', 'ETA', 'THETA', 'IOTA', 'KAPPA', 'LAMBDA']);
  assert.equal(env.reads.filter((r) => r.name === null).length, 2);
  assert.deepEqual(env.leads.unused, [], 'computed Python reads leave unused declarations unknown');
  assert.ok(!env.leads.undeclared.some((x) => ['ALPHA', 'PYTHONPATH'].includes(x.name)));
  assert.ok(!JSON.stringify(env).includes('secret-'));
  assert.ok(!env.names.some((x) => ['PRIVATE_ONLY', 'WRITE_ONLY'].includes(x.name)));
});

pythonTest('BaseSettings applies literal prefixes aliases config inheritance and case sensitivity', (t) => {
  const a = analyze(t, {
    'setup.cfg': '[metadata]\nname=parcel\n',
    '.env.example': 'APP_HOST=\nTOKEN_NAME=\nREAD_NAME=\nOLD_PORT=\n',
    'settings.py': `from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_", case_sensitive=False)
    host: str
    token: str = Field(alias="TOKEN_NAME")
    read: str = Field(validation_alias="READ_NAME", alias="IGNORED")
class Old(BaseSettings):
    port: int
    class Config:
        env_prefix = "OLD_"
        case_sensitive = False
`,
  });
  assert.deepEqual(a.frameworks.env.reads.map((r) => r.name), ['APP_host', 'TOKEN_NAME', 'READ_NAME', 'OLD_port']);
  assert.deepEqual(a.frameworks.env.leads, { undeclared: [], unused: [] });
});

pythonTest('dynamic settings custom helpers and lookalike classes do not produce named reads', (t) => {
  const a = analyze(t, {
    'requirements-dev.txt': 'pydantic-settings\n', '.env.template': 'KEEP=\n',
    'settings.py': `from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import Annotated
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix=PREFIX)
    host: str
class Nested(BaseSettings):
    child: Settings
class Alias(BaseSettings):
    host: str = Field(alias=NAME)
class Other(Unknown):
    host: str
class Spread(BaseSettings):
    host: str = Field(**options)
class Metadata(BaseSettings):
    host: Annotated[str, make_metadata()]
config("UNPROVEN")
os.getenv("UNIMPORTED")
`,
  });
  assert.ok(a.frameworks.env.reads.every((r) => r.name === null && r.state === 'UNKNOWN'));
  assert.equal(a.frameworks.env.reads.length, 5);
  assert.deepEqual(a.frameworks.env.leads.undeclared, []);
});

pythonTest('mixed Python and TypeScript preserve Zod and process env results', (t) => {
  const ts = 'import { z } from "zod"; export const Schema = z.number().int().min(2); export const key = process.env.TS_KEY;';
  const a = analyze(t, { 'package.json': '{}', 'pyproject.toml': '', '.env.sample': 'TS_KEY=\nPY_KEY=\n',
    'app.ts': ts, 'app.py': 'import os\nvalue = os.getenv("PY_KEY")\n' });
  const expected = analyzeFile('app.ts', ts, () => null);
  assert.deepEqual(a.models.boundaries.find((x) => x.name === 'Schema').fields.map(({ values, ...f }) => ({ ...f, values: values.map(({ named, tests, ...v }) => v) })), expected.models.schemas[0].fields);
  assert.deepEqual(a.frameworks.env.reads.find((r) => r.path === 'app.ts'), { path: 'app.ts', ...expected.env[0], test: false });
  assert.deepEqual(a.frameworks.env.leads, { undeclared: [], unused: [] });
});

pythonTest('shadowed imports and django configuration methods never invent reads', (t) => {
  const a = analyze(t, {
    'app.py': `import os
import environ
from decouple import config
reader = environ.Env()
reader.read_env("PRIVATE_FILE")
def run(os, config):
    return os.getenv("SHADOWED"), config("SHADOWED_TOO")
`,
  });
  assert.deepEqual(a.frameworks.env.reads, []);
});

pythonTest('simple nested settings use a literal delimiter and retain unknown dynamic configurations', (t) => {
  const a = analyze(t, {
    'pyproject.toml': '', '.env.example': 'APP_DB=\nAPP_DB__HOST=\nAPP_DB__PORT=\n',
    'settings.py': `from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import ClassVar
class Database(BaseModel):
    host: str
    port: int
class Settings(BaseSettings):
    model_config: ClassVar[dict] = SettingsConfigDict(env_prefix="APP_", env_nested_delimiter="__")
    db: Database
    ignored: ClassVar[str] = "value"
class Dynamic(BaseSettings):
    model_config = SettingsConfigDict(**options)
    host: str
class V1(BaseSettings):
    token: str = Field(env="TOKEN_NAME")
`,
  });
  assert.deepEqual(a.frameworks.env.reads.filter((r) => r.name).map((r) => r.name).sort(), ['APP_db', 'APP_db__host', 'APP_db__port']);
  assert.equal(a.frameworks.env.reads.filter((r) => r.name === null).length, 2);
  assert.deepEqual(a.frameworks.env.leads.undeclared, []);
  assert.deepEqual(a.frameworks.env.leads.unused, []);
});

pythonTest('unambiguous local imports provide environment names and inherited config respects exact case', (t) => {
  const a = analyze(t, {
    'pyproject.toml': '', '.env.example': 'LOWER_host=\nLOCAL_KEY=\n',
    'settings.py': `from pydantic_settings import BaseSettings, SettingsConfigDict
class Parent(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LOWER_", case_sensitive=True)
    host: str
class Child(Parent):
    extra: str

def load():
    from os import getenv as local_get
    return local_get("LOCAL_KEY")
`,
  });
  assert.deepEqual(a.frameworks.env.reads.map((r) => r.name), ['LOWER_host', 'LOWER_host', 'LOWER_extra', 'LOCAL_KEY']);
  assert.deepEqual(a.frameworks.env.leads.undeclared.map((r) => r.name), ['LOWER_extra']);
  assert.deepEqual(a.frameworks.env.leads.unused, []);
});

pythonTest('reassigned environment helper instances do not establish environment reads', (t) => {
  const a = analyze(t, { 'app.py': 'import environ\nreader = environ.Env()\nreader = custom_reader\nvalue = reader("NOT_PROVEN")\n' });
  assert.deepEqual(a.frameworks.env.reads, []);
});

pythonTest('local declarations that replace imported readers do not produce environment reads', (t) => {
  const a = analyze(t, { 'app.py': 'from decouple import config\nimport environ\ndef config(key):\n    return key\nreader = environ.Env()\ndef reader(key):\n    return key\na = config("NOT_ENV")\nb = reader("NOT_ENV_EITHER")\n' });
  assert.deepEqual(a.frameworks.env.reads, []);
});

pythonTest('inherited settings use the child location and retain the field declaration origin', (t) => {
  const a = analyze(t, {
    'pyproject.toml': '', '.env.example': 'BASE_HOST=\nCHILD_HOST=\n',
    'base.py': 'from pydantic_settings import BaseSettings, SettingsConfigDict\nclass Parent(BaseSettings):\n    model_config = SettingsConfigDict(env_prefix="BASE_")\n    host: str\n',
    'child.py': 'from base import Parent\nfrom pydantic_settings import SettingsConfigDict\nclass Child(Parent):\n    model_config = SettingsConfigDict(env_prefix="CHILD_")\n',
  });
  const read = a.frameworks.env.reads.find((r) => r.path === 'child.py');
  assert.deepEqual({ line: read.line, origin: read.origin }, { line: 3, origin: { file: 'base.py', line: 4 } });
  assert.deepEqual(a.frameworks.env.leads, { undeclared: [], unused: [] });
});
