package com.amzn.accounting.model;

import java.math.BigDecimal;
import java.util.List;

/**
 * Result of comparing GL trial balance against ledger register balances.
 */
public record ComparisonResult(
    String geoCode,
    String period,
    boolean balanced,
    BigDecimal totalDebits,
    BigDecimal totalCredits,
    BigDecimal variance,
    List<AccountVariance> accountVariances
) {
    public record AccountVariance(
        String accountId,
        String accountName,
        AccountType accountType,
        BigDecimal glBalance,
        BigDecimal registerBalance,
        BigDecimal variance,
        boolean withinTolerance
    ) {}
}
