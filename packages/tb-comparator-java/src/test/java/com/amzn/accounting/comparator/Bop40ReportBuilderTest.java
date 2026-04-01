package com.amzn.accounting.comparator;

import com.amzn.accounting.model.*;
import org.junit.Test;
import static org.junit.Assert.*;

import java.math.BigDecimal;
import java.util.*;

public class Bop40ReportBuilderTest {

    private final Bop40ReportBuilder builder = new Bop40ReportBuilder();

    @Test
    public void testBuildReport() {
        List<TrialBalanceEntry> tb = List.of(
            new TrialBalanceEntry("1000", "Cash", AccountType.ASSET,
                new BigDecimal("100000"), BigDecimal.ZERO, null, "2026-03", "US"),
            new TrialBalanceEntry("1100", "AR", AccountType.ASSET,
                new BigDecimal("50000"), BigDecimal.ZERO, null, "2026-03", "US"),
            new TrialBalanceEntry("2000", "AP", AccountType.LIABILITY,
                BigDecimal.ZERO, new BigDecimal("80000"), null, "2026-03", "US"),
            new TrialBalanceEntry("3000", "Retained Earnings", AccountType.EQUITY,
                BigDecimal.ZERO, new BigDecimal("30000"), null, "2026-03", "US"),
            new TrialBalanceEntry("4000", "Sales", AccountType.REVENUE,
                BigDecimal.ZERO, new BigDecimal("200000"), null, "2026-03", "US"),
            new TrialBalanceEntry("5000", "COGS", AccountType.EXPENSE,
                new BigDecimal("160000"), BigDecimal.ZERO, null, "2026-03", "US")
        );

        Bop40Report report = builder.buildReport(tb, "US", "2026-03", "2026");

        assertEquals("US", report.geoCode());
        assertEquals("USD", report.currency());
        assertEquals(new BigDecimal("150000"), report.totalAssets());
        assertEquals(new BigDecimal("80000"), report.totalLiabilities());
        assertEquals(new BigDecimal("30000"), report.totalEquity());
        assertEquals(new BigDecimal("40000"), report.netIncome()); // 200k - 160k

        // Assets section should have 3 line items (2 accounts + total)
        assertEquals(3, report.assets().lineItems().size());
    }

    @Test
    public void testBuildAllGeoReports() {
        Map<String, List<TrialBalanceEntry>> byGeo = new HashMap<>();
        for (String geo : List.of("US", "EU", "JP", "IN", "BR")) {
            byGeo.put(geo, List.of(
                new TrialBalanceEntry("1000", "Cash", AccountType.ASSET,
                    new BigDecimal("10000"), BigDecimal.ZERO, null, "2026-03", geo)
            ));
        }

        Map<String, Bop40Report> reports = builder.buildAllGeoReports(byGeo, "2026-03", "2026");
        assertEquals(5, reports.size());
        assertTrue(reports.containsKey("US"));
        assertTrue(reports.containsKey("BR"));
        assertEquals("JPY", reports.get("JP").currency());
    }
}
