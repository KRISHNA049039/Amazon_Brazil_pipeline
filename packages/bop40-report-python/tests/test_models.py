"""Tests for BOP 40 models and report builder."""

from decimal import Decimal
from bop40_report.models import (
    TrialBalanceEntry, AccountType, BopLineItem, BopSection,
    Bop40Report, BOP40_GEOS, GEO_CURRENCIES,
)


def test_trial_balance_net_balance():
    entry = TrialBalanceEntry(
        "1000", "Cash", AccountType.ASSET,
        Decimal("50000"), Decimal("10000"), "2026-03", "US"
    )
    assert entry.net_balance == Decimal("40000")


def test_normal_balance_asset():
    entry = TrialBalanceEntry(
        "1000", "Cash", AccountType.ASSET,
        Decimal("50000"), Decimal("10000"), "2026-03", "US"
    )
    assert entry.normal_balance == Decimal("40000")  # debit normal


def test_normal_balance_liability():
    entry = TrialBalanceEntry(
        "2000", "AP", AccountType.LIABILITY,
        Decimal("5000"), Decimal("30000"), "2026-03", "US"
    )
    assert entry.normal_balance == Decimal("25000")  # credit normal, negated


def test_bop40_geos():
    assert len(BOP40_GEOS) == 5
    assert "US" in BOP40_GEOS
    assert "BR" in BOP40_GEOS


def test_geo_currencies():
    assert GEO_CURRENCIES["JP"] == "JPY"
    assert GEO_CURRENCIES["IN"] == "INR"


def test_balance_sheet_check():
    """Assets - Liabilities - Equity should = 0 for a balanced sheet."""
    report = Bop40Report(
        geo_code="US", period="2026-03", fiscal_year="2026", currency="USD",
        assets=BopSection("Assets", "US", "2026-03", [], Decimal("1000")),
        liabilities=BopSection("Liabilities", "US", "2026-03", [], Decimal("600")),
        equity=BopSection("Equity", "US", "2026-03", [], Decimal("400")),
        revenue=BopSection("Revenue", "US", "2026-03", [], Decimal("500")),
        expenses=BopSection("Expenses", "US", "2026-03", [], Decimal("300")),
        total_assets=Decimal("1000"),
        total_liabilities=Decimal("600"),
        total_equity=Decimal("400"),
        net_income=Decimal("200"),
        balance_sheet_check=Decimal("0"),
    )
    assert report.balance_sheet_check == Decimal("0")
