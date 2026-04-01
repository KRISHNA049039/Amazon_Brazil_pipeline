package com.amzn.accounting.comparator;

import com.amzn.accounting.model.*;

import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Builds BOP 40 report sections from trial balance data.
 * Groups accounts by type, computes section totals, and validates
 * the accounting equation: Assets = Liabilities + Equity.
 */
public class Bop40ReportBuilder {

    private static final Map<String, String> GEO_CURRENCIES = Map.of(
        "US", "USD", "EU", "EUR", "JP", "JPY", "IN", "INR", "BR", "BRL"
    );

    public Bop40Report buildReport(
            List<TrialBalanceEntry> trialBalance,
            String geoCode,
            String period,
            String fiscalYear) {

        // Group by account type
        Map<AccountType, List<TrialBalanceEntry>> grouped = trialBalance.stream()
            .collect(Collectors.groupingBy(TrialBalanceEntry::accountType));

        BopSection assets = buildSection("Assets", geoCode, period,
            grouped.getOrDefault(AccountType.ASSET, List.of()));
        BopSection liabilities = buildSection("Liabilities", geoCode, period,
            grouped.getOrDefault(AccountType.LIABILITY, List.of()));
        BopSection equity = buildSection("Equity", geoCode, period,
            grouped.getOrDefault(AccountType.EQUITY, List.of()));
        BopSection revenue = buildSection("Revenue", geoCode, period,
            grouped.getOrDefault(AccountType.REVENUE, List.of()));
        BopSection expenses = buildSection("Expenses", geoCode, period,
            grouped.getOrDefault(AccountType.EXPENSE, List.of()));

        BigDecimal totalAssets = assets.sectionTotal();
        BigDecimal totalLiabilities = liabilities.sectionTotal();
        BigDecimal totalEquity = equity.sectionTotal();
        BigDecimal netIncome = revenue.sectionTotal().subtract(expenses.sectionTotal());
        BigDecimal bsCheck = totalAssets.subtract(totalLiabilities.add(totalEquity));

        return new Bop40Report(
            geoCode, period, fiscalYear,
            GEO_CURRENCIES.getOrDefault(geoCode, "USD"),
            assets, liabilities, equity, revenue, expenses,
            totalAssets, totalLiabilities, totalEquity,
            netIncome, bsCheck
        );
    }

    /** Build reports for all 5 BOP 40 geos */
    public Map<String, Bop40Report> buildAllGeoReports(
            Map<String, List<TrialBalanceEntry>> trialBalanceByGeo,
            String period,
            String fiscalYear) {

        Map<String, Bop40Report> reports = new LinkedHashMap<>();
        for (String geo : List.of("US", "EU", "JP", "IN", "BR")) {
            List<TrialBalanceEntry> tb = trialBalanceByGeo.getOrDefault(geo, List.of());
            if (!tb.isEmpty()) {
                reports.put(geo, buildReport(tb, geo, period, fiscalYear));
            }
        }
        return reports;
    }

    private BopSection buildSection(
            String sectionName,
            String geoCode,
            String period,
            List<TrialBalanceEntry> entries) {

        List<BopSection.BopLineItem> lineItems = entries.stream()
            .map(e -> new BopSection.BopLineItem(
                e.accountId(),
                e.accountName(),
                0, // rollup level — would come from hierarchy data
                e.normalBalance(),
                false
            ))
            .collect(Collectors.toList());

        BigDecimal total = lineItems.stream()
            .map(BopSection.BopLineItem::amount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);

        // Add section total line
        lineItems.add(new BopSection.BopLineItem(
            "", "Total " + sectionName, 0, total, true));

        return new BopSection(sectionName, geoCode, period, lineItems, total);
    }
}
