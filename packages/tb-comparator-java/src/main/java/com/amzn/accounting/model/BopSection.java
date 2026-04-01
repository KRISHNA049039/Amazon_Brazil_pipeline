package com.amzn.accounting.model;

import java.math.BigDecimal;
import java.util.List;

/**
 * A section of the BOP 40 report (e.g., Balance Sheet - Assets).
 */
public record BopSection(
    String sectionName,
    String geoCode,
    String period,
    List<BopLineItem> lineItems,
    BigDecimal sectionTotal
) {
    public record BopLineItem(
        String accountId,
        String accountName,
        int rollupLevel,
        BigDecimal amount,
        boolean isRollupTotal
    ) {}
}
