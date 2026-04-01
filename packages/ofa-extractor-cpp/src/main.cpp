#include "ofa_extractor/gl_extractor.h"
#include "ofa_extractor/frame_registry.h"
#include <iostream>

int main(int argc, char* argv[]) {
    std::string period = argc > 1 ? argv[1] : "2026-03";
    std::string fiscal_year = argc > 2 ? argv[2] : "2026";

    ofa::RedshiftClient client("fast-redshift-cluster", "ofa_db", "ofa_gl");
    ofa::GLExtractor extractor(client, "ofa_gl");
    ofa::FrameRegistry registry;

    std::cout << "=== OFA GL Extractor — BOP 40 Report ===" << std::endl;
    std::cout << "Period: " << period << " | Fiscal Year: " << fiscal_year << std::endl;

    for (const auto& geo : ofa::BOP40_GEOS) {
        std::cout << "\n--- Extracting " << geo << " ---" << std::endl;
        auto result = extractor.extract_all(geo, period, fiscal_year);

        // Register frames for downstream consumption
        registry.register_frame(geo, period, "rollup_accounts", "extracted");
        registry.register_frame(geo, period, "gl_transactions", "extracted");
        registry.register_frame(geo, period, "ledgers", "extracted");
        registry.register_frame(geo, period, "registers", "extracted");
        registry.register_frame(geo, period, "tb_ledgers", "extracted");

        auto frames = registry.list_frames(geo, period);
        std::cout << "Registered " << frames.size() << " frames for " << geo << std::endl;
    }

    std::cout << "\n=== Extraction complete for all 5 geos ===" << std::endl;
    return 0;
}
