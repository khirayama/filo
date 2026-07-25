import SwiftUI

struct StatusScreen: View {
    @State private var status: StatusOverview?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isRefreshing = false
    @State private var isTranslating = false
    @State private var isDiscarding = false
    @State private var busyFeedId: Int?
    @State private var notice: String?
    @State private var pollTask: Task<Void, Never>?
    @State private var showDiscardAllConfirm = false
    @State private var discardFeedTarget: Int?

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
        .confirmationDialog(
            "翻訳キューを破棄しますか？完了した翻訳は残ります。",
            isPresented: $showDiscardAllConfirm,
            titleVisibility: .visible
        ) {
            Button("破棄", role: .destructive) { Task { await discardAll() } }
        }
        .confirmationDialog(
            "このフィードの翻訳待ち・失敗を破棄しますか？完了した翻訳は残ります。",
            isPresented: Binding(get: { discardFeedTarget != nil }, set: { if !$0 { discardFeedTarget = nil } }),
            titleVisibility: .visible,
            presenting: discardFeedTarget
        ) { feedId in
            Button("破棄", role: .destructive) { Task { await discardFeed(feedId) } }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private func actionsSection(_ s: StatusOverview) -> some View {
        Section("操作") {
            Button(isRefreshing ? "取得中…" : "すべて取得") {
                Task { await refreshAll() }
            }
            .disabled(isRefreshing)

            Button(isTranslating ? "翻訳中…" : "すべて翻訳") {
                Task { await translateAll() }
            }
            .disabled(isTranslating)

            let totals = translationTotals(s)
            Button("キューを破棄", role: .destructive) { showDiscardAllConfirm = true }
                .disabled(isDiscarding || totals.pending + totals.failed == 0)

            if let notice {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(summaryLine(s))
                .font(.caption)
                .foregroundStyle(.secondary)

            translationProgress(s)
        }
    }

    // Sum every feed's coverage into one account-wide total for the queue bar.
    private func translationTotals(_ s: StatusOverview) -> TranslationCoverage {
        var total = TranslationCoverage(
            articles: 0, untranslatable: 0, needed: 0, ready: 0, failed: 0,
            queued: 0, processing: 0, pending: 0, missing: 0, lastError: nil)
        for sub in s.subscriptionStatuses {
            let c = sub.translation
            total.articles += c.articles
            total.untranslatable += c.untranslatable
            total.needed += c.needed
            total.ready += c.ready
            total.failed += c.failed
            total.queued += c.queued
            total.processing += c.processing
            total.pending += c.pending
            total.missing += c.missing
        }
        return total
    }

    // Overall translation queue progress: a done/needed bar, the live state
    // breakdown, and the titles currently in flight to the model.
    @ViewBuilder
    private func translationProgress(_ s: StatusOverview) -> some View {
        let total = translationTotals(s)
        if total.needed > 0 {
            let fraction = Double(total.ready) / Double(max(total.needed, 1))
            let percent = Int((fraction * 100).rounded())
            let breakdown = "翻訳中 \(total.processing)・順番待ち \(total.queued)・失敗 \(total.failed)"
                + (total.missing > 0 ? "・未リクエスト \(total.missing)" : "")
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(verbatim: "翻訳の進行状況").font(.subheadline).bold()
                    Spacer()
                    Text(verbatim: "完了 \(total.ready) / \(total.needed)（\(percent)%）")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ProgressView(value: fraction)
                Text(verbatim: breakdown).font(.caption).foregroundStyle(.secondary)
                if !s.translator.current.isEmpty {
                    let live = s.translator.current.map { c in
                        c.languages.isEmpty ? c.title : "\(c.title)（\(c.languages.joined(separator: "/"))）"
                    }.joined(separator: "　")
                    Text(verbatim: "今翻訳中: \(live)")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
        }
    }

    @ViewBuilder
    private func subscriptionStatusesSection(_ s: StatusOverview) -> some View {
        Section("購読一覧（状態順・\(s.subscriptionStatuses.count)件）") {
            if s.subscriptionStatuses.isEmpty {
                Text("購読がありません。")
                    .foregroundStyle(.secondary)
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
        // Only the in-flight request disables the button. Pending rows show
        // progress in the badge but must not lock the action: translation has
        // no per-feed job row, so a stalled queue would otherwise be stuck on
        // "翻訳中…" with no way to re-kick it. Matches the "すべて翻訳" button.
        let translateInFlight = busyFeedId == sub.feedId && isTranslating
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
                translationBadge(sub.translation)
                Text(sub.lastFetchedAt.map { DateFormatting.relative($0) } ?? "—")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(coverageLine(sub.translation))
                .font(.caption2)
                .foregroundStyle(.secondary)
            if isError, let err = sub.fetchJob?.lastError ?? sub.lastError {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(1)
            }
            if sub.translation.failed > 0, let err = sub.translation.lastError {
                Text("翻訳失敗: \(err)")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(1)
            }
            HStack(spacing: 12) {
                Button(fetchBusy ? "取得中…" : "取得") {
                    Task { await refreshFeed(sub.feedId) }
                }
                .disabled(isRefreshing || fetchBusy)
                Button(translateInFlight ? "翻訳中…" : "翻訳") {
                    Task { await translateFeed(sub.feedId) }
                }
                .disabled(isTranslating)
                Button("破棄", role: .destructive) { discardFeedTarget = sub.feedId }
                    .disabled(isDiscarding || sub.translation.pending + sub.translation.failed == 0)
            }
            .font(.caption)
            .buttonStyle(.borderless)
        }
    }

    private func summaryLine(_ s: StatusOverview) -> String {
        var line = "購読 \(s.feeds.total)件・記事 \(s.articles.total)件"
        if s.translator.pending > 0 { line += "・翻訳キュー 残り\(s.translator.pending)件" }
        if let fetchedAt = s.feeds.lastFetchedAt { line += "・最終取得 \(DateFormatting.relative(fetchedAt))" }
        line += "・約\(Int(pollInterval))秒ごとに自動更新"
        return line
    }

    // Full per-feed translation picture: how much is done, and if incomplete,
    // exactly why (queued / failed / not yet requested / not translatable).
    private func coverageLine(_ t: TranslationCoverage) -> String {
        if t.articles == 0 { return "翻訳: 記事なし" }
        var bits = ["翻訳: 完了 \(t.ready)/\(t.needed)"]
        if t.processing > 0 { bits.append("翻訳中 \(t.processing)") }
        if t.queued > 0 { bits.append("順番待ち \(t.queued)") }
        if t.failed > 0 { bits.append("失敗 \(t.failed)") }
        if t.missing > 0 { bits.append("未リクエスト \(t.missing)") }
        if t.untranslatable > 0 { bits.append("対象外 \(t.untranslatable)記事(言語不明等)") }
        return bits.joined(separator: "・")
    }

    // Translation state derived from coverage: queued pairs mean the drain is
    // still working on this feed; error rows mean some pairs gave up.
    @ViewBuilder
    private func translationBadge(_ t: TranslationCoverage) -> some View {
        if t.processing > 0 {
            StatusBadge(label: "翻訳中 \(t.processing)", tone: .warn)
        } else if t.queued > 0 {
            StatusBadge(label: "順番待ち \(t.queued)", tone: .warn)
        } else if t.failed > 0 {
            StatusBadge(label: "翻訳失敗 \(t.failed)", tone: .danger)
        }
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
            notice = result.enqueued > 0
                ? "\(result.enqueued)件のフィードの取得を開始しました。"
                : "取得対象のフィードがありません。"
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isRefreshing = false
    }

    private func translateAll() async {
        isTranslating = true
        notice = nil
        do {
            let result = try await APIClient.shared.translateAll()
            notice = result.enqueued > 0
                ? "\(result.enqueued)件のタイトル翻訳をキューに追加しました。完了すると一覧に反映されます。"
                : "翻訳が必要なタイトルはありません。"
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isTranslating = false
    }

    private func refreshFeed(_ feedId: Int) async {
        busyFeedId = feedId
        isRefreshing = true
        notice = nil
        do {
            _ = try await APIClient.shared.refreshFeed(feedId)
            notice = "フィードの取得を開始しました。"
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isRefreshing = false
        busyFeedId = nil
    }

    private func translateFeed(_ feedId: Int) async {
        busyFeedId = feedId
        isTranslating = true
        notice = nil
        do {
            let result = try await APIClient.shared.translateFeed(feedId)
            notice = result.enqueued > 0
                ? "\(result.enqueued)件のタイトル翻訳をキューに追加しました。"
                : "翻訳が必要なタイトルはありません。"
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isTranslating = false
        busyFeedId = nil
    }

    private func discardOutcome(_ removed: Int) -> String {
        removed > 0 ? "\(removed)件を破棄しました。" : "破棄する項目がありません。"
    }

    private func discardAll() async {
        isDiscarding = true
        notice = nil
        do {
            notice = discardOutcome(try await APIClient.shared.discardTranslations().removed)
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isDiscarding = false
    }

    private func discardFeed(_ feedId: Int) async {
        busyFeedId = feedId
        isDiscarding = true
        notice = nil
        do {
            notice = discardOutcome(try await APIClient.shared.discardFeedTranslations(feedId).removed)
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isDiscarding = false
        busyFeedId = nil
    }
}

// Keep the same actionable-first order as the web and Android status screens.
// The list is rebuilt from every polled snapshot, so a feed moves as soon as
// its fetch or translation state changes.
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
    if sub.translation.processing > 0 { return 4 }
    if sub.translation.queued > 0 { return 5 }
    if sub.feedStatus == "paused" { return 6 }
    if sub.translation.missing > 0 { return 7 }
    return 8
}

private func hasStatusAttention(_ sub: StatusSubscription) -> Bool {
    sub.consecutiveFailures > 0
        || sub.fetchJob?.status == "failed"
        || sub.lastResult == "error"
        || sub.translation.failed > 0
}
