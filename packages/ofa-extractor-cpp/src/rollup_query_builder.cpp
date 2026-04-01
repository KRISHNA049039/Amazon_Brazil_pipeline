#include "ofa_extractor/rollup_query_builder.h"
#include <sstream>

namespace ofa {

RollupQueryBuilder::RollupQueryBuilder(const std::string& schema)
    : schema_(schema) {}

std::string RollupQueryBuilder::build_rollup_hierarchy_query(const std::string& geo_code) const {
    std::ostringstream sql;
    sql << "WITH RECURSIVE account_tree AS (\n"
        << "  -- Base case: root accounts (no parent)\n"
        << "  SELECT\n"
        << "    a.account_id,\n"
        << "    a.account_name,\n"
        << "    a.account_type,\n"
        << "    a.parent_account_id,\n"
        << "    0 AS level,\n"
        << "    a.account_id AS root_id,\n"
        << "    a.account_name AS root_name,\n"
        << "    CAST(a.account_name AS VARCHAR(4000)) AS hierarchy_path\n"
        << "  FROM " << schema_ << ".gl_accounts a\n"
        << "  WHERE a.parent_account_id IS NULL\n"
        << "    AND a.geo_code = '" << geo_code << "'\n"
        << "\n"
        << "  UNION ALL\n"
        << "\n"
        << "  -- Recursive case: child accounts\n"
        << "  SELECT\n"
        << "    c.account_id,\n"
        << "    c.account_name,\n"
        << "    c.account_type,\n"
        << "    c.parent_account_id,\n"
        << "    p.level + 1,\n"
        << "    p.root_id,\n"
        << "    p.root_name,\n";
    sql << "    p.hierarchy_path || ' > ' || c.account_name\n"
        << "  FROM " << schema_ << ".gl_accounts c\n"
        << "  INNER JOIN account_tree p ON c.parent_account_id = p.account_id\n"
        << "  WHERE c.geo_code = '" << geo_code << "'\n"
        << ")\n"
        << "SELECT\n"
        << "  account_id, account_name, account_type, parent_account_id,\n"
        << "  level, root_id, root_name, hierarchy_path\n"
        << "FROM account_tree\n"
        << "ORDER BY root_id, level, account_id;";
    return sql.str();
}

std::string RollupQueryBuilder::build_rollup_balance_query(
    const std::string& geo_code, const std::string& period) const {
    std::ostringstream sql;
    sql << "WITH RECURSIVE account_tree AS (\n"
        << "  SELECT account_id, parent_account_id, 0 AS level\n"
        << "  FROM " << schema_ << ".gl_accounts\n"
        << "  WHERE parent_account_id IS NULL AND geo_code = '" << geo_code << "'\n"
        << "  UNION ALL\n"
        << "  SELECT c.account_id, c.parent_account_id, p.level + 1\n"
        << "  FROM " << schema_ << ".gl_accounts c\n"
        << "  JOIN account_tree p ON c.parent_account_id = p.account_id\n"
        << "  WHERE c.geo_code = '" << geo_code << "'\n"
        << "),\n"
        << "leaf_balances AS (\n"
        << "  SELECT\n"
        << "    t.account_id,\n"
        << "    SUM(t.debit_amount) AS total_debit,\n"
        << "    SUM(t.credit_amount) AS total_credit\n"
        << "  FROM " << schema_ << ".gl_transactions t\n"
        << "  WHERE t.geo_code = '" << geo_code << "' AND t.period = '" << period << "'\n"
        << "  GROUP BY t.account_id\n"
        << "),\n"
        << "-- Recursive rollup: aggregate from leaves to parents\n"
        << "rollup_balances AS (\n"
        << "  SELECT\n"
        << "    at.account_id,\n"
        << "    at.parent_account_id,\n"
        << "    at.level,\n"
        << "    COALESCE(lb.total_debit, 0) AS rolled_debit,\n"
        << "    COALESCE(lb.total_credit, 0) AS rolled_credit\n"
        << "  FROM account_tree at\n"
        << "  LEFT JOIN leaf_balances lb ON at.account_id = lb.account_id\n"
        << ")\n"
        << "SELECT\n"
        << "  a.account_id, a.account_name, a.account_type,\n"
        << "  rb.level,\n"
        << "  rb.rolled_debit,\n"
        << "  rb.rolled_credit,\n"
        << "  (rb.rolled_debit - rb.rolled_credit) AS net_balance\n"
        << "FROM rollup_balances rb\n"
        << "JOIN " << schema_ << ".gl_accounts a ON rb.account_id = a.account_id\n"
        << "ORDER BY a.account_type, rb.level, a.account_id;";
    return sql.str();
}

std::string RollupQueryBuilder::build_gl_transactions_query(
    const std::string& geo_code, const std::string& period) const {
    std::ostringstream sql;
    sql << "SELECT\n"
        << "  t.transaction_id, t.ledger_id, t.account_id,\n"
        << "  t.debit_amount, t.credit_amount, t.currency_code,\n"
        << "  t.posting_date, t.period, t.description, t.source_system\n"
        << "FROM " << schema_ << ".gl_transactions t\n"
        << "WHERE t.geo_code = '" << geo_code << "'\n"
        << "  AND t.period = '" << period << "'\n"
        << "ORDER BY t.posting_date, t.transaction_id;";
    return sql.str();
}

std::string RollupQueryBuilder::build_ledger_query(
    const std::string& geo_code, const std::string& fiscal_year) const {
    std::ostringstream sql;
    sql << "SELECT ledger_id, ledger_name, ledger_type, geo_code, fiscal_year, status\n"
        << "FROM " << schema_ << ".gl_ledgers\n"
        << "WHERE geo_code = '" << geo_code << "'\n"
        << "  AND fiscal_year = '" << fiscal_year << "'\n"
        << "ORDER BY ledger_type, ledger_id;";
    return sql.str();
}

std::string RollupQueryBuilder::build_register_query(
    const std::string& geo_code, const std::string& period) const {
    std::ostringstream sql;
    sql << "SELECT\n"
        << "  r.register_id, r.ledger_id, r.account_id,\n"
        << "  r.period_debit, r.period_credit,\n"
        << "  r.ytd_debit, r.ytd_credit, r.period\n"
        << "FROM " << schema_ << ".gl_registers r\n"
        << "JOIN " << schema_ << ".gl_ledgers l ON r.ledger_id = l.ledger_id\n"
        << "WHERE l.geo_code = '" << geo_code << "'\n"
        << "  AND r.period = '" << period << "'\n"
        << "ORDER BY r.account_id, r.register_id;";
    return sql.str();
}

std::string RollupQueryBuilder::build_trial_balance_query(
    const std::string& geo_code, const std::string& period) const {
    std::ostringstream sql;
    sql << "SELECT\n"
        << "  a.account_id, a.account_name, a.account_type,\n"
        << "  COALESCE(SUM(t.debit_amount), 0) AS debit_balance,\n"
        << "  COALESCE(SUM(t.credit_amount), 0) AS credit_balance,\n"
        << "  COALESCE(SUM(t.debit_amount), 0) - COALESCE(SUM(t.credit_amount), 0) AS net_balance\n"
        << "FROM " << schema_ << ".gl_accounts a\n"
        << "LEFT JOIN " << schema_ << ".gl_transactions t\n"
        << "  ON a.account_id = t.account_id AND t.period = '" << period << "'\n"
        << "WHERE a.geo_code = '" << geo_code << "'\n"
        << "GROUP BY a.account_id, a.account_name, a.account_type\n"
        << "ORDER BY a.account_type, a.account_id;";
    return sql.str();
}

} // namespace ofa
