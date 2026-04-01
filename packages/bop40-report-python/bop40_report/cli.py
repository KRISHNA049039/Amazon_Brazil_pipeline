"""CLI entry point for BOP 40 report generation."""

import sys
from decimal import Decimal
from .models import (
    Bop40Report, BopSection, BopLineItem, TrialBalanceEntry,
    AccountType, BOP40_GEOS, GEO_CURRENCIES,
)
from .excel_writer import Bop40ExcelWriter


def build_sample_report(geo: str, period: str, fiscal_year: str) -> Bop40Report:
    """Build a sample BOP 40 report with representative data."""
    currency = GEO_CURRENCIES[geo]

    # Sample trial balance data per geo (scaled by geo)
    multiplier = {"US": 1, "EU": 0.92, "JP": 150, "IN": 83, "BR": 5}[geo]
    m = Decimal(str(multiplier))

    assets = BopSection("Assets", geo, period, [
        BopLineItem("1100", "Cash & Equivalents", 0, Decimal("500000") * m),
        BopLineItem("1200", "Accounts Receivable", 0, Decimal("350000") * m),
        BopLineItem("1300", "Inventory", 0, Decimal("200000") * m),
        BopLineItem("1400", "Prepaid Expenses", 0, Decimal("50000") * m),
        BopLineItem("", "Total Assets", 0, Decimal("1100000") * m, True),
    ], Decimal("1100000") * m)

    liabilities = BopSection("Liabilities", geo, period, [
        BopLineItem("2100", "Accounts Payable", 0, Decimal("300000") * m),
        BopLineItem("2200", "Accrued Expenses", 0, Decimal("150000") * m),
        BopLineItem("2300", "Long-term Debt", 0, Decimal("200000") * m),
        BopLineItem("", "Total Liabilities", 0, Decimal("650000") * m, True),
    ], Decimal("650000") * m)

    equity_section = BopSection("Equity", geo, period, [
        BopLineItem("3100", "Common Stock", 0, Decimal("100000") * m),
        BopLineItem("3200", "Retained Earnings", 0, Decimal("350000") * m),
        BopLineItem("", "Total Equity", 0, Decimal("450000") * m, True),
    ], Decimal("450000") * m)

    revenue = BopSection("Revenue", geo, period, [
        BopLineItem("4100", "Product Sales", 0, Decimal("2000000") * m),
        BopLineItem("4200", "Service Revenue", 0, Decimal("500000") * m),
        BopLineItem("", "Total Revenue", 0, Decimal("2500000") * m, True),
    ], Decimal("2500000") * m)

    expenses = BopSection("Expenses", geo, period, [
        BopLineItem("5100", "Cost of Goods Sold", 0, Decimal("1500000") * m),
        BopLineItem("5200", "Operating Expenses", 0, Decimal("600000") * m),
        BopLineItem("5300", "Depreciation", 0, Decimal("100000") * m),
        BopLineItem("", "Total Expenses", 0, Decimal("2200000") * m, True),
    ], Decimal("2200000") * m)

    return Bop40Report(
        geo_code=geo, period=period, fiscal_year=fiscal_year, currency=currency,
        assets=assets, liabilities=liabilities, equity=equity_section,
        revenue=revenue, expenses=expenses,
        total_assets=assets.section_total,
        total_liabilities=liabilities.section_total,
        total_equity=equity_section.section_total,
        net_income=revenue.section_total - expenses.section_total,
        balance_sheet_check=assets.section_total - liabilities.section_total - equity_section.section_total,
    )


def main():
    period = sys.argv[1] if len(sys.argv) > 1 else "2026-03"
    fiscal_year = sys.argv[2] if len(sys.argv) > 2 else "2026"
    output = sys.argv[3] if len(sys.argv) > 3 else f"bop40_report_{period}.xlsx"

    print(f"Generating BOP 40 report for {period} (FY{fiscal_year})...")

    reports = {}
    for geo in BOP40_GEOS:
        reports[geo] = build_sample_report(geo, period, fiscal_year)
        print(f"  {geo}: Assets={reports[geo].total_assets:,.2f} {reports[geo].currency}")

    writer = Bop40ExcelWriter()
    writer.generate(reports, output)
    print(f"\nReport saved to {output}")


if __name__ == "__main__":
    main()
