import ClerkKit
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

final class APIClient: Sendable {
    static let shared = APIClient()

    private func token() async -> String? {
        try? await Clerk.shared.auth.getToken()
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
        try await get("/api/v1/status")
    }

    func refreshFeeds(force: Bool = false) async throws -> RefreshResult {
        try await send("POST", "/api/v1/status/refresh", json: ["force": force])
    }

    func refreshFeed(_ feedId: Int) async throws -> RefreshResult {
        try await send("POST", "/api/v1/status/refresh/\(feedId)", json: [:])
    }

    func translateAll() async throws -> TranslateResult {
        try await send("POST", "/api/v1/status/translate", json: [:])
    }

    func translateFeed(_ feedId: Int) async throws -> TranslateResult {
        try await send("POST", "/api/v1/status/translate/\(feedId)", json: [:])
    }

    func discardTranslations() async throws -> DiscardResult {
        try await send("POST", "/api/v1/status/translate/discard", json: [:])
    }

    func discardFeedTranslations(_ feedId: Int) async throws -> DiscardResult {
        try await send("POST", "/api/v1/status/translate/\(feedId)/discard", json: [:])
    }

    // MARK: Settings

    func getSettings() async throws -> UserSettings {
        try await get("/api/v1/settings")
    }

    func updateSettings(theme: String? = nil, language: String? = nil, readableLanguages: [String]? = nil, articleSortOrder: String? = nil, openInBrowserByDefault: Bool? = nil) async throws -> UserSettings {
        let json: [String: Any?] = [
            "theme": theme,
            "language": language,
            "readableLanguages": readableLanguages,
            "articleSortOrder": articleSortOrder,
            "openInBrowserByDefault": openInBrowserByDefault,
        ]
        return try await send("PATCH", "/api/v1/settings", json: json)
    }

    // MARK: Subscriptions

    func listSubscriptions() async throws -> [Subscription] {
        var all: [Subscription] = []
        var cursor: String?
        repeat {
            var path = "/api/v1/subscriptions?limit=100"
            if let cursor { path += "&cursor=\(cursor)" }
            let envelope = try JSONDecoder().decode(ListEnvelope<Subscription>.self, from: await request("GET", path))
            all.append(contentsOf: envelope.data)
            cursor = envelope.meta?.nextCursor
        } while cursor != nil
        return all
    }

    func getSubscription(_ id: Int) async throws -> Subscription {
        try await get("/api/v1/subscriptions/\(id)")
    }

    func createSubscription(feedUrl: String, tagIds: [Int], tagNames: [String]) async throws -> Subscription {
        try await send("POST", "/api/v1/subscriptions", json: ["feedUrl": feedUrl, "tagIds": tagIds, "tagNames": tagNames])
    }

    func updateSubscription(_ id: Int, customTitle: String?) async throws -> Subscription {
        try await send("PATCH", "/api/v1/subscriptions/\(id)", json: ["customTitle": customTitle ?? NSNull()])
    }


    func deleteSubscription(_ id: Int) async throws {
        try await sendIgnoringResponse("DELETE", "/api/v1/subscriptions/\(id)")
    }

    func markAllRead(_ id: Int) async throws -> MarkAllReadResult {
        try await send("POST", "/api/v1/subscriptions/\(id)/mark-all-read", json: [:])
    }

    func retryInitialFetch(_ id: Int) async throws -> Subscription {
        try await send("POST", "/api/v1/subscriptions/\(id)/retry-initial-fetch")
    }

    func setSubscriptionTags(_ id: Int, tagIds: [Int]) async throws -> Subscription {
        try await send("PUT", "/api/v1/subscriptions/\(id)/tags", json: ["tagIds": tagIds])
    }

    func reorderSubscriptions(_ ids: [Int]) async throws {
        try await sendIgnoringResponse("PUT", "/api/v1/subscriptions/order", json: ["subscriptionIds": ids])
    }

    // MARK: Tags

    func listTags() async throws -> [Tag] {
        try await get("/api/v1/tags")
    }

    func createTag(name: String) async throws -> Tag {
        try await send("POST", "/api/v1/tags", json: ["name": name])
    }

