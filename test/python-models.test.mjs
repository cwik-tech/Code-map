import assert from 'node:assert/strict';
import { collect, mapData } from '../lib/build.mjs';
import { defaults } from '../lib/project.mjs';
import { fixture, pythonTest } from './python-fixtures.mjs';

const analyze = (t, entries) => {
  const root = fixture(t, entries);
  const analysis = mapData(root, defaults, collect(root, defaults, { worktree: true }), 1, true).analysis;
  assert.equal(analysis.python.state, 'KNOWN', JSON.stringify(analysis.python));
  return analysis;
};

pythonTest('Pydantic boundaries join the shared report and Python tests name literal cases', (t) => {
  const a = analyze(t, {
    'model.py': 'from pydantic import BaseModel, Field\nclass Parcel(BaseModel):\n    count: int = Field(gt=4, le=8)\n    title: str = Field(min_length=2)\n',
    'test_model.py': 'from model import Parcel\ndef test_count():\n    assert Parcel(count=5, title="ok")\n',
  });
  const model = a.models.boundaries.find((x) => x.name === 'Parcel');
  assert.equal(model?.language, 'python');
  assert.deepEqual(model.fields[0].values.map((x) => [x.value, x.expected]), [[3, 'invalid'], [4, 'invalid'], [5, 'valid'], [7, 'valid'], [8, 'valid'], [9, 'invalid']]);
  assert.deepEqual(model.fields[0].values.find((x) => x.value === 5).tests, ['test_model.py']);
  assert.equal(model.fields[1].values.find((x) => x.value === 2).named, true);
});

pythonTest('Pydantic reads constrained types Annotated metadata enums and version one forms', (t) => {
  const a = analyze(t, { 'model.py': `import pydantic as p
import annotated_types as at
from typing import Annotated, Literal
from enum import Enum
class Shade(Enum):
    RED = "red"
    BLUE = "blue"
    EMPTY = None
class Parcel(p.BaseModel):
    a: p.conint(ge=2, multiple_of=2)
    b: p.confloat(lt=3.5)
    c: p.condecimal(max_digits=5, decimal_places=2)
    d: p.constr(pattern="^a", min_length=1)
    e: p.conlist(int, min_items=2, max_items=4)
    f: p.conset(int, min_length=1)
    g: p.conbytes(max_length=8)
    h: Annotated[int, p.Field(gt=1), at.Le(5), at.MultipleOf(2)]
    i: Annotated[str, at.MinLen(1), at.MaxLen(4), at.Len(2, 3)]
    j: Annotated[float, at.Interval(gt=0, le=9), at.Ge(-1), at.Lt(10), at.Gt(-2)]
    k: Literal["up", "down", 1]
    l: Shade
    m: str = p.Field("fixed", regex="^f", const=True)
` });
  const fields = a.models.boundaries.find((x) => x.name === 'Parcel')?.fields;
  assert.equal(fields?.length, 13);
  assert.deepEqual(fields.map((f) => f.limits.map((l) => [l.check, l.limit])), [
    [['ge', 2], ['multiple_of', 2]], [['lt', 3.5]], [['max_digits', 5], ['decimal_places', 2]],
    [['pattern', '^a'], ['min_length', 1]], [['min_items', 2], ['max_items', 4]], [['min_length', 1]], [['max_length', 8]],
    [['gt', 1], ['le', 5], ['multiple_of', 2]],
    [['min_length', 1], ['max_length', 4], ['min_length', 2], ['max_length', 3]],
    [['gt', 0], ['le', 9], ['ge', -1], ['lt', 10], ['gt', -2]], [], [], [['regex', '^f'], ['const', true]],
  ]);
  assert.deepEqual(fields.slice(0, 7).map((f) => f.type), ['number', 'number', 'number', 'string', 'array', 'array', 'string']);
  assert.deepEqual(fields[6].values.map((v) => [v.value, v.expected]), [[7, 'valid'], [8, 'valid'], [9, 'invalid']]);
  assert.deepEqual(fields[0].limits.map((x) => x.check), ['ge', 'multiple_of']);
  assert.deepEqual(fields[4].versions, ['v1']);
  assert.deepEqual(fields[7].limits.map((x) => x.check), ['gt', 'le', 'multiple_of']);
  assert.deepEqual(fields[8].limits.map((x) => x.check), ['min_length', 'max_length', 'min_length', 'max_length']);
  assert.deepEqual(fields[10].members, ['up', 'down', 1]);
  assert.deepEqual(fields[11].members, ['red', 'blue', null]);
  assert.deepEqual(fields[12].versions, ['v1']);
  assert.deepEqual(fields[1].values.map((x) => x.value), [3.49, 3.5, 3.51]);
});

