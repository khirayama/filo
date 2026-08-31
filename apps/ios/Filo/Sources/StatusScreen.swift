import SwiftUI

struct StatusScreen: View {
    @State private var status: StatusOverview?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isRefreshing = false
    @State private var busyFeedId: Int?
    @State private var notice: String?
    @State private var pollTask: Task<Void, Never>?
    @State private var filterText = ""
    @State private var statusFilter: StatusFilter = .all
    @State private var sortKey: StatusSortKey = .status
    @State private var sortAscending = true

    private let pollInterval: TimeInterval = 5

    var body: some View {
        List {
            if isLoading || status == nil {
                ProgressView("読み込み中…")
            } else if let status {
                actionsSection(status)
                listControls
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
                    FiloIcon(.refresh, size: 18)
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
            Button { Task { await refreshAll() } } label: {
                Text(L10n.string(isRefreshing ? "取得中…" : "すべて取得"))
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
        Section(L10n.format("購読一覧（%ld件）", s.subscriptionStatuses.count)) {
            if s.subscriptionStatuses.isEmpty {
                Text("購読がありません。")
                    .foregroundStyle(FiloPalette.muted)
            } else if visibleSubscriptions(s).isEmpty {
                Text("条件に一致する購読がありません。")
                    .foregroundStyle(FiloPalette.muted)
            } else {
                ForEach(visibleSubscriptions(s)) { sub in
                    subscriptionRow(sub)
                }
            }
        }
    }

    private var listControls: some View {
        Section {
            TextField("購読名で検索", text: $filterText)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    FilterChip(label: "すべて", isOn: statusFilter == .all) { statusFilter = .all }
                    FilterChip(label: "問題あり", isOn: statusFilter == .attention) { statusFilter = .attention }
                    FilterChip(label: "取得中", isOn: statusFilter == .fetching) { statusFilter = .fetching }
                    FilterChip(label: "停止", isOn: statusFilter == .paused) { statusFilter = .paused }
                }
            }
            Menu {
                Button("状態") { toggleSort(.status) }
                Button("購読") { toggleSort(.feedTitle) }
                Button("取得") { toggleSort(.fetchStatus) }
                Button("最終取得") { toggleSort(.lastFetchedAt) }
            } label: {
                HStack(spacing: 6) {
                    FiloIcon(sortAscending ? .chevronUp : .chevronDown, size: 14)
                    Text(L10n.format("並び替え: %@", sortLabel))
                }
            }
            if let status {
                Text("\(visibleSubscriptions(status).count)/\(status.subscriptionStatuses.count)")
                    .font(.caption)
                    .foregroundStyle(FiloPalette.muted)
            }
        } header: {
            Text("購読一覧を絞り込み")
        }
    }

    private var sortLabel: String {
        switch sortKey {
        case .status: return L10n.string("状態")
        case .feedTitle: return L10n.string("購読")
        case .fetchStatus: return L10n.string("取得")
        case .lastFetchedAt: return L10n.string("最終取得")
        }
    }

    private func toggleSort(_ key: StatusSortKey) {
        if sortKey == key {
            sortAscending.toggle()
        } else {
            sortKey = key
            sortAscending = true
        }
    }

    private func visibleSubscriptions(_ s: StatusOverview) -> [StatusSubscription] {
        let query = filterText.trimmingCharacters(in: .whitespacesAndNewlines).localizedLowercase
        let filtered = s.subscriptionStatuses.filter { sub in
            if !query.isEmpty && !sub.feedTitle.localizedLowercase.contains(query) { return false }
            switch statusFilter {
            case .all: return true
            case .attention: return hasStatusAttention(sub)
            case .fetching: return sub.fetchJob?.status == "pending" || sub.fetchJob?.status == "running"
            case .paused: return sub.feedStatus == "paused"
            }
        }
        return filtered.sorted { lhs, rhs in
            let comparison: ComparisonResult
            switch sortKey {
            case .status:
                comparison = statusRank(lhs) == statusRank(rhs) ? lhs.feedTitle.localizedStandardCompare(rhs.feedTitle) : (statusRank(lhs) < statusRank(rhs) ? .orderedAscending : .orderedDescending)
            case .feedTitle:
                comparison = lhs.feedTitle.localizedStandardCompare(rhs.feedTitle)
            case .fetchStatus:
                comparison = fetchStatusRank(lhs) == fetchStatusRank(rhs) ? lhs.feedTitle.localizedStandardCompare(rhs.feedTitle) : (fetchStatusRank(lhs) < fetchStatusRank(rhs) ? .orderedAscending : .orderedDescending)
            case .lastFetchedAt:
                if lhs.lastFetchedAt == nil && rhs.lastFetchedAt != nil {
                    comparison = .orderedDescending
                } else if lhs.lastFetchedAt != nil && rhs.lastFetchedAt == nil {
                    comparison = .orderedAscending
                } else {
                    let left = lhs.lastFetchedAt ?? ""
                    let right = rhs.lastFetchedAt ?? ""
                    comparison = left == right ? lhs.feedTitle.localizedStandardCompare(rhs.feedTitle) : (left < right ? .orderedAscending : .orderedDescending)
                }
            }
            return sortAscending ? comparison == .orderedAscending : comparison == .orderedDescending
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
                jobBadge(L10n.string("取得"), job: sub.fetchJob, fallbackDanger: sub.lastResult == "error")
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
                Button { Task { await refreshFeed(sub.feedId) } } label: {
                    Text(L10n.string(fetchBusy ? "取得中…" : "取得"))
                }
                .disabled(isRefreshing || fetchBusy)
            }
            .font(.caption)
            .buttonStyle(.borderless)
        }
    }

    private func summaryLine(_ s: StatusOverview) -> String {
        var line = L10n.format("購読 %ld件・記事 %ld件", s.feeds.total, s.articles.total)
        if let fetchedAt = s.feeds.lastFetchedAt { line += L10n.format("・最終取得 %@", DateFormatting.relative(fetchedAt)) }
        line += L10n.format("・約%ld秒ごとに自動更新", Int(pollInterval))
        return line
    }

    @ViewBuilder
    private func jobBadge(_ label: String, job: FeedJob?, fallbackDanger: Bool) -> some View {
        if let job, job.status != "completed" {
            if job.stalled {
                StatusBadge(label: L10n.format("%@中断", label), tone: .danger)
            } else if job.status == "failed" {
                StatusBadge(label: L10n.format("%@失敗", label), tone: .danger)
            } else if job.status == "running" {
                StatusBadge(label: L10n.format("%@中", label), tone: .warn)
            } else {
                StatusBadge(label: L10n.format("%@待ち", label), tone: .warn)
            }
        } else if fallbackDanger {
            StatusBadge(label: L10n.format("%@失敗", label), tone: .danger)
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
                ? L10n.format("%ld件のフィードの取得を開始しました。", result.enqueued)
                : L10n.string("取得対象のフィードがありません。")
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

private enum StatusFilter {
    case all, attention, fetching, paused
}

private enum StatusSortKey {
    case status, feedTitle, fetchStatus, lastFetchedAt
}

private func fetchStatusRank(_ sub: StatusSubscription) -> Int {
    if hasStatusAttention(sub) { return 0 }
    if sub.fetchJob?.stalled == true { return 1 }
    if sub.fetchJob?.status == "running" { return 2 }
    if sub.fetchJob?.status == "pending" { return 3 }
    if sub.feedStatus == "paused" { return 4 }
    return 5
}
