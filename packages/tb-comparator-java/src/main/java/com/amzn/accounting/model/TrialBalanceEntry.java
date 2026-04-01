package com.amzn.accounting.model;

import java.math.BigDecimal;

/**
 * Single row in a trial balance — one account's debit/credit totals for a period.
 */
public record TrialBalanceEntry(
    String accountId,
    String accountName,
    AccountType accountType,
    BigDecimal debitBalance,
    BigDecimal creditBalance,
    BigDecimal netBalance,
    String period,
    String geoCode
) {
    public TrialBalanceEntry {
        if (netBalance == null) {
            netBalance = debitBalance.subtract(creditBalance);
        }
    }

    /** Absolute balance using normal balance convention */
    public BigDecimal normalBalance() {
        return accountType.getNormalBalance().equals("DEBIT")
            ? netBalance
            : netBalance.negate();
    }
}
