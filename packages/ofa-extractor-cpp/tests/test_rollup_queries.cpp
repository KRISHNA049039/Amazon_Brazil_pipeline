#include "ofa_extractor/rollup_query_builder.h"
#include <cassert>
#include <iostream>
#include <string>

void test_rollup_hierarchy_query() {
    ofa::RollupQueryBuilder builder("ofa_gl");
    std::string sql = builder.build_rollup_hierarchy_query("US");

    assert(sql.find("WITH RECURSIVE account_tree") != std::string::npos);
    assert(sql.find("UNION ALL") != std::string::npos);
    assert(sql.find("geo_code = 'US'") != std::string::npos);
    assert(sql.find("parent_account_id IS NULL") != std::string::npos);
    assert(sql.find("ofa_gl.gl_accounts") != std::string::npos);
    std::cout << "[PASS] test_rollup_hierarchy_query" << std::endl;
}

void test_rollup_balance_query() {
    ofa::RollupQueryBuilder builder("ofa_gl");
    std::string sql = builder.build_rollup_balance_query("EU", "2026-03");

    assert(sql.find("WITH RECURSIVE account_tree") != std::string::npos);
    assert(sql.find("leaf_balances") != std::string::npos);
    assert(sql.find("geo_code = 'EU'") != std::string::npos);
    assert(sql.find("period = '2026-03'") != std::string::npos);
    assert(sql.find("net_balance") != std::string::npos);
    std::cout << "[PASS] test_rollup_balance_query" << std::endl;
}

void test_trial_balance_query() {
    ofa::RollupQueryBuilder builder("ofa_gl");
    std::string sql = builder.build_trial_balance_query("JP", "2026-03");

    assert(sql.find("debit_balance") != std::string::npos);
    assert(sql.find("credit_balance") != std::string::npos);
    assert(sql.find("geo_code = 'JP'") != std::string::npos);
    assert(sql.find("GROUP BY") != std::string::npos);
    std::cout << "[PASS] test_trial_balance_query" << std::endl;
}

void test_all_geos_produce_valid_queries() {
    ofa::RollupQueryBuilder builder("ofa_gl");
    for (const auto& geo : ofa::BOP40_GEOS) {
        std::string sql = builder.build_rollup_hierarchy_query(geo);
        assert(!sql.empty());
        assert(sql.find(geo) != std::string::npos);
    }
    std::cout << "[PASS] test_all_geos_produce_valid_queries" << std::endl;
}
