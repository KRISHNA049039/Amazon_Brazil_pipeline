package com.amzn.accounting.model;

import java.math.BigDecimal;

/**
 * Complete BOP 40 report for a single geo and period.
 * Contains all 5 financial statement sections.
 */
public record Bop40Report(
    String geoCode,
    String period,
    String fiscalYear,
    String currency,
    BopSection assets,
    BopSection liabilities,
    BopSection equity,
    BopSection revenue,
    BopSection expenses,
    // Derived totals
    BigDecimal totalAssets,
    BigDecimal totalLiabilities,
    BigDecimal totalEquity,
    BigDecimal netIncome,          // revenue - expenses
    BigDecimal balanceSheetCheck   // assets - (liabilities + equity) should = 0
) {}
