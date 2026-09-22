import Foundation

struct APIError: Error, LocalizedError {
    let status: Int
    let code: String

    var errorDescription: String? { ErrorMessages.message(for: code) }

    static let network = APIError(status: 0, code: "network_error")
}

private struct DataEnvelope<T: Decodable>: Decodable {
    let data: T
}

private struct ListEnvelope<T: Decodable>: Decodable {
    struct Meta: Decodable { let nextCursor: String? }
    let data: [T]
    let meta: Meta?
}

private struct ErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String
        let message: String
    }
    let error: Body
}

private actor APIResponseCache {
    private struct Entry {
        let data: Data
        let expiresAt: Date
    }

    private var entries: [String: Entry] = [:]
    private var inFlight: [String: Task<Data, Error>] = [:]
    private var generation = 0

    func data(
        for key: String,
        ttl: TimeInterval,
        loader: @escaping @Sendable () async throws -> Data,
    ) async throws -> Data {
        if let entry = entries[key], entry.expiresAt > Date() { return entry.data }
        if let task = inFlight[key] { return try await task.value }

        let taskGeneration = generation
        let task = Task { try await loader() }
        inFlight[key] = task
        do {
            let data = try await task.value
            if generation == taskGeneration {
                inFlight[key] = nil
                entries[key] = Entry(data: data, expiresAt: Date().addingTimeInterval(ttl))
            }
            return data
        } catch {
            if generation == taskGeneration { inFlight[key] = nil }
            throw error
        }
    }

    func clear() {
        generation += 1
        entries.removeAll(keepingCapacity: true)
        inFlight.removeAll(keepingCapacity: true)
    }
}

final class APIClient: Sendable {
    static let shared = APIClient()
    private let cache = APIResponseCache()

    private func token() async -> String? {
        await BetterAuth.shared.token
    }

