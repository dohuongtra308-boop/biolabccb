"""Lớp tương thích nhỏ để code SQLite hiện tại chạy trên PostgreSQL/psycopg."""

import re
from collections.abc import Mapping


class CompatRow(Mapping):
    def __init__(self, columns, values):
        self._columns = list(columns)
        self._values = tuple(values)
        self._data = dict(zip(self._columns, self._values))

    def __getitem__(self, key):
        return self._values[key] if isinstance(key, int) else self._data[key]

    def __iter__(self):
        return iter(self._columns)

    def __len__(self):
        return len(self._columns)


def translate_sql(sql):
    statement = sql
    pragma = re.fullmatch(r"\s*PRAGMA\s+table_info\(([^)]+)\)\s*", statement, re.I)
    if pragma:
        table = pragma.group(1).strip().strip('"')
        return """
            SELECT ordinal_position - 1 AS cid, column_name AS name,
                   data_type AS type, CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END AS notnull,
                   column_default AS dflt_value, 0 AS pk
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name=%s
            ORDER BY ordinal_position
        """, (table,)

    statement = re.sub(
        r"INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT",
        "SERIAL PRIMARY KEY",
        statement,
        flags=re.I,
    )
    statement = statement.replace("?", "%s")
    statement = re.sub(r"\bMAX\(0\s*,", "GREATEST(0,", statement, flags=re.I)
    statement = re.sub(r"\bMIN\(total_qty\s*,", "LEAST(total_qty,", statement, flags=re.I)

    if re.search(r"\bINSERT\s+OR\s+IGNORE\b", statement, re.I):
        statement = re.sub(r"\bINSERT\s+OR\s+IGNORE\b", "INSERT", statement, flags=re.I)
        statement = statement.rstrip().rstrip(";") + " ON CONFLICT DO NOTHING"
    return statement, None


class CompatCursor:
    def __init__(self, cursor):
        self._cursor = cursor

    def execute(self, sql, params=()):
        translated, forced_params = translate_sql(sql)
        self._cursor.execute(translated, forced_params if forced_params is not None else params)
        return self

    def executemany(self, sql, params_seq):
        translated, forced_params = translate_sql(sql)
        if forced_params is not None:
            for _ in params_seq:
                self._cursor.execute(translated, forced_params)
        else:
            self._cursor.executemany(translated, params_seq)
        return self

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def _columns(self):
        return [column.name for column in (self._cursor.description or [])]

    def fetchone(self):
        row = self._cursor.fetchone()
        return None if row is None else CompatRow(self._columns(), row)

    def fetchall(self):
        columns = self._columns()
        return [CompatRow(columns, row) for row in self._cursor.fetchall()]

    def __iter__(self):
        columns = self._columns()
        for row in self._cursor:
            yield CompatRow(columns, row)


class CompatConnection:
    def __init__(self, connection):
        self._connection = connection

    def cursor(self):
        return CompatCursor(self._connection.cursor())

    def execute(self, sql, params=()):
        return self.cursor().execute(sql, params)

    def commit(self):
        self._connection.commit()

    def rollback(self):
        self._connection.rollback()

    def close(self):
        self._connection.close()


def connect_postgres(database_url):
    import psycopg

    return CompatConnection(psycopg.connect(database_url))