pythonTest('unknown limits validators custom types and unresolved bases never claim valid cases', (t) => {
  const a = analyze(t, { 'model.py': `from pydantic import BaseModel, Field, field_validator, validator, model_validator
class Parcel(BaseModel):
    a: int = Field(ge=LIMIT)
    b: str = Field(min_length=2)
    c: Custom = Field(gt=1)
    @field_validator("b")
    def check_b(cls, value): return value
    @validator("a")
    def check_a(cls, value): return value
    @model_validator(mode="after")
    def check_all(self): return self
class Unclear(Unknown):
    a: int = Field(ge=1)
class Ordinary:
    a: int = 1
` });
  const models = a.models.boundaries;
  assert.ok(!models.some((x) => x.name === 'Unclear'), 'an unresolved base does not establish a model');
  assert.ok(a.models.errors.some((x) => x.name === 'Unclear' && x.state === 'UNKNOWN'));
  assert.ok(!models.some((x) => x.name === 'Ordinary'));
  assert.ok(models.find((x) => x.name === 'Parcel').fields.every((x) => x.unknown.includes('validator:check_all')));
  assert.ok(models.find((x) => x.name === 'Parcel').fields.every((x) => x.unknown.length > 0 && x.values.every((v) => v.expected === null)));
});

pythonTest('local inheritance and Pydantic dataclasses retain constraints', (t) => {
  const a = analyze(t, {
    'base.py': 'from pydantic import BaseModel, Field\nclass Base(BaseModel):\n    count: int = Field(ge=2)\n',
    'child.py': 'from base import Base as Parent\nclass Child(Parent):\n    pass\n',
    'data.py': 'import pydantic.dataclasses\nfrom pydantic import Field\n@pydantic.dataclasses.dataclass\nclass Row:\n    count: int = Field(lt=8)\n',
  });
  assert.deepEqual(a.models.boundaries.find((x) => x.name === 'Child')?.fields[0].values.map((x) => x.value), [1, 2, 3]);
  assert.equal(a.models.boundaries.find((x) => x.name === 'Row')?.source, 'pydantic');
  assert.deepEqual(a.models.boundaries.find((x) => x.name === 'Child').fields[0].origin, { file: 'base.py', line: 3 });
  assert.equal(a.models.boundaries.find((x) => x.name === 'Child').fields[0].line, 2);
});

