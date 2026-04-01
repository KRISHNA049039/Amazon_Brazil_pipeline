package com.amzn.accounting.comparator;

import com.amzn.accounting.model.*;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Compares GL trial balance entries against register balances.
 * Identifies variances per account and determines if the TB is balanced.
 *
 * Tolerance: variances within 0.01 (1 cent) are considered immaterial.
 */
public class TrialBalanceComparator {

    private static final BigDecimal TOLERANCE = new BigDecimal("0.01");

    /**
     * Compare GL trial balance against register-derived balances for a geo/period.
     */
    public ComparisonResult compare(
            List<TrialBalanceEntry> glTrialBalance,
            Map<String, BigDecimal> registerBalances,
            String geoCode,
            String period) {

        BigDecimal totalDebits = BigDecimal.ZERO;
        BigDecimal totalCredits = BigDecimal.ZERO;
        List<ComparisonResult.AccountVariance> variances = new ArrayList<>();

        for (TrialBalanceEntry entry : glTrialBalance) {
            totalDebits = totalDebits.add(entry.debitBalance());
            totalCredits = totalCredits.add(entry.creditBalance());

            BigDecimal regBalance = registerBalances.getOrDefault(
                entry.accountId(), BigDecimal.ZERO);
            BigDecimal glBalance = entry.netBalance();
            BigDecimal variance = glBalance.subtract(regBalance).abs();

            variances.add(new ComparisonResult.AccountVariance(
                entry.accountId(),
                entry.accountName(),
                entry.accountType(),
                glBalance,
                regBalance,
                variance,
                variance.compareTo(TOLERANCE) <= 0
            ));
        }

        BigDecimal totalVariance = totalDebits.subtract(totalCredits).abs();
        boolean balanced = totalVariance.compareTo(TOLERANCE) <= 0;

        return new ComparisonResult(
            geoCode, period, balanced,
            totalDebits, totalCredits, totalVariance,
            variances
        );
    }
}
