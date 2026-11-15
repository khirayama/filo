import Foundation

func safeHttpURL(_ value: String?) -> URL? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty,
          let url = URL(string: trimmed),
          let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https",
          let host = url.host, !host.isEmpty,
          url.user == nil, url.password == nil else {
        return nil
    }
    return url
}

func isAllowedWebNavigation(_ value: String?) -> Bool {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
        return false
    }
    if trimmed.caseInsensitiveCompare("about:blank") == .orderedSame
        || trimmed.caseInsensitiveCompare("about:srcdoc") == .orderedSame {
        return true
    }
    return safeHttpURL(trimmed) != nil
}
