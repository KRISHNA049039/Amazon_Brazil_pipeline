cmake_minimum_required(VERSION 3.16)
project(ofa_extractor VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Dependencies
find_package(AWSSDK QUIET COMPONENTS redshift-data)
find_package(nlohmann_json QUIET)

add_library(ofa_extractor
    src/redshift_client.cpp
    src/rollup_query_builder.cpp
    src/gl_extractor.cpp
    src/frame_registry.cpp
)

target_include_directories(ofa_extractor PUBLIC include)

add_executable(ofa_extract_cli src/main.cpp)
target_link_libraries(ofa_extract_cli PRIVATE ofa_extractor)

# Tests
enable_testing()
add_executable(ofa_extractor_test tests/test_rollup_queries.cpp tests/test_gl_extractor.cpp)
target_link_libraries(ofa_extractor_test PRIVATE ofa_extractor)
add_test(NAME ofa_extractor_test COMMAND ofa_extractor_test)