    func updateTag(_ id: Int, name: String, color: String? = nil, clearColor: Bool = false) async throws -> Tag {
        var json: [String: Any?] = ["name": name]
        if clearColor { json["color"] = NSNull() } else if let color { json["color"] = color }
        return try await send("PATCH", "/api/v1/tags/\(id)", json: json)
    }

    func deleteTag(_ id: Int) async throws {
        try await sendIgnoringResponse("DELETE", "/api/v1/tags/\(id)")
    }

    func reorderTags(_ ids: [Int]) async throws {
        try await sendIgnoringResponse("PUT", "/api/v1/tags/order", json: ["tagIds": ids])
    }

    // MARK: Articles

    func markAllArticlesRead(tagId: Int? = nil) async throws -> MarkAllArticlesReadResult {
        try await send("POST", "/api/v1/articles/mark-all-read", json: ["tagId": tagId])
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
        if let cursor { items.append(.init(name: "cursor", value: cursor)) }
        components.queryItems = items
        let query = components.percentEncodedQuery ?? ""
        let envelope = try JSONDecoder().decode(ListEnvelope<ArticleListItem>.self, from: await request("GET", "/api/v1/articles?\(query)"))
        return (envelope.data, envelope.meta?.nextCursor)
    }

    func setArticleRead(_ id: Int, isRead: Bool) async throws -> ArticleUserState {
        try await send("PATCH", "/api/v1/articles/\(id)/state", json: ["isRead": isRead])
    }

    func setReadingListMembership(_ id: Int, active: Bool) async throws -> ArticleUserState {
        try await send(active ? "PUT" : "DELETE", "/api/v1/articles/\(id)/reading-list")
    }

    func setBookmarkMembership(_ id: Int, active: Bool) async throws -> ArticleUserState {
        try await send(active ? "PUT" : "DELETE", "/api/v1/articles/\(id)/bookmark")
    }

    func getArticle(_ id: Int) async throws -> ArticleDetail {
        try await get("/api/v1/articles/\(id)")
    }

    func getArticleContent(_ id: Int) async throws -> ArticleContent {
        try await get("/api/v1/articles/\(id)/content")
    }

    func requestArticleContent(_ id: Int, force: Bool = false) async throws {
        try await sendIgnoringResponse("POST", "/api/v1/articles/\(id)/content", json: ["force": force])
    }

    // MARK: Playback Queue

    func getPlaybackQueue() async throws -> PlaybackQueueData {
        try await get("/api/v1/playback-queue")
    }

    func addPlaybackQueueItems(_ articleIds: [Int]) async throws {
        try await sendIgnoringResponse("POST", "/api/v1/playback-queue/items", json: ["articleIds": articleIds])
    }

    func removePlaybackQueueItem(_ articleId: Int) async throws {
        try await sendIgnoringResponse("DELETE", "/api/v1/playback-queue/items/\(articleId)")
    }

    func reorderPlaybackQueue(_ articleIds: [Int]) async throws {
        try await sendIgnoringResponse("PUT", "/api/v1/playback-queue/order", json: ["articleIds": articleIds])
    }

    func clearPlaybackQueue() async throws {
        try await sendIgnoringResponse("DELETE", "/api/v1/playback-queue")
    }

    func updatePlaybackState(
        currentArticleId: Int? = nil,
        clearCurrentArticle: Bool = false,
        contentLanguage: String? = nil,
        positionPercent: Double? = nil
    ) async throws {
        var json: [String: Any?] = [:]
        if clearCurrentArticle {
            json["currentArticleId"] = NSNull()
        } else if let currentArticleId {
            json["currentArticleId"] = currentArticleId
        }
        if let contentLanguage { json["contentLanguage"] = contentLanguage }
        if let positionPercent { json["positionPercent"] = positionPercent }
        try await sendIgnoringResponse("PATCH", "/api/v1/playback-queue/state", json: json)
    }

    func lookupArticle(url: String) async throws -> ArticleLookup {
        let encoded = url.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? url
        return try await get("/api/v1/articles/lookup?url=\(encoded)")
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
