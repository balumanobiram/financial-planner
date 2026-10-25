"""Guard tests: every table follows the project's data rules. New tables are checked automatically."""

import pytest
from sqlalchemy import DateTime, Numeric, Table, Uuid

from app.models import Base

TABLES = list(Base.metadata.sorted_tables)
ARCHIVABLE = {"bank_accounts"}  # add "cards", "people" as they arrive


@pytest.mark.parametrize("table", TABLES, ids=lambda t: t.name)
def test_has_uuid_pk_and_timestamps(table: Table) -> None:
    assert [c.name for c in table.primary_key.columns] == ["id"]
    assert isinstance(table.c.id.type, Uuid)
    for name in ("created_at", "updated_at"):
        column_type = table.c[name].type
        assert isinstance(column_type, DateTime) and column_type.timezone, f"{name} must be timestamptz"


@pytest.mark.parametrize("table", TABLES, ids=lambda t: t.name)
def test_money_columns_are_numeric_14_2(table: Table) -> None:
    for column in table.columns:
        if isinstance(column.type, Numeric):
            assert (column.type.precision, column.type.scale) == (14, 2), column.name
            assert column.type.asdecimal, f"{column.name} must map to Decimal"


@pytest.mark.parametrize("name", sorted(ARCHIVABLE))
def test_archivable_tables_have_is_archived(name: str) -> None:
    column = Base.metadata.tables[name].c.is_archived
    assert not column.nullable
    assert column.server_default is not None