pythonTest('numeric metadata and Field limits retain every explicit rule without overstating custom rules', (t) => {
  const a = analyze(t, { 'model.py': `from pydantic import BaseModel, Field
from annotated_types import Gt, Ge, Lt, Le, MinLen, MaxLen, Len, Interval, MultipleOf
from typing import Annotated
from decimal import Decimal
class Limits(BaseModel):
    low: int = Field(gt=1, ge=2, lt=8, le=7, multiple_of=2)
    text: str = Field(min_length=2, max_length=5, pattern="^a")
    amount: Decimal = Field(max_digits=4, decimal_places=2)
    multiple: int = Field(multiple_of=3)
    annotated: Annotated[int, Gt(gt=1), Ge(ge=2), Lt(lt=8), Le(le=7), MultipleOf(multiple_of=2)]
    sized: Annotated[str, MinLen(min_length=1), MaxLen(max_length=5), Len(min_length=2, max_length=4)]
` });
  const f = a.models.boundaries.find((x) => x.name === 'Limits').fields;
  assert.deepEqual(f[0].limits.map((x) => x.check), ['gt', 'ge', 'lt', 'le', 'multiple_of']);
  assert.deepEqual(f[1].limits.map((x) => x.check), ['min_length', 'max_length', 'pattern']);
  assert.ok(f[1].values.every((x) => x.expected === null));
  assert.deepEqual(f[2].limits.map((x) => x.check), ['max_digits', 'decimal_places']);
  assert.equal(f[2].type, 'number');
  assert.deepEqual(f[3].values.map((x) => [x.value, x.expected]), [[2, 'invalid'], [3, 'valid'], [4, 'invalid']]);
  assert.deepEqual(f[4].limits, f[0].limits);
  assert.deepEqual(f[5].limits.map((x) => x.check), ['min_length', 'max_length', 'min_length', 'max_length']);
});

pythonTest('inherited validators and enum fields stay linked to their defining module', (t) => {
  const a = analyze(t, {
    'base.py': `from pydantic import BaseModel, Field, field_validator
from enum import Enum
class Color(Enum):
    RED = "red"
class Base(BaseModel):
    color: Color
    count: int = Field(ge=1)
    @field_validator("count")
    def check_count(cls, value): return value
`,
    'child.py': 'from base import Base\nclass Child(Base):\n    pass\n',
    'test_child.py': 'from child import Child\ndef test_negative():\n    assert -2\n',
  });
  const child = a.models.boundaries.find((x) => x.name === 'Child');
  assert.deepEqual(child.fields[0].members, ['red']);
  assert.ok(child.fields[1].values.every((x) => x.expected === null));
  assert.equal(child.fields[1].values.find((x) => x.value === 2).named, false);
});

pythonTest('collection item rules and unsafe integer limits remain unknown', (t) => {
  const a = analyze(t, { 'model.py': `from pydantic import BaseModel, Field, conlist, conset
class Limits(BaseModel):
    custom: conlist(Custom, min_length=1)
    custom_set: conset(Custom, max_length=3)
    invalid: str = Field(min_length=1.5)
    huge: int = Field(ge=9007199254740993)
` });
  const fields = a.models.boundaries.find((x) => x.name === 'Limits').fields;
  assert.ok(fields.every((f) => f.state === 'UNKNOWN' && f.values.every((v) => v.expected === null)));
});

pythonTest('RootModel generics local constrained aliases and optional settings preserve literal evidence', (t) => {
  const a = analyze(t, {
    'pyproject.toml': '',
    'model.py': `from pydantic import BaseModel, RootModel, Field, conint
from pydantic_settings import BaseSettings
from typing import Annotated, Optional, Literal
Count = conint(ge=3)
class Holder(BaseModel):
    count: Count
    choice: Literal[True, False]
class Root(RootModel[Annotated[int, Field(gt=2)]]):
    pass
class Settings(BaseSettings):
    token: Optional[str] = None
    metadata: dict[str, str] = {}
`,
    'test_model.py': 'from model import Holder\ndef test_choice():\n    assert Holder(count=3, choice=True)\n',
  });
  const holder = a.models.boundaries.find((x) => x.name === 'Holder');
  assert.deepEqual(holder.fields[0].values.map((v) => v.value), [2, 3, 4]);
  assert.equal(holder.fields[1].values.find((v) => v.value === true).named, true);
  assert.equal(holder.fields[1].values.find((v) => v.value === false).named, false);
  assert.deepEqual(a.models.boundaries.find((x) => x.name === 'Root').fields[0].values.map((v) => v.value), [1, 2, 3]);
  assert.deepEqual(a.frameworks.env.reads.map((r) => r.name), ['token', 'metadata']);
});

