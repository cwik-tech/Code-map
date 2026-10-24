import ast

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


def dotted(node):
    if isinstance(node, ast.Call):
        return dotted(node.func)
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return dotted(node.value) + '.' + node.attr
    return ''