    private func request(_ method: String, _ path: String, body: Data? = nil, contentType: String = "application/json", authorized: Bool = true) async throws -> Data {
        guard let url = URL(string: path, relativeTo: AppConfig.apiBaseURL) else { throw APIError.network }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpMethod = method
        if authorized, let token = await token() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = body
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError.network
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        guard (200 ..< 300).contains(http.statusCode) else {
            if let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data) {
                throw APIError(status: http.statusCode, code: envelope.error.code)
            }
            throw APIError(status: http.statusCode, code: "internal_error")
        }
        return data
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try JSONDecoder().decode(DataEnvelope<T>.self, from: await request("GET", path)).data
    }

    private func cacheScope() async -> String {
        guard let token = await token() else { return "anonymous" }
        return "\(token.count):\(token.prefix(16))"
    }

    private func cachedGet<T: Decodable>(_ key: String, ttl: TimeInterval, _ path: String) async throws -> T {
        let scopedKey = "\(await cacheScope()):\(key)"
        let data = try await cache.data(for: scopedKey, ttl: ttl) { [self] in
            try await request("GET", path)
        }
        return try JSONDecoder().decode(DataEnvelope<T>.self, from: data).data
    }

    private func invalidateCaches() async {
        await cache.clear()
    }

    private func send<T: Decodable>(_ method: String, _ path: String, json: [String: Any?]? = nil) async throws -> T {
        var body: Data?
        if let json {
            body = try JSONSerialization.data(withJSONObject: json.compactMapValues { $0 }, options: [])
        }
        let data = try await request(method, path, body: body)
        return try JSONDecoder().decode(DataEnvelope<T>.self, from: data).data
    }

    private func sendIgnoringResponse(_ method: String, _ path: String, json: [String: Any?]? = nil) async throws {
        var body: Data?
        if let json {
            body = try JSONSerialization.data(withJSONObject: json.compactMapValues { $0 }, options: [])
        }
        _ = try await request(method, path, body: body)
    }

    // MARK: Status

    func getStatus() async throws -> StatusOverview {
        try await cachedGet("status", ttl: 3, "/api/v1/status")
    }

    func refreshFeeds(force: Bool = false) async throws -> RefreshResult {
        let result: RefreshResult = try await send("POST", "/api/v1/status/refresh", json: ["force": force])
        await invalidateCaches()
        return result
    }

    func refreshFeed(_ feedId: Int) async throws -> RefreshResult {
        let result: RefreshResult = try await send("POST", "/api/v1/status/refresh/\(feedId)", json: [:])
        await invalidateCaches()
        return result
    }


    // MARK: Settings

    func getSettings() async throws -> UserSettings {
        try await getBootstrap().settings
    }

    func getBootstrap() async throws -> BootstrapData {
        try await cachedGet("bootstrap", ttl: 30, "/api/v1/bootstrap")
    }

    func updateSettings(theme: String? = nil, language: String? = nil, readableLanguages: [String]? = nil, articleSortOrder: String? = nil, openInBrowserByDefault: Bool? = nil) async throws -> UserSettings {
        let json: [String: Any?] = [
            "theme": theme,
            "language": language,
            "readableLanguages": readableLanguages,
            "articleSortOrder": articleSortOrder,
            "openInBrowserByDefault": openInBrowserByDefault,
        ]
        let result: UserSettings = try await send("PATCH", "/api/v1/settings", json: json)
        await invalidateCaches()
        return result
    }

    // MARK: Subscriptions

    func listSubscriptions() async throws -> [Subscription] {
        try await getBootstrap().subscriptions
    }

    func getSubscription(_ id: Int) async throws -> Subscription {
        try await get("/api/v1/subscriptions/\(id)")
    }

    func createSubscription(feedUrl: String, tagIds: [Int], tagNames: [String]) async throws -> Subscription {
        let result: Subscription = try await send("POST", "/api/v1/subscriptions", json: ["feedUrl": feedUrl, "tagIds": tagIds, "tagNames": tagNames])
        await invalidateCaches()
        return result
    }

    func updateSubscription(_ id: Int, customTitle: String?) async throws -> Subscription {
        let result: Subscription = try await send("PATCH", "/api/v1/subscriptions/\(id)", json: ["customTitle": customTitle ?? NSNull()])
        await invalidateCaches()
        return result
    }


    func deleteSubscription(_ id: Int) async throws {
        try await sendIgnoringResponse("DELETE", "/api/v1/subscriptions/\(id)")
        await invalidateCaches()
    }

    func markAllRead(_ id: Int) async throws -> MarkAllReadResult {
        let result: MarkAllReadResult = try await send("POST", "/api/v1/subscriptions/\(id)/mark-all-read", json: [:])
        await invalidateCaches()
        return result
    }

    func retryInitialFetch(_ id: Int) async throws -> Subscription {
        let result: Subscription = try await send("POST", "/api/v1/subscriptions/\(id)/retry-initial-fetch")
        await invalidateCaches()
        return result
    }

    func setSubscriptionTags(_ id: Int, tagIds: [Int]) async throws -> Subscription {
        let result: Subscription = try await send("PUT", "/api/v1/subscriptions/\(id)/tags", json: ["tagIds": tagIds])
        await invalidateCaches()
        return result
    }

    func reorderSubscriptions(_ ids: [Int]) async throws {
        try await sendIgnoringResponse("PUT", "/api/v1/subscriptions/order", json: ["subscriptionIds": ids])
        await invalidateCaches()
    }

    // MARK: Tags

    func listTags() async throws -> [Tag] {
        try await getBootstrap().tags
    }

    func createTag(name: String) async throws -> Tag {
        let result: Tag = try await send("POST", "/api/v1/tags", json: ["name": name])
        await invalidateCaches()
        return result
    }

    func updateTag(_ id: Int, name: String, color: String? = nil, clearColor: Bool = false) async throws -> Tag {
        var json: [String: Any?] = ["name": name]
        if clearColor { json["color"] = NSNull() } else if let color { json["color"] = color }
        let result: Tag = try await send("PATCH", "/api/v1/tags/\(id)", json: json)
        await invalidateCaches()
        return result
    }

    func deleteTag(_ id: Int) async throws {
        try await sendIgnoringResponse("DELETE", "/api/v1/tags/\(id)")
        await invalidateCaches()
    }

    func reorderTags(_ ids: [Int]) async throws {
        try await sendIgnoringResponse("PUT", "/api/v1/tags/order", json: ["tagIds": ids])
        await invalidateCaches()
    }

    // MARK: Articles

    func markAllArticlesRead(tagId: Int? = nil) async throws -> MarkAllArticlesReadResult {
        let result: MarkAllArticlesReadResult = try await send("POST", "/api/v1/articles/mark-all-read", json: ["tagId": tagId])
        await invalidateCaches()
        return result
    }

    func removeReadArticlesFromReadingList() async throws -> RemoveReadArticlesResult {
        let result: RemoveReadArticlesResult = try await send("DELETE", "/api/v1/articles/reading-list/read")
        await invalidateCaches()
        return result
    }

    func listArticles(filters: ArticleListFilters, cursor: String? = nil, limit: Int = 20) async throws -> (articles: [ArticleListItem], nextCursor: String?) {
        var components = URLComponents()
        var items = [URLQueryItem(name: "limit", value: String(limit))]
        if let id = filters.subscriptionId { items.append(.init(name: "subscriptionId", value: String(id))) }
        if let id = filters.tagId { items.append(.init(name: "tagId", value: String(id))) }
        if let read = filters.read { items.append(.init(name: "read", value: read ? "true" : "false")) }
        if filters.readingList == true { items.append(.init(name: "readingList", value: "true")) }
        if filters.bookmarked == true { items.append(.init(name: "bookmarked", value: "true")) }
        if let sort = filters.sort { items.append(.init(name: "sort", value: sort)) }
        if let readOrder = filters.readOrder { items.append(.init(name: "readOrder", value: readOrder)) }
        if let cursor { items.append(.init(name: "cursor", value: cursor)) }
        components.queryItems = items
        let query = components.percentEncodedQuery ?? ""
        let path = "/api/v1/articles?\(query)"
        let data = try await cache.data(for: "\(await cacheScope()):articles:\(path)", ttl: 5) { [self] in
            try await request("GET", path)
        }
        let envelope = try JSONDecoder().decode(ListEnvelope<ArticleListItem>.self, from: data)
        return (envelope.data, envelope.meta?.nextCursor)
    }

    func getUnreadCounts() async throws -> UnreadCounts {
        try await cachedGet("unread-counts", ttl: 10, "/api/v1/articles/unread-counts")
    }

    func importArticle(url: String, title: String? = nil) async throws -> SavedArticleResult {
        let result: SavedArticleResult = try await send("POST", "/api/v1/articles/import", json: ["url": url, "title": title])
        await invalidateCaches()
        return result
    }

    func setArticleRead(_ id: Int, isRead: Bool) async throws -> ArticleUserState {
        let result: ArticleUserState = try await send("PATCH", "/api/v1/articles/\(id)/state", json: ["isRead": isRead])
        await invalidateCaches()
        return result
    }

    func setReadingListMembership(_ id: Int, active: Bool) async throws -> ArticleUserState {
        let result: ArticleUserState = try await send(active ? "PUT" : "DELETE", "/api/v1/articles/\(id)/reading-list")
        await invalidateCaches()
        return result
    }

    func setBookmarkMembership(_ id: Int, active: Bool) async throws -> ArticleUserState {
        let result: ArticleUserState = try await send(active ? "PUT" : "DELETE", "/api/v1/articles/\(id)/bookmark")
        await invalidateCaches()
        return result
    }

    func requestArticleContent(_ id: Int, force: Bool = false) async throws -> ArticleContent {
        try await send("POST", "/api/v1/articles/\(id)/content", json: ["force": force])
    }

    func getArticleContent(_ id: Int) async throws -> ArticleContent {
        try await get("/api/v1/articles/\(id)/content")
    }

    // MARK: OPML

    func importOpml(fileData: Data, fileName: String) async throws -> OpmlImportJob {
        let boundary = "filo-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: text/xml\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        let data = try await request("POST", "/api/v1/opml/import", body: body, contentType: "multipart/form-data; boundary=\(boundary)")
        return try JSONDecoder().decode(DataEnvelope<OpmlImportJob>.self, from: data).data
    }

    func getOpmlImport(_ jobId: String) async throws -> OpmlImportJob {
        try await get("/api/v1/opml/imports/\(jobId)")
    }

    func exportOpml() async throws -> Data {
        try await request("GET", "/api/v1/opml/export")
    }

    // MARK: Account

    func deleteAccount() async throws -> DeletionAccepted {
        try await send("DELETE", "/api/v1/account")
    }

    func deletionStatus(token: String?) async throws -> DeletionStatus {
        if let token {
            let encoded = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token
            let data = try await request("GET", "/api/v1/account/deletion-status?deletionToken=\(encoded)", authorized: false)
            return try JSONDecoder().decode(DataEnvelope<DeletionStatus>.self, from: data).data
        }
        return try await get("/api/v1/account/deletion-status")
    }
}
