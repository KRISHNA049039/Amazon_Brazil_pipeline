#pragma once

#include <string>
#include <vector>
#include <map>
#include <optional>
#include <cstdint>

namespace ofa {

// ─── OFA GL Ledger Types ───

struct GLAccount {
    std::string account_id;
    std::string account_name;
    std::string account_type;       // ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
    std::string parent_account_id;  // for rollup hierarchy
    int level;                      // depth in rollup tree (0 = root)
    std::string geo_code;           // US, EU, JP, IN, BR
    std::string currency_code;      // USD, EUR, JPY, INR, BRL
};

struct GLTransaction {
    std::string transaction_id;
    std::string ledger_id;
    std::string account_id;
    std::string geo_code;
    double debit_amount;
    double credit_amount;
    std::string currency_code;
    std::string posting_date;       // YYYY-MM-DD
    std::string period;             // YYYY-MM (fiscal period)
    std::string description;
    std::string source_system;      // OFA, FAST
};

struct LedgerEntry {
    std::string ledger_id;
    std::string ledger_name;
    std::string ledger_type;        // GL, SL (general/sub)
    std::string geo_code;
    std::string fiscal_year;
    std::string status;             // OPEN, CLOSED, POSTED
};

struct RegisterEntry {
    std::string register_id;
    std::string ledger_id;
    std::string account_id;
    double period_debit;
    double period_credit;
    double ytd_debit;
    double ytd_credit;
    std::string period;
};

struct TrialBalanceRow {
    std::string account_id;
    std::string account_name;
    std::string account_type;
    double debit_balance;
    double credit_balance;
    double net_balance;
    std::string period;
    std::string geo_code;
};

// ─── Rollup Account Tree ───

struct RollupNode {
    GLAccount account;
    std::vector<RollupNode> children;
    double rolled_up_debit;
    double rolled_up_credit;
    double rolled_up_net;
};

// ─── BOP 40 Geo Codes ───
const std::vector<std::string> BOP40_GEOS = {"US", "EU", "JP", "IN", "BR"};

} // namespace ofa
