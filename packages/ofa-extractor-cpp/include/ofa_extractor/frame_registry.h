#pragma once

#include "types.h"
#include <string>
#include <map>
#include <vector>

namespace ofa {

/**
 * Frame Registry — manages named data frames extracted from OFA.
 *
 * Frames are the unit of data exchange between pipeline stages:
 *   - rollup_accounts: Account hierarchy with parent-child relationships
 *   - gl_transactions: Raw GL transaction data
 *   - ledgers: Ledger metadata
 *   - registers: Period balance registers
 *   - tb_ledgers: Trial balance per account
 *
 * Each frame is keyed by (geo_code, period, frame_name).
 */
class FrameRegistry {
public:
    // Register a frame (serialized as JSON or CSV)
    void register_frame(const std::string& geo_code,
                        const std::string& period,
                        const std::string& frame_name,
                        const std::string& serialized_data);

    // Retrieve a frame
    std::string get_frame(const std::string& geo_code,
                          const std::string& period,
                          const std::string& frame_name) const;

    // Check if a frame exists
    bool has_frame(const std::string& geo_code,
                   const std::string& period,
                   const std::string& frame_name) const;

    // List all frames for a geo and period
    std::vector<std::string> list_frames(const std::string& geo_code,
                                          const std::string& period) const;

    // Frame names used in BOP 40 pipeline
    static constexpr const char* FRAME_ROLLUP_ACCOUNTS = "rollup_accounts";
    static constexpr const char* FRAME_GL_TRANSACTIONS = "gl_transactions";
    static constexpr const char* FRAME_LEDGERS = "ledgers";
    static constexpr const char* FRAME_REGISTERS = "registers";
    static constexpr const char* FRAME_TB_LEDGERS = "tb_ledgers";

private:
    // Key: "geo:period:frame_name"
    std::map<std::string, std::string> frames_;

    std::string make_key(const std::string& geo, const std::string& period,
                         const std::string& frame) const;
};

} // namespace ofa
