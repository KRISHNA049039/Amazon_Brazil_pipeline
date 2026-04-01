package com.amzn.accounting.model;

public enum AccountType {
    ASSET,
    LIABILITY,
    EQUITY,
    REVENUE,
    EXPENSE;

    /** Classify into BOP 40 report section */
    public String getBopSection() {
        return switch (this) {
            case ASSET -> "BALANCE_SHEET_ASSETS";
            case LIABILITY -> "BALANCE_SHEET_LIABILITIES";
            case EQUITY -> "BALANCE_SHEET_EQUITY";
            case REVENUE -> "PROFIT_LOSS_REVENUE";
            case EXPENSE -> "PROFIT_LOSS_EXPENSE";
        };
    }

    /** Normal balance side for this account type */
    public String getNormalBalance() {
        return switch (this) {
            case ASSET, EXPENSE -> "DEBIT";
            case LIABILITY, EQUITY, REVENUE -> "CREDIT";
        };
    }
}
