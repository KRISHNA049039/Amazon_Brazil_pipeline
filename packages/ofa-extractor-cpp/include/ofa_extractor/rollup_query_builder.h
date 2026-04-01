#pragma once

#include "types.h"
#include <string>

namespace ofa {

/**
 * Builds recursive SQL queries for OFA rollup account hierarchies.
 * Uses Redshift recursive CTEs to traverse parent-child account trees.
 */
class RollupQueryBuilder {
public:
    explicit RollupQueryBuilder(const std::string& schema);

    /**
     * Build recursive CTE to resolve full account hierarchy for a geo.
     * Returns all accounts with their level and root ancestor.
     *
     * WITH RECURSIVE account_tree AS (
     *   SELECT account_id, account_name, parent_account_id, 0 AS level, account_id AS root_id
     *   FROM {schema}.gl_accounts
     *   WHERE parent_account_id IS NULL AND geo_code = '{geo}'
     *   UNION ALL
     *   SELECT c.account_id, c.account_name, c.parent_account_id, p.level + 1, p.root_id
     *   FROM {schema}.gl_accounts c
     *   JOIN account_tree p ON c.parent_account_id = p.account_id
     * )
     * SELECT * FROM account_tree ORDER BY root_id, level, account_id;
     */
    std::string build_rollup_hierarchy_query(const std::string& geo_code) const;

    /**
     * Build recursive rollup aggregation query.
     * Sums debit/credit from leaf accounts up through the hierarchy.
     *
     * Uses recursive CTE to walk from leaves to roots, aggregating balances.
     */
    std::string build_rollup_balance_query(const std::string& geo_code,
                                            const std::string& period) const;

    /**
     * Build query to extract GL transactions for a geo and period.
     */
    std::string build_gl_transactions_query(const std::string& geo_code,
                                             const std::string& period) const;

    /**
     * Build query to extract ledger entries for a geo.
     */
    std::string build_ledger_query(const std::string& geo_code,
                                    const std::string& fiscal_year) const;

    /**
     * Build query to extract register entries (period balances).
     */
    std::string build_register_query(const std::string& geo_code,
                                      const std::string& period) const;

    /**
     * Build trial balance query — aggregated debits/credits per account.
     */
    std::string build_trial_balance_query(const std::string& geo_code,
                                           const std::string& period) const;

private:
    std::string schema_;
};

} // namespace ofa
