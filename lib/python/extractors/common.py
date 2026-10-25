import ast
import re
from collections import deque
from functools import lru_cache

# Fixed Python 3.8/3.9 fallback. New interpreters provide their own exact set.
STDLIB = set(('abc argparse array ast asyncio atexit base64 bdb binascii bisect builtins bz2 calendar cgi '
             'cgitb chunk cmath cmd code codecs codeop collections colorsys compileall concurrent configparser '
             'contextlib contextvars copy copyreg cProfile csv ctypes curses dataclasses datetime dbm decimal '
             'difflib dis distutils doctest email encodings ensurepip enum errno faulthandler fcntl filecmp '
             'fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob graphlib grp gzip '
             'hashlib heapq hmac html http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools '
             'json keyword lib2to3 linecache locale logging lzma mailbox mailcap marshal math mimetypes mmap '
             'modulefinder multiprocessing netrc nis nntplib numbers operator optparse os pathlib pdb pickle '
             'pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd '
             'py_compile pyclbr pydoc queue quopri random re readline reprlib resource rlcomple rlcompleter '
             'runpy sched secrets select selectors shelve shlex shutil signal site smtpd smtplib sndhdr socket '
             'socketserver spwd sqlite3 ssl stat statistics string stringprep struct subprocess sunau symbol '
             'symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios test textwrap threading '
             'time timeit tkinter token tokenize trace traceback tracemalloc tty turtle turtledemo types '
             'typing unicodedata unittest urllib uu uuid venv warnings wave weakref webbrowser wsgiref xdrlib '
             'xml xmlrpc zipapp zipfile zipimport zlib zoneinfo __future__').split())
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)
DEFINITIONS = FUNCTIONS + (ast.ClassDef,)


def children(node):
    """Cache child enumeration without changing AST fields or traversal order."""
    cached = getattr(node, '_code_map_children', None)
    if cached is None:
        cached = tuple(ast.iter_child_nodes(node))
        node._code_map_children = cached
    return cached


class NodeIndex:
    """Select node kinds while retaining the supplied traversal order."""
    def __init__(self, nodes):
        self.nodes = list(nodes)
        self.by_type, self.selections = {}, {}
        for position, node in enumerate(self.nodes):
            self.by_type.setdefault(type(node), []).append((position, node))

    def select(self, kinds):
        if not isinstance(kinds, tuple):
            kinds = (kinds,)
        if kinds not in self.selections:
            matches = [item for kind, items in self.by_type.items() if issubclass(kind, kinds) for item in items]
            self.selections[kinds] = [node for _, node in sorted(matches, key=lambda item: item[0])]
        return self.selections[kinds]


@lru_cache(maxsize=1)
def traversal(tree):
    # Keep only the current file. The parent map follows ast.walk's BFS order,
    # including its last parent for shared operator and context singleton nodes.
    ordered, parents = [], {}
    pending = deque([tree])
    while pending:
        node = pending.popleft()
        ordered.append(node)
        for child in children(node):
            parents[child] = node
            pending.append(child)
    return NodeIndex(ordered), parents


def walk(tree):
    return traversal(tree)[0].nodes


def parents(tree):
    return traversal(tree)[1]


def nodes(tree, kinds):
    return traversal(tree)[0].select(kinds)


@lru_cache(maxsize=1)
def source_lines(text):
    # Python source lines end only at CR, LF or CRLF, not at form feed or the
    # Unicode separators that str.splitlines also treats as line boundaries.
    return [match[0].encode('utf-8') for match in re.finditer(r'.*?(?:\r\n|\n|\r|$)', text)]


def source_segment(text, node):
    if node is None or any(getattr(node, key, None) is None for key in ('lineno', 'end_lineno', 'col_offset', 'end_col_offset')):
        return None
    lines = source_lines(text)
    start, end = node.lineno - 1, node.end_lineno - 1
    if start == end:
        return lines[start][node.col_offset:node.end_col_offset].decode('utf-8')
    return b''.join([lines[start][node.col_offset:], *lines[start + 1:end], lines[end][:node.end_col_offset]]).decode('utf-8')


def dotted(node):
    cached = getattr(node, '_code_map_dotted', None)
    if cached is not None:
        return cached
    if isinstance(node, ast.Call):
        value = dotted(node.func)
    elif isinstance(node, ast.Name):
        value = node.id
    elif isinstance(node, ast.Attribute):
        value = dotted(node.value) + '.' + node.attr
    else:
        return ''
    node._code_map_dotted = value
    return value
