#include "ofa_extractor/gl_extractor.h"
#include <algorithm>
#include <iostream>

namespace ofa {

GLExtractor::GLExtractor(RedshiftClient& client, const std::string& schema)
    : client_(client), query_builder_(schema) {}

std::vector<GLAccount> GLExtractor::extract_rollup_accounts(const std::string& geo_code) {
    std::string sql = query_builder_.build_rollup_hierarchy_query(geo_code);
    auto rows = client_.execute(sql);

    std::vector<GLAccount> accounts;
    for (const auto& row : rows) {
        GLAccount acct;
        acct.account_id = row.at("account_id");
        acct.account_name = row.at("account_name");
        acct.account_type = row.at("account_type");
        acct.parent_account_id = row.count("parent_account_id") ? row.at("parent_account_id") : "";
        acct.level = std::stoi(row.at("level"));
        acct.geo_code = geo_code;
        accounts.push_back(acct);
    }
    std::cout << "[GLExtractor] Extracted " << accounts.size()
              << " rollup accounts for " << geo_code << std::endl;
    return accounts;
}

std::vector<GLTransaction> GLExtractor::extract_transactions(
    const std::string& geo_code, const std::string& period) {
    std::string sql = query_builder_.build_gl_transactions_query(geo_code, period);
    auto rows = client_.execute(sql);

    std::vector<GLTransaction> txns;
    for (const auto& row : rows) {
        GLTransaction t;
        t.transaction_id = row.at("transaction_id");
        t.ledger_id = row.at("ledger_id");
        t.account_id = row.at("account_id");
        t.debit_amount = std::stod(row.at("debit_amount"));
        t.credit_amount = std::stod(row.at("credit_amount"));
        t.currency_code = row.at("currency_code");
        t.posting_date = row.at("posting_date");
        t.period = row.at("period");
        t.description = row.at("description");
        t.source_system = row.at("source_system");
        t.geo_code = geo_code;
        txns.push_back(t);
    }
    return txns;
}

std::vector<LedgerEntry> GLExtractor::extract_ledgers(
    const std::string& geo_code, const std::string& fiscal_year) {
    std::string sql = query_builder_.build_ledger_query(geo_code, fiscal_year);
    auto rows = client_.execute(sql);

    std::vector<LedgerEntry> ledgers;
    for (const auto& row : rows) {
        LedgerEntry l;
        l.ledger_id = row.at("ledger_id");
        l.ledger_name = row.at("ledger_name");
        l.ledger_type = row.at("ledger_type");
        l.geo_code = geo_code;
        l.fiscal_year = fiscal_year;
        l.status = row.at("status");
        ledgers.push_back(l);
    }
    return ledgers;
}

std::vector<RegisterEntry> GLExtractor::extract_registers(
    const std::string& geo_code, const std::string& period) {
    std::string sql = query_builder_.build_register_query(geo_code, period);
    auto rows = client_.execute(sql);

    std::vector<RegisterEntry> registers;
    for (const auto& row : rows) {
        RegisterEntry r;
        r.register_id = row.at("register_id");
        r.ledger_id = row.at("ledger_id");
        r.account_id = row.at("account_id");
        r.period_debit = std::stod(row.at("period_debit"));
        r.period_credit = std::stod(row.at("period_credit"));
        r.ytd_debit = std::stod(row.at("ytd_debit"));
        r.ytd_credit = std::stod(row.at("ytd_credit"));
        r.period = period;
        registers.push_back(r);
    }
    return registers;
}

std::vector<TrialBalanceRow> GLExtractor::extract_trial_balance(
    const std::string& geo_code, const std::string& period) {
    std::string sql = query_builder_.build_trial_balance_query(geo_code, period);
    auto rows = client_.execute(sql);

    std::vector<TrialBalanceRow> tb;
    for (const auto& row : rows) {
        TrialBalanceRow r;
        r.account_id = row.at("account_id");
        r.account_name = row.at("account_name");
        r.account_type = row.at("account_type");
        r.debit_balance = std::stod(row.at("debit_balance"));
        r.credit_balance = std::stod(row.at("credit_balance"));
        r.net_balance = std::stod(row.at("net_balance"));
        r.period = period;
        r.geo_code = geo_code;
        tb.push_back(r);
    }
    return tb;
}

RollupNode GLExtractor::build_rollup_tree(
    const std::vector<GLAccount>& accounts,
    const std::vector<TrialBalanceRow>& tb_rows) {

    // Index TB by account_id
    std::map<std::string, TrialBalanceRow> tb_index;
    for (const auto& row : tb_rows) {
        tb_index[row.account_id] = row;
    }

    // Build parent→children index
    std::map<std::string, std::vector<const GLAccount*>> children_map;
    const GLAccount* root = nullptr;
    for (const auto& acct : accounts) {
        if (acct.parent_account_id.empty()) {
            root = &acct;
        } else {
            children_map[acct.parent_account_id].push_back(&acct);
        }
    }

    // Recursive tree builder
    std::function<RollupNode(const GLAccount&)> build_node;
    build_node = [&](const GLAccount& acct) -> RollupNode {
        RollupNode node;
        node.account = acct;

        auto tb_it = tb_index.find(acct.account_id);
        double own_debit = tb_it != tb_index.end() ? tb_it->second.debit_balance : 0.0;
        double own_credit = tb_it != tb_index.end() ? tb_it->second.credit_balance : 0.0;

        node.rolled_up_debit = own_debit;
        node.rolled_up_credit = own_credit;

        auto children_it = children_map.find(acct.account_id);
        if (children_it != children_map.end()) {
            for (const auto* child : children_it->second) {
                auto child_node = build_node(*child);
                node.rolled_up_debit += child_node.rolled_up_debit;
                node.rolled_up_credit += child_node.rolled_up_credit;
                node.children.push_back(std::move(child_node));
            }
        }

        node.rolled_up_net = node.rolled_up_debit - node.rolled_up_credit;
        return node;
    };

    if (root) return build_node(*root);

    // Fallback: empty root
    RollupNode empty;
    empty.rolled_up_debit = 0;
    empty.rolled_up_credit = 0;
    empty.rolled_up_net = 0;
    return empty;
}

GLExtractor::ExtractionResult GLExtractor::extract_all(
    const std::string& geo_code,
    const std::string& period,
    const std::string& fiscal_year) {

    ExtractionResult result;
    result.geo_code = geo_code;
    result.period = period;

    result.accounts = extract_rollup_accounts(geo_code);
    result.transactions = extract_transactions(geo_code, period);
    result.ledgers = extract_ledgers(geo_code, fiscal_year);
    result.registers = extract_registers(geo_code, period);
    result.trial_balance = extract_trial_balance(geo_code, period);
    result.rollup_tree = build_rollup_tree(result.accounts, result.trial_balance);

    std::cout << "[GLExtractor] Full extraction complete for " << geo_code
              << " period " << period << std::endl;
    return result;
}

} // namespace ofa
