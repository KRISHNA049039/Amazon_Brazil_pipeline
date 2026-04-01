#include "ofa_extractor/frame_registry.h"

namespace ofa {

std::string FrameRegistry::make_key(const std::string& geo, const std::string& period,
                                     const std::string& frame) const {
    return geo + ":" + period + ":" + frame;
}

void FrameRegistry::register_frame(const std::string& geo_code, const std::string& period,
                                    const std::string& frame_name, const std::string& data) {
    frames_[make_key(geo_code, period, frame_name)] = data;
}

std::string FrameRegistry::get_frame(const std::string& geo_code, const std::string& period,
                                      const std::string& frame_name) const {
    auto it = frames_.find(make_key(geo_code, period, frame_name));
    return it != frames_.end() ? it->second : "";
}

bool FrameRegistry::has_frame(const std::string& geo_code, const std::string& period,
                               const std::string& frame_name) const {
    return frames_.count(make_key(geo_code, period, frame_name)) > 0;
}

std::vector<std::string> FrameRegistry::list_frames(const std::string& geo_code,
                                                      const std::string& period) const {
    std::string prefix = geo_code + ":" + period + ":";
    std::vector<std::string> result;
    for (const auto& [key, _] : frames_) {
        if (key.substr(0, prefix.size()) == prefix) {
            result.push_back(key.substr(prefix.size()));
        }
    }
    return result;
}

} // namespace ofa
