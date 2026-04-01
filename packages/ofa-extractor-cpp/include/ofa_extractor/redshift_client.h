#pragma once

#include "types.h"
#include <functional>

namespace ofa {

// Query result callback — called per row
using RowCallback = std::function<void(const std::map<std::string, std::string>&)>;

/**
 * Client for FAST Redshift account.
 * Executes queries against OFA GL tables in Redshift.
 */
class RedshiftClient {
public:
    RedshiftClient(const std::string& cluster_id,
                   const std::string& database,
                   const std::string& schema);

    // Execute a SQL query and invoke callback per result row
    bool execute_query(const std::string& sql, RowCallback callback);

    // Execute and return all rows as vector of maps
    std::vector<std::map<std::string, std::string>> execute(const std::string& sql);

    // Connection health check
    bool is_connected() const;

    const std::string& get_schema() const { return schema_; }

private:
    std::string cluster_id_;
    std::string database_;
    std::string schema_;
    bool connected_ = false;
};

} // namespace ofa
