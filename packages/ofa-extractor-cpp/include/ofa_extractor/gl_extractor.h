#pragma once

#include "types.h"
#include "redshift_client.h"
#include "rollup_query_builder.h"
#include <vector>

namespace ofa {

/**
 * Extracts OFA GL data from FAST Redshift for BOP 40 reporting.
 * Handles all 5 geos: US, EU, JP, IN, BR.
 */
class GLExtractor {
public:
    GLExtractor(RedshiftClient& client, const std::string& schema);

    // Extract rollup account hierarchy (recursive) for a geo
    std::vector<GLAccount> extract_rollup_accounts(const std::string& geo_code);

    // Extract GL transactions for a geo and period
    std::vector<GLTransaction> extract_transactions(const std::string& geo_code,
                                                     const std::string& period);

    // Extract ledger entries for a geo and fiscal year
    std::vector<LedgerEntry> extract_ledgers(const std::string& geo_code,
                                              const std::string& fiscal_year);

    // Extract register entries for a geo and period
    std::vector<RegisterEntry> extract_registers(const std::string& geo_code,
                                                  const std::string& period);

    // Extract trial balance for a geo and period
    std::vector<TrialBalanceRow> extract_trial_balance(const std::string& geo_code,
                                                        const std::string& period);

    // Build rollup tree from flat account list
    RollupNode build_rollup_tree(const std::vector<GLAccount>& accounts,
                                  const std::vector<TrialBalanceRow>& tb_rows);

    // Extract all frames for a geo and period (full extraction)
    struct ExtractionResult {
        std::string geo_code;
        std::string period;
        std::vector<GLAccount> accounts;
        std::vector<GLTransaction> transactions;
        std::vector<LedgerEntry> ledgers;
        std::vector<RegisterEntry> registers;
        std::vector<TrialBalanceRow> trial_balance;
        RollupNode rollup_tree;
    };

    ExtractionResult extract_all(const std::string& geo_code,
                                  const std::string& period,
                                  const std::string& fiscal_year);

private:
    RedshiftClient& client_;
    RollupQueryBuilder query_builder_;
};

} // namespace ofa
