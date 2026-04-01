#include "ofa_extractor/gl_extractor.h"
#include "ofa_extractor/frame_registry.h"
#include <cassert>
#include <iostream>

void test_build_rollup_tree() {
    // Build a simple 3-level tree: Root -> [Assets, Liabilities] -> [Cash, AR]
    std::vector<ofa::GLAccount> accounts = {
        {"1000", "Total", "ASSET", "", 0, "US", "USD"},
        {"1100", "Assets", "ASSET", "1000", 1, "US", "USD"},
        {"1200", "Liabilities", "LIABILITY", "1000", 1, "US", "USD"},
        {"1110", "Cash", "ASSET", "1100", 2, "US", "USD"},
        {"1120", "AR", "ASSET", "1100", 2, "US", "USD"},
    };

    std::vector<ofa::TrialBalanceRow> tb = {
        {"1110", "Cash", "ASSET", 50000, 10000, 40000, "2026-03", "US"},
        {"1120", "AR", "ASSET", 30000, 5000, 25000, "2026-03", "US"},
        {"1200", "Liabilities", "LIABILITY", 0, 60000, -60000, "2026-03", "US"},
    };

    ofa::RedshiftClient client("test", "test", "test");
    ofa::GLExtractor extractor(client, "test");
    auto tree = extractor.build_rollup_tree(accounts, tb);

    // Root should roll up all children
    assert(tree.account.account_id == "1000");
    assert(tree.children.size() == 2);

    // Assets subtree: 50000+30000 = 80000 debit
    auto& assets = tree.children[0];
    assert(assets.account.account_id == "1100");
    assert(assets.rolled_up_debit == 80000);
    assert(assets.rolled_up_credit == 15000);
    assert(assets.children.size() == 2);

    std::cout << "[PASS] test_build_rollup_tree" << std::endl;
}

void test_frame_registry() {
    ofa::FrameRegistry registry;

    registry.register_frame("US", "2026-03", "rollup_accounts", "data1");
    registry.register_frame("US", "2026-03", "gl_transactions", "data2");

    assert(registry.has_frame("US", "2026-03", "rollup_accounts"));
    assert(!registry.has_frame("US", "2026-03", "nonexistent"));
    assert(registry.get_frame("US", "2026-03", "rollup_accounts") == "data1");

    auto frames = registry.list_frames("US", "2026-03");
    assert(frames.size() == 2);

    std::cout << "[PASS] test_frame_registry" << std::endl;
}

// Entry point for C++ tests
int main() {
    test_build_rollup_tree();
    test_frame_registry();

    // Also run rollup query tests (declared in test_rollup_queries.cpp)
    extern void test_rollup_hierarchy_query();
    extern void test_rollup_balance_query();
    extern void test_trial_balance_query();
    extern void test_all_geos_produce_valid_queries();

    test_rollup_hierarchy_query();
    test_rollup_balance_query();
    test_trial_balance_query();
    test_all_geos_produce_valid_queries();

    std::cout << "\n=== All C++ tests passed ===" << std::endl;
    return 0;
}
