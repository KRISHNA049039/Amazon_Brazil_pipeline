"""Tests for Excel report generation."""

import os
import tempfile
from decimal import Decimal
from bop40_report.models import Bop40Report, BopSection, BopLineItem, BOP40_GEOS
from bop40_report.excel_writer import Bop40ExcelWriter
from bop40_report.cli import build_sample_report


def test_generate_single_geo():
    report = build_sample_report("US", "2026-03", "2026")
    writer = Bop40ExcelWriter()

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
        path = f.name

    try:
        writer.generate({"US": report}, path)
        assert os.path.exists(path)
        assert os.path.getsize(path) > 0
    finally:
        os.unlink(path)


def test_generate_all_geos():
    reports = {geo: build_sample_report(geo, "2026-03", "2026") for geo in BOP40_GEOS}
    writer = Bop40ExcelWriter()

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
        path = f.name

    try:
        writer.generate(reports, path)
        assert os.path.exists(path)
        assert os.path.getsize(path) > 1000  # should be a real workbook
    finally:
        os.unlink(path)


def test_balance_sheet_balanced():
    """All sample reports should have BS check = 0."""
    for geo in BOP40_GEOS:
        report = build_sample_report(geo, "2026-03", "2026")
        assert report.balance_sheet_check == Decimal("0"), f"{geo} BS not balanced"