pythonTest('version one inferred fields null literals and keyword metadata retain known rules', (t) => {
  const a = analyze(t, {
    'model.py': `from pydantic import BaseModel, Field
from typing import Literal, Annotated
from annotated_types import Gt
class Older(BaseModel):
    flag = Field(4, const=True)
    text = Field("x", regex="^x")
    none: Literal[None]
    count: Annotated[int, Gt(gt=2)]
def factory():
    class Local(BaseModel):
        count: int = Field(ge=2)
    return Local
`,
    'test_model.py': 'from model import Older\ndef test_none():\n    assert Older(flag=4, none=None, count=3)\n',
  });
  const older = a.models.boundaries.find((m) => m.name === 'Older');
  assert.deepEqual(older.fields.find((f) => f.path === 'flag').members, [4]);
  assert.deepEqual(older.fields.find((f) => f.path === 'flag').versions, ['v1']);
  assert.deepEqual(older.fields.find((f) => f.path === 'text').limits.map((l) => l.check), ['regex']);
  assert.equal(older.fields.find((f) => f.path === 'none').values[0].named, true);
  assert.deepEqual(older.fields.find((f) => f.path === 'count').values.map((v) => [v.value, v.expected]), [[1, 'invalid'], [2, 'invalid'], [3, 'valid']]);
  assert.deepEqual(a.models.boundaries.find((m) => m.name === 'Local').fields[0].values.map((v) => v.value), [1, 2, 3]);
});

pythonTest('ambiguous class definitions and version one validators cannot claim known outcomes', (t) => {
  const a = analyze(t, { 'model.py': `from pydantic.v1 import BaseModel, Field, validator
class Duplicate(BaseModel):
    a: int = Field(ge=1)
class Duplicate(BaseModel):
    b: int = Field(ge=2)
class Checked(BaseModel):
    a: int = Field(ge=1)
    @validator("a")
    def validate_a(cls, value): return value
` });
  assert.ok(!a.models.boundaries.some((m) => m.name === 'Duplicate'));
  assert.equal(a.models.errors.filter((e) => e.name === 'Duplicate' && e.state === 'UNKNOWN').length, 2);
  assert.ok(a.models.boundaries.find((m) => m.name === 'Checked').fields[0].values.every((v) => v.expected === null));
});

pythonTest('custom type names that match JavaScript object properties remain unknown', (t) => {
  const a = analyze(t, { 'model.py': 'from pydantic import BaseModel\nclass constructor:\n    pass\nclass Model(BaseModel):\n    item: constructor\n' });
  const field = a.models.boundaries.find((m) => m.name === 'Model').fields[0];
  assert.equal(field.state, 'UNKNOWN');
  assert.deepEqual(field.members, []);
});

pythonTest('a function parameter that shadows a model base leaves the local class unknown', (t) => {
  const a = analyze(t, { 'model.py': 'from pydantic import BaseModel, Field\ndef factory(BaseModel):\n    class Local(BaseModel):\n        count: int = Field(ge=1)\n    return Local\n' });
  assert.ok(!a.models.boundaries.some((m) => m.name === 'Local'));
  assert.ok(a.models.errors.some((m) => m.name === 'Local' && m.state === 'UNKNOWN'));
});

pythonTest('unread Pydantic metadata cannot invent constraints or claim valid values', (t) => {
  const a = analyze(t, { 'model.py': 'import pydantic as p\nfrom typing import Annotated\ndef check(value):\n    return value\nclass Model(p.BaseModel):\n    before: Annotated[int, p.Field(ge=1), p.BeforeValidator(check)]\n    default: int = p.Custom(gt=5)\n' });
  const fields = a.models.boundaries.find((m) => m.name === 'Model').fields;
  assert.ok(fields[0].unknown.includes('custom-metadata:pydantic.BeforeValidator'));
  assert.ok(fields[0].values.every((v) => v.expected === null));
  assert.deepEqual(fields[1].limits, []);
  assert.equal(fields[1].state, 'UNKNOWN');
});
