import SwiftUI

struct StatusScreen: View {
    @State private var status: StatusOverview?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isRefreshing = false
    @State private var busyFeedId: Int?
    @State private var notice: String?
    @State private var pollTask: Task<Void, Never>?

    private let pollInterval: TimeInterval = 5

    var body: some View {
        List {
            if isLoading || status == nil {
                ProgressView("読み込み中…")
            } else if let status {
                actionsSection(status)
                subscriptionStatusesSection(status)
            }
            if let errorMessage {
                Section { ErrorBanner(message: errorMessage) { Task { await load() } } }
            }
        }
        .scrollContentBackground(.hidden)
        .background(FiloPalette.background)
        .navigationTitle("処理ステータス")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await load() } } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
        }
        .task {
            await load()
            startPolling()
        }
        .onDisappear { pollTask?.cancel() }
    }

    // MARK: - Sections

    @ViewBuilder
    private func actionsSection(_ s: StatusOverview) -> some View {
        Section("操作") {
            Button(isRefreshing ? "取得中…" : "すべて取得") {
                Task { await refreshAll() }
            }
            .disabled(isRefreshing)

            if let notice {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(FiloPalette.muted)
            }

            Text(summaryLine(s))
                .font(.caption)
                .foregroundStyle(FiloPalette.muted)
        }
    }

    @ViewBuilder
    private func subscriptionStatusesSection(_ s: StatusOverview) -> some View {
        Section("購読一覧（状態順・\(s.subscriptionStatuses.count)件）") {
            if s.subscriptionStatuses.isEmpty {
                Text("購読がありません。")
                    .foregroundStyle(FiloPalette.muted)
            } else {
                ForEach(sortedStatusSubscriptions(s.subscriptionStatuses)) { sub in
                    subscriptionRow(sub)
                }
            }
        }
    }

    @ViewBuilder
    private func subscriptionRow(_ sub: StatusSubscription) -> some View {
        let isError = hasStatusAttention(sub)
        let fetchBusy = sub.fetchJob?.isActive == true || busyFeedId == sub.feedId && isRefreshing
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                NavigationLink(value: AppRoute.subscriptionDetail(sub.subscriptionId)) {
                    Text(sub.feedTitle)
                        .underline()
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
                Spacer()
                if sub.feedStatus == "paused" {
                    StatusBadge(label: "停止", tone: .muted)
                }
                jobBadge("取得", job: sub.fetchJob, fallbackDanger: sub.lastResult == "error")
                Text(sub.lastFetchedAt.map { DateFormatting.relative($0) } ?? "—")
                    .font(.caption)
                    .foregroundStyle(FiloPalette.muted)
            }
            if isError, let err = sub.fetchJob?.lastError ?? sub.lastError {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(FiloPalette.danger)
                    .lineLimit(1)
            }
            HStack(spacing: 12) {
                Button(fetchBusy ? "取得中…" : "取得") {
                    Task { await refreshFeed(sub.feedId) }
                }
                .disabled(isRefreshing || fetchBusy)
            }
            .font(.caption)
            .buttonStyle(.borderless)
        }
    }

    private func summaryLine(_ s: StatusOverview) -> String {
        var line = "購読 \(s.feeds.total)件・記事 \(s.articles.total)件"
        if let fetchedAt = s.feeds.lastFetchedAt { line += "・最終取得 \(DateFormatting.relative(fetchedAt))" }
        line += "・約\(Int(pollInterval))秒ごとに自動更新"
        return line
    }

    @ViewBuilder
    private func jobBadge(_ label: String, job: FeedJob?, fallbackDanger: Bool) -> some View {
        if let job, job.status != "completed" {
            if job.stalled {
                StatusBadge(label: "\(label)中断", tone: .danger)
            } else if job.status == "failed" {
                StatusBadge(label: "\(label)失敗", tone: .danger)
            } else if job.status == "running" {
                StatusBadge(label: "\(label)中", tone: .warn)
            } else {
                StatusBadge(label: "\(label)待ち", tone: .warn)
            }
        } else if fallbackDanger {
            StatusBadge(label: "\(label)失敗", tone: .danger)
        }
    }

    // MARK: - Actions

    private func load() async {
        isLoading = status == nil
        do {
            status = try await APIClient.shared.getStatus()
            errorMessage = nil
        } catch {
            // only surface load errors when there is nothing to show
            if status == nil {
                errorMessage = ErrorMessages.message(for: error)
            }
        }
        isLoading = false
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(pollInterval))
                guard !Task.isCancelled else { break }
                do {
                    status = try await APIClient.shared.getStatus()
                    errorMessage = nil
                } catch {
                    // silent on poll errors
                }
            }
        }
    }

    private func refreshAll() async {
        isRefreshing = true
        notice = nil
        do {
            let result = try await APIClient.shared.refreshFeeds(force: true)
            FiloAnalytics.track("refresh_feeds", parameters: ["source": "status", "enqueued": result.enqueued])
            notice = result.enqueued > 0
                ? "\(result.enqueued)件のフィードの取得を開始しました。"
                : "取得対象のフィードがありません。"
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isRefreshing = false
    }

    private func refreshFeed(_ feedId: Int) async {
        busyFeedId = feedId
        isRefreshing = true
        notice = nil
        do {
            _ = try await APIClient.shared.refreshFeed(feedId)
            FiloAnalytics.track("refresh_feed", parameters: ["source": "status", "feed_id": feedId])
            notice = "フィードの取得を開始しました。"
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isRefreshing = false
        busyFeedId = nil
    }

}

// Keep the same actionable-first order as the web and Android status screens.
// The list is rebuilt from every polled snapshot, so a feed moves as soon as
// its fetch state changes.
private func sortedStatusSubscriptions(_ subscriptions: [StatusSubscription]) -> [StatusSubscription] {
    subscriptions.sorted { lhs, rhs in
        let rankDifference = statusRank(lhs) - statusRank(rhs)
        if rankDifference != 0 { return rankDifference < 0 }
        return lhs.feedTitle.localizedStandardCompare(rhs.feedTitle) == .orderedAscending
    }
}

private func statusRank(_ sub: StatusSubscription) -> Int {
    if hasStatusAttention(sub) { return 0 }
    if sub.fetchJob?.stalled == true { return 1 }
    if sub.fetchJob?.status == "running" { return 2 }
    if sub.fetchJob?.status == "pending" { return 3 }
    if sub.feedStatus == "paused" { return 4 }
    return 5
}

private func hasStatusAttention(_ sub: StatusSubscription) -> Bool {
    sub.consecutiveFailures > 0
        || sub.fetchJob?.status == "failed"
        || sub.lastResult == "error"
}
