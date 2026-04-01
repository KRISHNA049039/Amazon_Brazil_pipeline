package com.amzn.accounting.comparator;

import com.amzn.accounting.model.*;
import org.junit.Test;
import static org.junit.Assert.*;

import java.math.BigDecimal;
import java.util.*;

public class TrialBalanceComparatorTest {

    private final TrialBalanceComparator comparator = new TrialBalanceComparator();

    @Test
    public void testBalancedTrialBalance() {
        List<TrialBalanceEntry> tb = List.of(
            new TrialBalanceEntry("1000", "Cash", AccountType.ASSET,
                new BigDecimal("50000"), new BigDecimal("10000"), null, "2026-03", "US"),
            new TrialBalanceEntry("2000", "AP", AccountType.LIABILITY,
                new BigDecimal("5000"), new BigDecimal("35000"), null, "2026-03", "US"),
            new TrialBalanceEntry("3000", "Equity", AccountType.EQUITY,
                new BigDecimal("0"), new BigDecimal("5000"), null, "2026-03", "US")
        );

        Map<String, BigDecimal> registerBalances = Map.of(
            "1000", new BigDecimal("40000"),
            "2000", new BigDecimal("-30000"),
            "3000", new BigDecimal("-5000")
        );

        ComparisonResult result = comparator.compare(tb, registerBalances, "US", "2026-03");

        assertEquals("US", result.geoCode());
        assertEquals(3, result.accountVariances().size());
        assertEquals(new BigDecimal("55000"), result.totalDebits());
        assertEquals(new BigDecimal("50000"), result.totalCredits());
    }

    @Test
    public void testVarianceDetection() {
        List<TrialBalanceEntry> tb = List.of(
            new TrialBalanceEntry("1000", "Cash", AccountType.ASSET,
                new BigDecimal("100"), new BigDecimal("0"), null, "2026-03", "US")
        );

        Map<String, BigDecimal> registerBalances = Map.of(
            "1000", new BigDecimal("95")  // 5.00 variance
        );

        ComparisonResult result = comparator.compare(tb, registerBalances, "US", "2026-03");
        assertFalse(result.accountVariances().get(0).withinTolerance());
        assertEquals(new BigDecimal("5"), result.accountVariances().get(0).variance());
    }

    @Test
    public void testEmptyTrialBalance() {
        ComparisonResult result = comparator.compare(
            List.of(), Map.of(), "US", "2026-03");
        assertTrue(result.balanced());
        assertTrue(result.accountVariances().isEmpty());
    }
}
