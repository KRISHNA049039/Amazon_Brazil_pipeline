"""Domain models for BOP 40 financial reporting."""

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Optional


class AccountType(Enum):
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    REVENUE = "REVENUE"
    EXPENSE = "EXPENSE"


BOP40_GEOS = ["US", "EU", "JP", "IN", "BR"]

GEO_CURRENCIES = {
    "US": "USD", "EU": "EUR", "JP": "JPY", "IN": "INR", "BR": "BRL"
}


@dataclass
class TrialBalanceEntry:
    account_id: str
    account_name: str
    account_type: AccountType
    debit_balance: Decimal
    credit_balance: Decimal
    period: str
    geo_code: str
    rollup_level: int = 0
    parent_account_id: Optional[str] = None

    @property
    def net_balance(self) -> Decimal:
        return self.debit_balance - self.credit_balance

    @property
    def normal_balance(self) -> Decimal:
        """Balance using normal balance convention (positive = expected side)."""
        if self.account_type in (AccountType.ASSET, AccountType.EXPENSE):
            return self.net_balance
        return -self.net_balance


@dataclass
class BopLineItem:
    account_id: str
    account_name: str
    rollup_level: int
    amount: Decimal
    is_rollup_total: bool = False


@dataclass
class BopSection:
    section_name: str
    geo_code: str
    period: str
    line_items: list[BopLineItem] = field(default_factory=list)
    section_total: Decimal = Decimal("0")


@dataclass
class Bop40Report:
    geo_code: str
    period: str
    fiscal_year: str
    currency: str
    assets: BopSection
    liabilities: BopSection
    equity: BopSection
    revenue: BopSection
    expenses: BopSection
    total_assets: Decimal = Decimal("0")
    total_liabilities: Decimal = Decimal("0")
    total_equity: Decimal = Decimal("0")
    net_income: Decimal = Decimal("0")
    balance_sheet_check: Decimal = Decimal("0")
